"""
算法名称: 蒙特卡洛积分 (Monte Carlo Integration)
功能: 演示概率空间中的期望如何通过采样近似 (大数定律)
关联理论: 01_Theory_Derivation.md - 期望与勒贝格积分

核心逻辑:
$$ \mathbb{E}[f(X)] = \int f(x) p(x) dx \approx \frac{1}{N} \sum_{i=1}^N f(x_i) $$

这一原理是 Reinforcement Learning 中所有 "Sample-based" 算法 (如 Monte Carlo, TD, PPO) 的基石. 
因为我们通常无法直接计算积分 (环境动态未知)，只能通过与环境交互收集 Experience Replay 来近似期望. 
"""

import numpy as np
import matplotlib.pyplot as plt
from dataclasses import dataclass
from typing import Callable, Tuple

# ============================================
# 第一部分: 配置与环境定义
# ============================================

@dataclass
class ExperimentConfig:
    """实验配置"""
    num_samples: int = 10000    # 采样数量
    true_mean: float = 0.0      # 真实均值 (用于验证)
    true_std: float = 1.0       # 真实标准差

def target_function(x: np.ndarray) -> np.ndarray:
    """
    我们要计算期望的目标函数 f(x). 
    这里假设 f(x) = x^2，且 x ~ N(0, 1). 
    理论期望 E[x^2] = Var(x) + E[x]^2 = 1 + 0 = 1. 
    """
    return x ** 2

# ============================================
# 第二部分: 核心算法实现
# ============================================

def monte_carlo_expectation(
    num_samples: int, 
    func: Callable[[np.ndarray], np.ndarray]
) -> Tuple[np.ndarray, np.ndarray]:
    """
    使用蒙特卡洛方法估计期望. 
    
    Args:
        num_samples: 采样点数 N
        func: 目标函数 f(x)
        
    Returns:
        estimates: 随样本数增加的估计值序列
        samples: 原始采样点
    """
    # 1. 从概率测度 P (这里是标准正态分布) 中采样 omega
    # 对应理论: \omega \sim P
    samples = np.random.normal(loc=0, scale=1, size=num_samples)
    
    # 2. 计算函数值 f(X(\omega))
    values = func(samples)
    
    # 3. 计算累积平均值 (模拟样本量从 1 到 N 的过程)
    # 对应理论: \frac{1}{n} \sum_{i=1}^n f(x_i) \to \mathbb{E}[f(X)] (L.L.N)
    cumulative_sum = np.cumsum(values)
    sample_counts = np.arange(1, num_samples + 1)
    estimates = cumulative_sum / sample_counts
    
    return estimates, samples

# ============================================
# 第三部分: 可视化与验证
# ============================================

def run_experiment():
    print(">>> 开始蒙特卡洛积分实验...")
    config = ExperimentConfig()
    
    # 运行估计
    estimates, samples = monte_carlo_expectation(config.num_samples, target_function)
    
    final_estimate = estimates[-1]
    analytical_result = 1.0  # E[X^2] for N(0,1) is 1
    
    print(f"采样数量: {config.num_samples}")
    print(f"最终估计值: {final_estimate:.6f}")
    print(f"理论真实值: {analytical_result:.6f}")
    print(f"相对误差: {abs(final_estimate - analytical_result) / analytical_result * 100:.4f}%")
    
    # 绘图
    plt.figure(figsize=(10, 6))
    
    # 绘制收敛曲线
    plt.plot(estimates, label='Monte Carlo Estimate', color='#1f77b4')
    plt.axhline(y=analytical_result, color='r', linestyle='--', label='Analytical Truth (Expectation)')
    
    plt.title('Law of Large Numbers Convergence / 大数定律收敛演示')
    plt.xlabel('Number of Samples (n)')
    plt.ylabel('Estimated Expectation E[f(X)]')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # 保存图片 (模拟 artifact 生成)
    plt.savefig('convergence_plot.png')
    print(">>> 结果图已保存为 convergence_plot.png")

if __name__ == "__main__":
    run_experiment()
