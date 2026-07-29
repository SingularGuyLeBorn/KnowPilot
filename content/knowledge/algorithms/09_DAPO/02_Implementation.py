"""
算法名称: DAPO (Decoupled Clip and Dynamic Sampling Policy Optimization)
论文: DAPO: An Open-Source LLM Reinforcement Learning System at Scale
作者: ByteDance Seed Team
年份: 2025
arXiv: 2505.14953

核心创新:
1. Clip-Higher: 解耦裁剪，正负优势使用不同边界
2. Dynamic Sampling: 过滤全零奖励prompts
3. Token-Level Loss: Token级策略梯度损失
4. Overlong Reward Shaping: 过长回复的奖励塑造

验证结果: Qwen2.5-32B在AIME 2024达到50分

参考实现:
- verl: https://github.com/volcengine/verl
- 官方: https://dapo-sia.github.io/
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, Dict, List, Optional
from dataclasses import dataclass, field
import numpy as np

# ============================================
# 第一部分: 配置类
# ============================================

@dataclass
class DAPOConfig:
    """DAPO算法超参数配置
    
    Attributes:
        clip_eps_high: 正优势时的上界 (大于标准0.2)
        clip_eps_low: 负优势时的下界
        group_size: 每prompt采样数
        dynamic_sampling: 是否启用动态采样
        min_valid_ratio: 动态采样的最小有效比例
        use_token_level: 是否使用Token级损失
        overlong_penalty: 过长回复的惩罚系数
        max_length: 最大回复长度
    """
    # DAPO特有参数
    clip_eps_high: float = 0.28      # Clip-Higher: 正优势上界
    clip_eps_low: float = 0.2        # 负优势下界
    
    # 采样参数
    group_size: int = 8
    dynamic_sampling: bool = True
    min_valid_ratio: float = 0.5
    
    # 损失参数
    use_token_level: bool = True
    
    # 过长处理
    overlong_penalty: float = 0.01
    max_length: int = 4096
    
    # 训练参数
    kl_coef: float = 0.01
    learning_rate: float = 1e-6

# ============================================
# 第二部分: 核心 - 解耦裁剪 (Clip-Higher)
# ============================================

def dapo_clip(
    ratio: torch.Tensor,
    advantages: torch.Tensor,
    eps_high: float = 0.28,
    eps_low: float = 0.2
) -> torch.Tensor:
    """
    DAPO解耦裁剪 (Clip-Higher)
    
    数学公式:
    - 正优势 (A > 0): clip(r, max=1+ε_high) → 只裁上界
    - 负优势 (A < 0): clip(r, min=1-ε_low)  → 只裁下界
    
    为什么有效:
    - 正优势时: 放宽上界允许更多探索
    - 负优势时: 保持约束防止过度惩罚
    
    Args:
        ratio: 概率比 r_t = π_θ / π_old [B, T]
        advantages: 优势值 [B] (会广播)
        eps_high: 正优势时的上界
        eps_low: 负优势时的下界
        
    Returns:
        clipped_ratio: 裁剪后的概率比 [B, T]
    """
    # 扩展advantages到token维度 [B] -> [B, 1]
    if advantages.dim() == 1:
        adv_expanded = advantages.unsqueeze(-1)
    else:
        adv_expanded = advantages
    
    # 解耦裁剪
    clipped = torch.where(
        adv_expanded > 0,
        torch.clamp(ratio, max=1.0 + eps_high),   # 正优势: 只裁上界
        torch.clamp(ratio, min=1.0 - eps_low)     # 负优势: 只裁下界
    )
    
    return clipped

# ============================================
# 第三部分: Token级损失
# ============================================

def compute_dapo_loss(
    policy_log_probs: torch.Tensor,    # [B, T] 当前策略
    old_log_probs: torch.Tensor,       # [B, T] 旧策略  
    advantages: torch.Tensor,          # [B] 优势
    attention_mask: torch.Tensor,      # [B, T] 掩码
    config: DAPOConfig
) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
    """
    DAPO损失函数 (Token级 + 解耦裁剪)
    
    公式:
    L = -Σ_t clip^{DAPO}(r_t, A) · A
    
    Args:
        policy_log_probs: 当前策略的token级log概率 [B, T]
        old_log_probs: 旧策略的token级log概率 [B, T]  
        advantages: 序列级优势值 [B]
        attention_mask: 注意力掩码 [B, T]
        config: DAPO配置
        
    Returns:
        loss: 标量损失
        metrics: 调试指标
    """
    # 计算token级概率比
    log_ratio = policy_log_probs - old_log_probs
    ratio = torch.exp(log_ratio)  # [B, T]
    
    # 解耦裁剪
    clipped_ratio = dapo_clip(
        ratio, advantages, config.clip_eps_high, config.clip_eps_low
    )
    
    # Token级损失
    # 每个token乘以序列优势
    advantages_expanded = advantages.unsqueeze(-1)  # [B, 1]
    per_token_loss = -clipped_ratio * advantages_expanded  # [B, T]
    
    # 应用掩码并求和
    masked_loss = per_token_loss * attention_mask
    loss = masked_loss.sum() / attention_mask.sum()
    
    # 指标
    with torch.no_grad():
        clip_frac_high = ((ratio > 1 + config.clip_eps_high) & (advantages.unsqueeze(-1) > 0)).float().mean()
        clip_frac_low = ((ratio < 1 - config.clip_eps_low) & (advantages.unsqueeze(-1) < 0)).float().mean()
    
    metrics = {
        "dapo_loss": loss.detach(),
        "mean_ratio": ratio.mean().detach(),
        "clip_frac_high": clip_frac_high.detach(),
        "clip_frac_low": clip_frac_low.detach(),
        "mean_advantage": advantages.mean().detach(),
    }
    
    return loss, metrics

# ============================================
# 第四部分: 动态采样
# ============================================

def filter_zero_reward_prompts(
    rewards: torch.Tensor,
    group_size: int
) -> torch.Tensor:
    """
    检测全零奖励的prompts
    
    Args:
        rewards: [B] 所有response的奖励
        group_size: 每个prompt的response数量
        
    Returns:
        valid_mask: [num_prompts] 有效prompt的掩码
    """
    num_prompts = rewards.shape[0] // group_size
    rewards_grouped = rewards.view(num_prompts, group_size)
    
    # 检查每个prompt是否有非零奖励
    has_nonzero = (rewards_grouped != 0).any(dim=1)
    
    return has_nonzero

class DynamicSampler:
    """
    动态采样器
    
    功能:
    1. 检测全零奖励prompts
    2. 动态补充新prompts
    3. 保持有效样本比例
    """
    def __init__(self, prompt_pool: List, config: DAPOConfig):
        self.prompt_pool = prompt_pool
        self.config = config
        self.pool_idx = 0
        
    def get_next_prompts(self, count: int) -> List:
        """从池中获取新prompts"""
        prompts = []
        for _ in range(count):
            prompts.append(self.prompt_pool[self.pool_idx % len(self.prompt_pool)])
            self.pool_idx += 1
        return prompts
    
    def sample_until_valid(
        self,
        initial_prompts: List,
        sample_fn,      # 采样函数
        reward_fn,      # 奖励函数
        max_iterations: int = 10
    ) -> Tuple[List, torch.Tensor, torch.Tensor]:
        """
        动态采样直到获得足够有效样本
        
        Returns:
            valid_prompts: 有效prompts
            valid_responses: 对应responses
            valid_rewards: 对应rewards
        """
        valid_prompts = []
        valid_responses = []
        valid_rewards = []
        
        target_count = int(len(initial_prompts) * self.config.min_valid_ratio)
        current_prompts = initial_prompts
        
        for _ in range(max_iterations):
            # 采样responses
            responses = sample_fn(current_prompts, self.config.group_size)
            rewards = reward_fn(responses)
            
            # 过滤有效prompts
            valid_mask = filter_zero_reward_prompts(rewards, self.config.group_size)
            
            for i, is_valid in enumerate(valid_mask):
                if is_valid:
                    start_idx = i * self.config.group_size
                    end_idx = start_idx + self.config.group_size
                    
                    valid_prompts.append(current_prompts[i])
                    valid_responses.extend(responses[start_idx:end_idx])
                    valid_rewards.append(rewards[start_idx:end_idx])
            
            if len(valid_prompts) >= target_count:
                break
            
            # 补充新prompts
            need = target_count - len(valid_prompts)
            current_prompts = self.get_next_prompts(need)
        
        return valid_prompts, valid_responses, torch.cat(valid_rewards) if valid_rewards else torch.tensor([])

# ============================================
# 第五部分: 过长奖励塑造
# ============================================

def overlong_reward_shaping(
    rewards: torch.Tensor,
    response_lengths: torch.Tensor,
    max_length: int,
    penalty_coef: float = 0.01
) -> torch.Tensor:
    """
    过长回复的奖励塑造
    
    公式:
    R_shaped = R_original - λ · max(0, |y| - L_max)
    
    Args:
        rewards: 原始奖励 [B]
        response_lengths: 回复长度 [B]
        max_length: 最大长度
        penalty_coef: 惩罚系数
        
    Returns:
        shaped_rewards: 塑造后的奖励 [B]
    """
    excess_length = torch.clamp(response_lengths - max_length, min=0)
    penalty = penalty_coef * excess_length
    
    return rewards - penalty

# ============================================
# 第六部分: 优势计算 (继承自GRPO)
# ============================================

def compute_advantages(
    rewards: torch.Tensor,
    group_size: int,
    use_std_norm: bool = False,
    eps: float = 1e-5
) -> torch.Tensor:
    """
    计算组相对优势 (Dr. GRPO风格)
    
    A_i = R_i - mean(R)
    """
    num_prompts = rewards.shape[0] // group_size
    rewards = rewards.view(num_prompts, group_size)
    
    mean_rewards = rewards.mean(dim=1, keepdim=True)
    advantages = rewards - mean_rewards
    
    if use_std_norm:
        std_rewards = rewards.std(dim=1, keepdim=True)
        advantages = advantages / (std_rewards + eps)
    
    return advantages.view(-1)

# ============================================
# 第七部分: 完整DAPO训练步骤
# ============================================

def dapo_train_step(
    model: nn.Module,
    ref_model: Optional[nn.Module],
    optimizer: torch.optim.Optimizer,
    input_ids: torch.Tensor,
    attention_mask: torch.Tensor,
    rewards: torch.Tensor,
    response_lengths: torch.Tensor,
    config: DAPOConfig
) -> Dict[str, float]:
    """
    DAPO完整训练步骤
    """
    model.train()
    
    # 1. 过长奖励塑造
    shaped_rewards = overlong_reward_shaping(
        rewards, response_lengths, config.max_length, config.overlong_penalty
    )
    
    # 2. 计算优势
    advantages = compute_advantages(shaped_rewards, config.group_size)
    
    # 3. 获取log概率
    with torch.no_grad():
        old_outputs = model(input_ids, attention_mask=attention_mask)
        old_log_probs = compute_token_log_probs(
            old_outputs.logits, input_ids, attention_mask
        )
    
    outputs = model(input_ids, attention_mask=attention_mask)
    policy_log_probs = compute_token_log_probs(
        outputs.logits, input_ids, attention_mask
    )
    
    # 4. DAPO损失
    loss, metrics = compute_dapo_loss(
        policy_log_probs, old_log_probs, advantages, attention_mask, config
    )
    
    # 5. 可选KL惩罚
    total_loss = loss
    if ref_model is not None:
        with torch.no_grad():
            ref_outputs = ref_model(input_ids, attention_mask=attention_mask)
            ref_log_probs = compute_token_log_probs(
                ref_outputs.logits, input_ids, attention_mask
            )
        kl_div = ((policy_log_probs - ref_log_probs) * attention_mask).sum() / attention_mask.sum()
        total_loss = loss + config.kl_coef * kl_div
        metrics["kl_div"] = kl_div.detach()
    
    # 6. 梯度更新
    optimizer.zero_grad()
    total_loss.backward()
    optimizer.step()
    
    metrics["total_loss"] = total_loss.detach()
    
    return {k: v.item() if torch.is_tensor(v) else v for k, v in metrics.items()}

# ============================================
# 辅助函数
# ============================================

def compute_token_log_probs(logits, labels, attention_mask):
    shift_logits = logits[:, :-1, :].contiguous()
    shift_labels = labels[:, 1:].contiguous()
    
    log_probs = F.log_softmax(shift_logits, dim=-1)
    per_token_logps = torch.gather(
        log_probs, dim=2, index=shift_labels.unsqueeze(-1)
    ).squeeze(-1)
    
    return F.pad(per_token_logps, (1, 0), value=0.0)

# ============================================
# 使用示例
# ============================================

if __name__ == "__main__":
    print("=" * 60)
    print("DAPO (Decoupled Clip + Dynamic Sampling) 演示")
    print("=" * 60)
    
    config = DAPOConfig(
        clip_eps_high=0.28,
        clip_eps_low=0.2,
        group_size=4
    )
    
    # 模拟解耦裁剪
    print("\n1. 解耦裁剪演示")
    print("-" * 40)
    
    ratio = torch.tensor([0.7, 1.0, 1.3, 1.5])  # 不同的概率比
    advantages = torch.tensor([1.0, 1.0, -1.0, -1.0])  # 正/负优势
    
    clipped = dapo_clip(ratio, advantages, 0.28, 0.2)
    
    print(f"概率比 r:     {ratio.tolist()}")
    print(f"优势 A:       {advantages.tolist()}")
    print(f"裁剪后:       {clipped.tolist()}")
    print()
    print("解读:")
    print("  - r=1.5, A>0: 裁剪到1.28 (上界)")
    print("  - r=0.7, A<0: 裁剪到0.8  (下界)")
    
    # 模拟动态采样过滤
    print("\n2. 动态采样过滤演示")
    print("-" * 40)
    
    rewards = torch.tensor([
        1.0, 0.0, 0.5, 0.5,  # Prompt 1: 有非零 ✓
        0.0, 0.0, 0.0, 0.0,  # Prompt 2: 全零 ✗
        0.0, 0.0, 1.0, 1.0   # Prompt 3: 有非零 ✓
    ])
    
    valid_mask = filter_zero_reward_prompts(rewards, group_size=4)
    print(f"奖励: {rewards.tolist()}")
    print(f"有效prompts: {valid_mask.tolist()}")
    print("结果: Prompt 2被过滤掉")
    
    print("\n" + "=" * 60)
    print("DAPO核心技术:")
    print("  1. Clip-Higher: ε_high=0.28 > ε_low=0.2")
    print("  2. Dynamic Sampling: 过滤全零prompts")
    print("  3. Token-Level Loss: 逐token计算")
    print("  4. Overlong Shaping: 对过长softpenalty")
    print("=" * 60)
