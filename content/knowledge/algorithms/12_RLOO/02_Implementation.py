"""
算法名称: RLOO (REINFORCE Leave-One-Out)
论文: Back to Basics: Revisiting REINFORCE Style Optimization for Learning from Human Feedback in LLMs
作者: Arash Ahmadian et al. (Cohere For AI)
年份: 2024
arXiv: 2402.14740

核心创新:
1. 留一法 (Leave-One-Out) 基线: b_i = mean(R_{-i})
2. 无偏估计: 基线与当前样本独立
3. 极简高效: 无需价值网络，计算复杂度极低

核心公式:
$$
b_i = \\frac{1}{G-1} \\sum_{j \\neq i} R_j
$$
$$
A_i = R_i - b_i
$$

参考实现:
- https://github.com/CohereForAI/rloo
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
class RLOOConfig:
    """RLOO算法超参数配置
    
    Attributes:
        group_size: 每prompt采样数
        kl_coef: KL惩罚系数
    """
    group_size: int = 8
    kl_coef: float = 0.01
    
    # 训练参数
    learning_rate: float = 1e-6

# ============================================
# 第二部分: 核心 - 留一法优势计算
# ============================================

def compute_rloo_advantages(
    rewards: torch.Tensor,
    group_size: int
) -> Tuple[torch.Tensor, Dict[str, float]]:
    """
    计算RLOO优势 (Leave-One-Out Advantage)
    
    公式:
    b_i = (Sum(R) - R_i) / (G - 1)
    A_i = R_i - b_i
    
    Args:
        rewards: 扁平化的奖励张量 [B * G]
        group_size: 组大小 G
        
    Returns:
        advantages: RLOO优势 [B * G]
        metrics: 统计指标
    """
    # 1. 重塑为 [Num_Prompts, Group_Size]
    num_prompts = rewards.shape[0] // group_size
    rewards_grouped = rewards.view(num_prompts, group_size)
    
    # 2. 计算组内总和 [Num_Prompts, 1]
    sum_rewards = rewards_grouped.sum(dim=1, keepdim=True)
    
    # 3. 向量化计算留一均值
    # b_i = (Sum - R_i) / (G - 1)
    # 利用广播机制: ( [N,1] - [N,G] ) / scalar
    loo_means = (sum_rewards - rewards_grouped) / (group_size - 1)
    
    # 4. 计算优势
    advantages_grouped = rewards_grouped - loo_means
    
    # 5. 展平
    advantages = advantages_grouped.view(-1)
    
    # 6. 计算指标
    metrics = {
        "mean_advantage": advantages.mean().item(),
        "std_advantage": advantages.std().item(),
        "mean_baseline": loo_means.mean().item()
    }
    
    return advantages, metrics

# ============================================
# 第三部分: Token级Log概率计算 (通用)
# ============================================

def compute_token_log_probs(
    logits: torch.Tensor,
    labels: torch.Tensor,
    attention_mask: torch.Tensor
) -> torch.Tensor:
    """计算Token级Log概率"""
    shift_logits = logits[:, :-1, :].contiguous()
    shift_labels = labels[:, 1:].contiguous()
    shift_mask = attention_mask[:, 1:].contiguous()
    
    log_probs = F.log_softmax(shift_logits, dim=-1)
    
    # gather label probabilities
    per_token_logps = torch.gather(
        log_probs, dim=2, index=shift_labels.unsqueeze(-1)
    ).squeeze(-1)
    
    return per_token_logps * shift_mask

# ============================================
# 第四部分: RLOO损失函数 (REINFORCE风格)
# ============================================

def compute_rloo_loss(
    log_probs: torch.Tensor,     # [B, T]
    advantages: torch.Tensor,    # [B]
    attention_mask: torch.Tensor # [B, T]
) -> torch.Tensor:
    """
    计算RLOO损失
    
    L = - E [ A_i * sum_t log pi(y_t|...) ]
    
    Args:
        log_probs: Token级log概率 [B, T] (mask后)
        advantages: 序列级优势 [B]
        attention_mask: 掩码 (虽log_probs已mask, 这里用于求和计数)
    
    Returns:
        loss: 标量
    """
    # 1. 计算序列总log概率
    # log pi(y|x) = sum_t log pi(y_t|...)
    # 这里的log_probs在调用前应该已经mask过或者是compute_token_log_probs的结果
    seq_log_probs = log_probs.sum(dim=-1)  # [B]
    
    # 2. 策略梯度损失
    # L = - A * log_prob
    loss = -(advantages * seq_log_probs).mean()
    
    return loss

# ============================================
# 第五部分: 完整训练步
# ============================================

def rloo_train_step(
    model: nn.Module,
    ref_model: Optional[nn.Module],
    optimizer: torch.optim.Optimizer,
    input_ids: torch.Tensor,
    attention_mask: torch.Tensor,
    rewards: torch.Tensor,
    config: RLOOConfig
) -> Dict[str, float]:
    
    model.train()
    
    # 1. 计算RLOO优势
    advantages, adv_metrics = compute_rloo_advantages(rewards, config.group_size)
    
    # 2. 前向传播
    outputs = model(input_ids, attention_mask=attention_mask)
    # Token log probs [B, T]
    # 注意: 输出长度比input少1 (shift)
    token_log_probs = compute_token_log_probs(
        outputs.logits, input_ids, attention_mask
    )
    
    # 3. 计算KL散度 (可选)
    kl_div = 0.0
    if ref_model is not None and config.kl_coef > 0:
        with torch.no_grad():
            ref_outputs = ref_model(input_ids, attention_mask=attention_mask)
            ref_token_log_probs = compute_token_log_probs(
                ref_outputs.logits, input_ids, attention_mask
            )
        # Token-level KL: pi - ref (in log space)
        # sum over tokens, then mean over batch
        kl_per_seq = (token_log_probs - ref_token_log_probs).sum(dim=-1)
        kl_div = kl_per_seq.mean()
        
    # 4. 计算总损失
    # RLOO也是最大化期望回报，即最小化负回报
    # 但我们通常也将KL作为惩罚项加入Loss
    # Loss = PolicyLoss + beta * KL
    policy_loss = compute_rloo_loss(token_log_probs, advantages, attention_mask)
    
    total_loss = policy_loss + config.kl_coef * kl_div
    
    # 5. 反向传播
    optimizer.zero_grad()
    total_loss.backward()
    optimizer.step()
    
    metrics = {
        "loss": total_loss.item(),
        "policy_loss": policy_loss.item(),
        "kl_div": kl_div.item() if isinstance(kl_div, torch.Tensor) else kl_div,
        **adv_metrics
    }
    
    return metrics

# ============================================
# 演示代码
# ============================================
if __name__ == "__main__":
    print("RLOO Advantage Calculation Demo")
    print("-" * 30)
    
    # 模拟数据: 2个prompts, 每个4个responses (Total=8)
    rewards = torch.tensor([
        10.0, 5.0, 8.0, 2.0,   # Prompt 1
        1.0,  1.0, 1.0, 5.0    # Prompt 2
    ])
    group_size = 4
    
    advantages, metrics = compute_rloo_advantages(rewards, group_size)
    
    print(f"Rewards:\n{rewards.view(-1, group_size)}")
    print(f"\nAdvantages:\n{advantages.view(-1, group_size)}")
    
    # 验证计算
    # Prompt 1, Response 1 (10.0):
    # Mean(5, 8, 2) = 5.0
    # Adv = 10.0 - 5.0 = 5.0
    print(f"\nManual Check for P1_R1 (10.0):")
    print(f"Others: [5.0, 8.0, 2.0] -> Mean: 5.0")
    print(f"Advantage: 10.0 - 5.0 = 5.0 (Calculated: {advantages[0].item()})")
    
    print(f"\nMetrics: {metrics}")
