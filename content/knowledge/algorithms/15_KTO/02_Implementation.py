"""
算法名称: Kahneman-Tversky Optimization (KTO)
论文: KTO: Model Alignment as Prospect Theoretic Optimization
arXiv: 2402.01306

特点:
- 不需要成对数据 (Unpaired preference optimization)
- 引入 Loss Aversion 系数 (lambda_D)
- 分别计算 Good 和 Bad 的 Loss 并加权

核心公式:
L = w * (1 - sigmoid(beta * (log_pi - log_ref) - z_ref))
"""

import torch
import torch.nn.functional as F

def compute_kto_loss(
    policy_logps: torch.Tensor,
    ref_logps: torch.Tensor,
    labels: torch.Tensor, # 1 for desirable, 0 for undesirable
    beta: float = 0.1,
    desirable_weight: float = 1.0,
    undesirable_weight: float = 1.0
) -> tuple:
    """
    计算 KTO Loss
    
    Args:
        labels: 0/1 标签
        desirable_weight: 通常为 1.0
        undesirable_weight: 推荐为 1.33 或 2.25 (Loss Aversion)
    """
    # 1. 隐式奖励 (KL divergence term partial)
    rewards = beta * (policy_logps - ref_logps)
    
    # 2. 参考点 z_ref (KL Estimate)
    # 简单的实现: 使用当前batch中 desirable 样本的 reward 均值作为参考点
    # 这保证了 zero-mean shifting
    # 注意: 生产环境中可能需要 Momentum Average
    with torch.no_grad():
        if (labels==1).sum() > 0:
            kl_ref = rewards[labels==1].mean()
        else:
            kl_ref = rewards.mean() # Fallback
            
    # Centered Rewards
    # KTO论文中: r' = r - z
    adj_rewards = rewards - kl_ref
    
    # 3. Loss Calculation
    # Case 1: Desirable (label=1) -> maximize adj_reward -> minimize 1 - sigmoid(adj_reward)
    # Case 2: Undesirable (label=0) -> minimize adj_reward -> minimize 1 - sigmoid(-adj_reward)
    
    # 使用 log_sigmoid 更加数值稳定: 
    # 1 - sigmoid(x) = sigmoid(-x)
    # loss = -log(sigmoid(x)) ?? No, KTO uses (1-sigma)^2 or just 1-sigma in early versions.
    # HALO / KTO official code uses 1 - sigmoid.
    # Let's use the version from archinet/trl:
    # L = w * (1 - sigmoid(...))
    
    losses = torch.where(
        labels == 1,
        (1 - F.sigmoid(adj_rewards)) * desirable_weight,
        (1 - F.sigmoid(-adj_rewards)) * undesirable_weight  # Negate reward for undesirable
    )
    
    loss = losses.mean()
    
    return loss, {
        "kto_loss": loss.item(),
        "mean_reward": rewards.mean().item(),
        "kl_ref": kl_ref.item()
    }
