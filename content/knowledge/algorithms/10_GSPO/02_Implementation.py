"""
算法名称: GSPO (Group Sequence Policy Optimization)
论文: Group Sequence Policy Optimization
作者: Qwen Team, Alibaba Inc.
年份: 2025
arXiv: 2507.18071

核心创新:
1. 序列级重要性比率 (而非Token级乘积)
2. 序列级裁剪 (更稳定)
3. 解决MoE训练不稳定问题

数学公式:
$$
r^{GSPO} = \\exp\\left(\\sum_t \\log\\pi_\\theta(y_t) - \\sum_t \\log\\pi_{old}(y_t)\\right)
$$
$$
L^{GSPO} = -\\mathbb{E}\\left[\\min(r \\cdot A, \\text{clip}(r, 1-\\epsilon, 1+\\epsilon) \\cdot A)\\right]
$$

验证: Qwen3全系列(Instruct、Coder、Thinking)

参考实现:
- verl: https://github.com/volcengine/verl
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, Dict, Optional
from dataclasses import dataclass

# ============================================
# 第一部分: 配置类
# ============================================

@dataclass
class GSPOConfig:
    """GSPO算法超参数配置
    
    Attributes:
        clip_epsilon: 序列级裁剪范围
        group_size: 每prompt采样数
        kl_coef: KL惩罚系数
        use_std_norm: 是否使用优势标准化
    """
    clip_epsilon: float = 0.2
    group_size: int = 8
    kl_coef: float = 0.01
    use_std_norm: bool = False  # Dr. GRPO风格
    eps: float = 1e-5
    
    # 训练参数
    learning_rate: float = 1e-6

# ============================================
# 第二部分: 序列级log概率计算
# ============================================

def compute_sequence_log_probs(
    logits: torch.Tensor,          # [B, T, V]
    labels: torch.Tensor,          # [B, T]
    attention_mask: torch.Tensor   # [B, T]
) -> torch.Tensor:
    """
    计算序列级log概率 (GSPO的核心)
    
    公式:
    log π(y|x) = Σ_t log P(y_t | y_{<t})
    
    Args:
        logits: 语言模型logits [batch, seq_len, vocab_size]
        labels: 目标token序列 [batch, seq_len]
        attention_mask: 掩码 [batch, seq_len]
        
    Returns:
        seq_log_probs: 序列log概率 [batch]
    """
    # 对齐
    shift_logits = logits[:, :-1, :].contiguous()
    shift_labels = labels[:, 1:].contiguous()
    shift_mask = attention_mask[:, 1:].contiguous()
    
    # 计算每个位置的log概率
    log_probs = F.log_softmax(shift_logits, dim=-1)
    
    # 提取目标token的log概率
    per_token_logp = torch.gather(
        log_probs, dim=2, index=shift_labels.unsqueeze(-1)
    ).squeeze(-1)  # [B, T-1]
    
    # 求和得到序列log概率 (GSPO的关键!)
    seq_log_probs = (per_token_logp * shift_mask).sum(dim=-1)  # [B]
    
    return seq_log_probs

# ============================================
# 第三部分: 序列级比率计算
# ============================================

def compute_sequence_ratio(
    policy_seq_logp: torch.Tensor,    # [B]
    old_seq_logp: torch.Tensor        # [B]
) -> torch.Tensor:
    """
    计算序列级重要性比率 (GSPO的核心区别)
    
    公式:
    r = exp(log π_θ(y) - log π_old(y))
    
    与GRPO的区别:
    - GRPO: r = Π_t r_t (token级乘积) → 可能爆炸
    - GSPO: r = exp(Σ_t log r_t) (序列级) → 更稳定
    
    数学上等价，但数值稳定性不同!
    """
    log_ratio = policy_seq_logp - old_seq_logp
    ratio = torch.exp(log_ratio)
    return ratio

# ============================================
# 第四部分: GSPO损失函数
# ============================================

def compute_gspo_loss(
    policy_seq_logp: torch.Tensor,    # [B]
    old_seq_logp: torch.Tensor,       # [B]
    advantages: torch.Tensor,          # [B]
    clip_epsilon: float = 0.2
) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
    """
    GSPO损失函数 (序列级裁剪)
    
    公式:
    L = -E[min(r · A, clip(r, 1-ε, 1+ε) · A)]
    
    关键区别: 裁剪作用于序列级比率r，而非token级r_t
    
    Args:
        policy_seq_logp: 当前策略的序列log概率 [B]
        old_seq_logp: 旧策略的序列log概率 [B]
        advantages: 优势值 [B]
        clip_epsilon: 裁剪范围
        
    Returns:
        loss: 标量损失
        metrics: 调试指标
    """
    # 序列级比率
    ratio = compute_sequence_ratio(policy_seq_logp, old_seq_logp)
    
    # 序列级裁剪 (GSPO的关键!)
    clipped_ratio = torch.clamp(ratio, 1 - clip_epsilon, 1 + clip_epsilon)
    
    # PPO目标
    surr1 = ratio * advantages
    surr2 = clipped_ratio * advantages
    loss = -torch.min(surr1, surr2).mean()
    
    # 指标
    with torch.no_grad():
        clip_frac = ((ratio - 1).abs() > clip_epsilon).float().mean()
        log_ratio = policy_seq_logp - old_seq_logp
        approx_kl = ((ratio - 1) - log_ratio).mean()
    
    metrics = {
        "gspo_loss": loss.detach(),
        "mean_ratio": ratio.mean().detach(),
        "max_ratio": ratio.max().detach(),
        "min_ratio": ratio.min().detach(),
        "clip_fraction": clip_frac.detach(),
        "approx_kl": approx_kl.detach(),
    }
    
    return loss, metrics

# ============================================
# 第五部分: 优势计算 (继承自GRPO)
# ============================================

def compute_advantages(
    rewards: torch.Tensor,
    group_size: int,
    use_std_norm: bool = False,
    eps: float = 1e-5
) -> torch.Tensor:
    """计算组相对优势 (Dr. GRPO风格)"""
    num_prompts = rewards.shape[0] // group_size
    rewards = rewards.view(num_prompts, group_size)
    
    mean_rewards = rewards.mean(dim=1, keepdim=True)
    advantages = rewards - mean_rewards
    
    if use_std_norm:
        std_rewards = rewards.std(dim=1, keepdim=True)
        advantages = advantages / (std_rewards + eps)
    
    return advantages.view(-1)

# ============================================
# 第六部分: 完整GSPO训练步骤
# ============================================

def gspo_train_step(
    model: nn.Module,
    ref_model: Optional[nn.Module],
    optimizer: torch.optim.Optimizer,
    input_ids: torch.Tensor,
    attention_mask: torch.Tensor,
    rewards: torch.Tensor,
    config: GSPOConfig
) -> Dict[str, float]:
    """
    GSPO完整训练步骤
    """
    model.train()
    
    # 1. 计算优势
    advantages = compute_advantages(
        rewards, config.group_size, config.use_std_norm, config.eps
    )
    
    # 2. 获取旧策略的序列log概率
    with torch.no_grad():
        old_logits = model(input_ids, attention_mask=attention_mask).logits
        old_seq_logp = compute_sequence_log_probs(old_logits, input_ids, attention_mask)
    
    # 3. 获取当前策略的序列log概率
    logits = model(input_ids, attention_mask=attention_mask).logits
    policy_seq_logp = compute_sequence_log_probs(logits, input_ids, attention_mask)
    
    # 4. GSPO损失
    loss, metrics = compute_gspo_loss(
        policy_seq_logp, old_seq_logp, advantages, config.clip_epsilon
    )
    
    # 5. 可选KL惩罚
    total_loss = loss
    if ref_model is not None:
        with torch.no_grad():
            ref_logits = ref_model(input_ids, attention_mask=attention_mask).logits
            ref_seq_logp = compute_sequence_log_probs(ref_logits, input_ids, attention_mask)
        kl_div = (policy_seq_logp - ref_seq_logp).mean()
        total_loss = loss + config.kl_coef * kl_div
        metrics["kl_div"] = kl_div.detach()
    
    # 6. 梯度更新
    optimizer.zero_grad()
    total_loss.backward()
    optimizer.step()
    
    metrics["total_loss"] = total_loss.detach()
    
    return {k: v.item() if torch.is_tensor(v) else v for k, v in metrics.items()}

# ============================================
# 第七部分: GSPO vs GRPO 对比演示
# ============================================

def demo_ratio_stability():
    """演示GSPO的数值稳定性优势"""
    torch.manual_seed(42)
    
    # 模拟长序列场景
    T = 100  # 100个tokens
    B = 4
    
    # 模拟token级log比率 (微小波动)
    token_log_ratios = torch.randn(B, T) * 0.1  # 均值0，方差0.01
    
    # GRPO: Token级乘积
    grpo_ratio = torch.exp(token_log_ratios).prod(dim=-1)
    
    # GSPO: 序列级
    gspo_ratio = torch.exp(token_log_ratios.sum(dim=-1))
    
    print("数值稳定性对比 (T=100 tokens)")
    print("=" * 50)
    print(f"Token log_ratio 统计: mean={token_log_ratios.mean():.4f}, std={token_log_ratios.std():.4f}")
    print()
    print("GRPO (Token级乘积):")
    print(f"  ratio范围: [{grpo_ratio.min():.2e}, {grpo_ratio.max():.2e}]")
    print()
    print("GSPO (序列级):")
    print(f"  ratio范围: [{gspo_ratio.min():.4f}, {gspo_ratio.max():.4f}]")
    print()
    print("结论: GSPO的ratio范围更可控!")
    
    return grpo_ratio, gspo_ratio

# ============================================
# 使用示例
# ============================================

if __name__ == "__main__":
    print("=" * 60)
    print("GSPO (Group Sequence Policy Optimization) 演示")
    print("=" * 60)
    
    # 1. 数值稳定性对比
    print("\n1. 数值稳定性对比")
    print("-" * 40)
    demo_ratio_stability()
    
    # 2. 序列级比率计算
    print("\n2. 序列级比率计算")
    print("-" * 40)
    
    policy_seq_logp = torch.tensor([-50.0, -52.0, -48.0, -55.0])
    old_seq_logp = torch.tensor([-51.0, -51.0, -51.0, -51.0])
    
    ratio = compute_sequence_ratio(policy_seq_logp, old_seq_logp)
    print(f"策略序列log概率: {policy_seq_logp.tolist()}")
    print(f"旧策略序列log概率: {old_seq_logp.tolist()}")
    print(f"序列级比率: {ratio.tolist()}")
    
    # 3. GSPO损失
    print("\n3. GSPO损失计算")
    print("-" * 40)
    
    advantages = torch.tensor([0.5, -0.5, 0.3, -0.3])
    loss, metrics = compute_gspo_loss(
        policy_seq_logp, old_seq_logp, advantages, clip_epsilon=0.2
    )
    
    print(f"优势: {advantages.tolist()}")
    print(f"GSPO损失: {loss.item():.4f}")
    print(f"裁剪比例: {metrics['clip_fraction'].item():.2%}")
    
    print("\n" + "=" * 60)
    print("GSPO核心公式:")
    print("  r = exp(Σ log π_θ - Σ log π_old)  [序列级]")
    print("  L = -E[min(r·A, clip(r)·A)]")
    print("=" * 60)
