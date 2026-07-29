"""
算法名称: Identity Preference Optimization (IPO)
论文: A General Theoretical Paradigm to Understand Learning from Human Preferences (DeepMind)
arXiv: 2310.12036

核心公式:
L_IPO = (log(pi_w/ref_w) - log(pi_l/ref_l) - 1/(2*beta))^2

关键点:
- MSE Loss 替代 Sigmoid Loss
- 避免 DPO 的过拟合 (KL vanishing)
- 这里的 beta 通常也设为 0.1~0.5，但在 IPO公式中 1/2beta 是 Target Gap
"""

import torch
import torch.nn.functional as F

def compute_ipo_loss(
    policy_chosen_logps: torch.Tensor,
    policy_rejected_logps: torch.Tensor,
    ref_chosen_logps: torch.Tensor,
    ref_rejected_logps: torch.Tensor,
    beta: float = 0.1
) -> tuple:
    """
    计算 IPO Loss
    
    Args:
        beta: 正则化系数 (TRL库中通常沿用beta这个名字)
              Target Gap = 1 / (2 * beta)
    """
    # 1. Log Probability Differences (Log Ratio)
    log_r_chosen = policy_chosen_logps - ref_chosen_logps
    log_r_rejected = policy_rejected_logps - ref_rejected_logps
    
    # 2. Preference Gap h(x, y_w, y_l)
    logits = log_r_chosen - log_r_rejected
    
    # 3. Target Gap (Margin)
    # 论文公式: (h - 1/(2*tau))^2. 这里 beta 对应 tau.
    target_gap = 1.0 / (2.0 * beta)
    
    # 4. MSE Loss
    loss = (logits - target_gap) ** 2
    
    return loss.mean(), {
        "ipo_loss": loss.mean().item(),
        "mean_gap": logits.mean().item(),
        "target_gap": target_gap
    }
