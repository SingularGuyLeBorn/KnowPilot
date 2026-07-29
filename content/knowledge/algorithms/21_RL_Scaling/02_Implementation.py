"""
算法名称: Advanced RL Scaling Simulator (Meta 2025 Theory)
描述: 模拟 RL Scaling 中的关键动力学，包括 Critic Capacity, SNR Decay, 和 Test-time Compute Trade-off.

核心模型:
1. Dual Scaling: N_critic >= N_policy ^ 1.2
2. SNR Decay: SNR ~ 1 / sqrt(L) * exp(-kappa * L)
3. Temperature Decay: tau ~ C ^ -0.25
"""

import numpy as np
import matplotlib.pyplot as plt

def simulate_critic_stability(
    policy_params_b: float, 
    critic_params_b: float,
    scaling_exponent: float = 1.2
) -> str:
    """
    检查 Value Network 是否会发生 Collapse
    
    Args:
        policy_params_b: Policy参数量 (Billion)
        critic_params_b: Critic参数量 (Billion)
    """
    # 理论要求的最小 Critic 容量
    required_critic_capacity = np.power(policy_params_b, scaling_exponent)
    
    ratio = critic_params_b / required_critic_capacity
    
    if ratio >= 1.0:
        status = "STABLE"
        risk = 0.0
    elif ratio >= 0.8:
        status = "Borderline"
        risk = 0.5 * (1 - ratio)
    else:
        status = "COLLAPSE"
        risk = 1.0
        
    return status, required_critic_capacity

def simulate_snr_decay(
    chain_length: int,
    use_prm: bool = False,
    kappa: float = 0.01
):
    """
    模拟梯度信噪比 (Signal-to-Noise Ratio) 随推理链长度的衰减
    
    Formula: SNR_ORM ~ 1/sqrt(L) * exp(-kappa * L)
             SNR_PRM ~ Constant (if step-level supervision exists)
    """
    if use_prm:
        # PRM 每步都有监督，SNR 保持相对稳定
        snr = 1.0 / np.sqrt(1) # per step
    else:
        # ORM 只有最后有监督，中间衰减
        snr = (1.0 / np.sqrt(chain_length)) * np.exp(-kappa * chain_length)
        
    return snr

def optimal_temperature(compute_budget: float):
    """
    温度缩放定律: tau* ~ C^-0.25
    假设 C=1e18 (1 ExaFLOPs) 时 tau=1.0
    """
    # Normalize by 1e18
    norm_compute = compute_budget / 1e18
    tau = 1.0 * np.power(norm_compute, -0.25)
    
    # Clip for stability
    return max(0.1, min(1.0, tau))

def main():
    print("=== Meta 2025 RL Scaling Dynamics Simulator ===\n")
    
    # 1. Critic Stability Check
    print("--- 1. Dual-Scaling Hypothesis Check ---")
    scenarios = [
        (7, 7),     # Llama-3-8B (Policy=7, Critic=7)
        (70, 70),   # Llama-3-70B (Shared/Same size)
        (70, 160),  # Llama-3-70B + Large Critic
        (405, 405), # Llama-3-405B (Shared)
        (405, 1300) # Llama-3-405B + Huge MoE Critic
    ]
    
    for p_size, c_size in scenarios:
        status, req = simulate_critic_stability(p_size, c_size)
        print(f"Policy: {p_size:3d}B | Critic: {c_size:4d}B | Req: {req:4.0f}B | Status: {status}")
        
    # 2. ORM vs PRM Scaling Wall
    print("\n--- 2. Outcomes vs Process Wall ---")
    lengths = [10, 50, 100, 500, 1000]
    print(f"{'Length':<10} | {'SNR (ORM)':<15} | {'SNR (PRM)':<15}")
    for L in lengths:
        snr_orm = simulate_snr_decay(L, use_prm=False)
        snr_prm = simulate_snr_decay(L, use_prm=True)
        print(f"{L:<10} | {snr_orm:.6f}        | {snr_prm:.6f}")
        if snr_orm < 1e-4:
            print(f"   >>> WARNING: Outcome Learning Impossible at L={L} (Bit-Limit Reached)")

    # 3. Temperature Scaling
    print("\n--- 3. Temperature Scaling Law ---")
    budgets = [1e18, 1e20, 1e22, 1e24] # FLOPs
    for b in budgets:
        tau = optimal_temperature(b)
        print(f"Compute: {b:.0e} FLOPs | Optimal Tau: {tau:.2f}")

if __name__ == "__main__":
    main()
