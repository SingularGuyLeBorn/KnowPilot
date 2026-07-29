"""
算法名称: Geometric Mean Policy Optimization (GMPO)
状态: Experimental / Conceptual
描述: GRPO的变体，使用几何平均 (Log空间的算术平均) 作为基线，以提高对异常值的鲁棒性. 

核心公式:
A_i = log R_i - Mean(log R)
"""

import torch

def compute_gmpo_advantages(
    rewards: torch.Tensor,
    group_size: int,
    epsilon: float = 1e-8
) -> torch.Tensor:
    """
    计算 GMPO 优势
    
    Args:
        rewards: [Batch * GroupSize] 正实数奖励
        
    Returns:
        advantages: [Batch * GroupSize]
    """
    # Reshape
    rewards = rewards.view(-1, group_size)
    
    # 1. 转换到 Log 域
    # 必须保证 reward > 0
    params_eps = 1e-6
    log_rewards = torch.log(rewards.clamp(min=epsilon))
    
    # 2. 计算 Log 域基线 (几何平均的 Log)
    # sum(log r) / G = log( prod(r)^(1/G) )
    baseline = log_rewards.mean(dim=1, keepdim=True)
    
    # 3. 计算优势 (Log Ratio)
    # log r - log gm = log (r / gm)
    advantages = log_rewards - baseline
    
    # 4. 可选: Log域归一化
    # 除以 log rewards 的标准差
    std_log = log_rewards.std(dim=1, keepdim=True)
    advantages = advantages / (std_log + params_eps)
    
    return advantages.flatten()

# 对比测试
if __name__ == "__main__":
    # Test Case: One outlier
    r = torch.tensor([1.0, 1.0, 1.0, 100.0])
    
    # GRPO (Arithmetic)
    grpo_base = r.mean() # 25.75
    grpo_adv = r - grpo_base # [-24.75, ..., 74.25]
    
    # GMPO (Geometric)
    # GM = (1*1*1*100)^(1/4) = 100^0.25 = sqrt(10) = 3.16
    gmpo_adv = compute_gmpo_advantages(r, 4)
    
    print(f"Rewards: {r}")
    print(f"GRPO Adv: {grpo_adv}")
    print(f"GMPO Adv: {gmpo_adv}")
    # GRPO会对前三个样本给予强烈的负反馈
    # GMPO相对温和
