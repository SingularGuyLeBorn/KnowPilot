"""
算法名称: REINFORCE (蒙特卡洛策略梯度)
功能: 演示策略梯度定理的最基础实现
关联理论: 01_Theory_Derivation.md - 策略梯度定理

核心公式:
$$\nabla_\theta J(\theta) = \mathbb{E}_{\tau \sim \pi_\theta}\left[\sum_t \nabla_\theta \log \pi_\theta(a_t|s_t) \cdot G_t\right]$$

其中 G_t 是从时刻 t 开始的折扣回报. 

本代码演示:
1. 参数化策略 π_θ(a|s) 的定义
2. 对数概率梯度 ∇log π 的计算
3. 使用蒙特卡洛回报作为权重
4. 策略参数的梯度上升更新
"""

import numpy as np
import matplotlib.pyplot as plt
from typing import List, Tuple
from dataclasses import dataclass

# ============================================
# 第一部分: 配置与环境定义
# ============================================

@dataclass
class Config:
    """实验配置"""
    num_episodes: int = 500          # 训练的回合数
    max_steps_per_episode: int = 100 # 每回合最大步数
    learning_rate: float = 0.01      # 学习率 α
    gamma: float = 0.99              # 折扣因子 γ
    
class SimpleBanditEnv:
    """
    简单的多臂老虎机环境 (Context-Free Bandit)
    
    动作空间: {0, 1, 2} (三个选择)
    奖励设置:
      - 动作0的期望奖励: 0.2
      - 动作1的期望奖励: 0.5 (最优)
      - 动作2的期望奖励: 0.3
    
    这个简单环境让我们能够清晰地观察策略梯度如何工作:
    策略应该逐渐学会偏好动作1(因为它的期望奖励最高). 
    """
    def __init__(self):
        self.num_actions = 3
        self.reward_probs = [0.2, 0.5, 0.3]  # 每个动作给予奖励1的概率
        
    def step(self, action: int) -> float:
        """
        执行动作，返回奖励
        
        奖励是随机的:
        - 以 reward_probs[action] 的概率获得奖励 1
        - 否则获得奖励 0
        """
        if np.random.random() < self.reward_probs[action]:
            return 1.0
        else:
            return 0.0
            
    def get_optimal_action(self) -> int:
        """返回理论上的最优动作"""
        return np.argmax(self.reward_probs)

# ============================================
# 第二部分: 参数化策略 π_θ(a|s)
# ============================================

class SoftmaxPolicy:
    """
    Softmax参数化策略
    
    对于Bandit问题(无状态)，策略简化为:
    π_θ(a) = exp(θ_a) / Σ_a' exp(θ_a')
    
    θ 是一个长度为 num_actions 的向量，表示每个动作的"偏好". 
    通过Softmax函数将偏好转换为概率. 
    """
    def __init__(self, num_actions: int):
        # 初始化参数 θ 为全零 (均匀策略)
        # θ_a 表示对动作 a 的"偏好程度"
        self.theta = np.zeros(num_actions)
        self.num_actions = num_actions
        
    def get_action_probabilities(self) -> np.ndarray:
        """
        计算当前策略下各动作的概率
        
        公式: π_θ(a) = exp(θ_a) / Σ_a' exp(θ_a')
        
        为了数值稳定性，我们减去最大值:
        π_θ(a) = exp(θ_a - max(θ)) / Σ_a' exp(θ_a' - max(θ))
        """
        # 数值稳定性处理: 减去最大值防止exp溢出
        theta_stable = self.theta - np.max(self.theta)
        exp_theta = np.exp(theta_stable)
        probs = exp_theta / np.sum(exp_theta)
        return probs
        
    def sample_action(self) -> int:
        """
        根据当前策略采样一个动作
        
        这对应于: a ~ π_θ(·)
        """
        probs = self.get_action_probabilities()
        action = np.random.choice(self.num_actions, p=probs)
        return action
        
    def compute_log_prob_gradient(self, action: int) -> np.ndarray:
        """
        计算 ∇_θ log π_θ(a) 对于给定的动作 a
        
        推导过程:
        
        1. log π_θ(a) = θ_a - log(Σ_a' exp(θ_a'))
        
        2. 对 θ_j 求偏导:
           - 如果 j == a: ∂/∂θ_j = 1 - π_θ(j)
           - 如果 j != a: ∂/∂θ_j = 0 - π_θ(j) = -π_θ(j)
           
        3. 合并: ∇_θ log π_θ(a) = e_a - π_θ
           其中 e_a 是第 a 个位置为1的one-hot向量
        
        返回值是一个长度为 num_actions 的向量. 
        """
        probs = self.get_action_probabilities()  # π_θ
        
        # e_a: one-hot向量
        one_hot_a = np.zeros(self.num_actions)
        one_hot_a[action] = 1.0
        
        # ∇_θ log π_θ(a) = e_a - π_θ
        grad = one_hot_a - probs
        
        return grad
        
    def update_parameters(self, gradient: np.ndarray, learning_rate: float):
        """
        使用计算出的梯度更新参数
        
        θ ← θ + α * gradient
        
        这是梯度上升(因为我们要最大化期望回报)
        """
        self.theta = self.theta + learning_rate * gradient

# ============================================
# 第三部分: REINFORCE算法实现
# ============================================

def reinforce_train(
    env: SimpleBanditEnv,
    policy: SoftmaxPolicy,
    config: Config
) -> List[float]:
    """
    REINFORCE算法主循环
    
    算法步骤:
    1. 使用当前策略 π_θ 采样动作
    2. 执行动作，观察奖励
    3. 计算梯度: ∇_θ log π_θ(a) * R
    4. 更新参数: θ ← θ + α * gradient
    
    Args:
        env: 环境
        policy: 参数化策略
        config: 配置
        
    Returns:
        episode_rewards: 每个回合的奖励列表
    """
    episode_rewards = []
    
    for episode in range(config.num_episodes):
        # === 步骤1: 采样动作 ===
        # a ~ π_θ(·)
        action = policy.sample_action()
        
        # === 步骤2: 与环境交互 ===
        # 获得奖励 R (在Bandit问题中，一步就结束)
        reward = env.step(action)
        episode_rewards.append(reward)
        
        # === 步骤3: 计算策略梯度 ===
        # ∇_θ log π_θ(a)
        grad_log_prob = policy.compute_log_prob_gradient(action)
        
        # 策略梯度 = ∇_θ log π_θ(a) * R
        # 这是策略梯度定理的核心公式!
        policy_gradient = grad_log_prob * reward
        
        # === 步骤4: 更新策略参数 ===
        # θ ← θ + α * gradient (梯度上升)
        policy.update_parameters(policy_gradient, config.learning_rate)
        
        # 每100个回合打印进度
        if (episode + 1) % 100 == 0:
            recent_avg = np.mean(episode_rewards[-100:])
            probs = policy.get_action_probabilities()
            print(f"Episode {episode+1}/{config.num_episodes}")
            print(f"  近100回合平均奖励: {recent_avg:.3f}")
            print(f"  当前策略概率: P(a=0)={probs[0]:.3f}, P(a=1)={probs[1]:.3f}, P(a=2)={probs[2]:.3f}")
            print(f"  最优动作: a=1 (期望奖励0.5)")
            print()
    
    return episode_rewards

# ============================================
# 第四部分: 可视化结果
# ============================================

def visualize_results(
    rewards: List[float], 
    policy: SoftmaxPolicy,
    env: SimpleBanditEnv
):
    """可视化训练结果"""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    
    # 图1: 奖励曲线
    ax1 = axes[0]
    window_size = 50
    smoothed_rewards = np.convolve(rewards, np.ones(window_size)/window_size, mode='valid')
    ax1.plot(smoothed_rewards, color='blue', label='Moving Average (50 episodes)')
    ax1.axhline(y=0.5, color='red', linestyle='--', label='Optimal Expected Reward')
    ax1.set_xlabel('Episode')
    ax1.set_ylabel('Average Reward')
    ax1.set_title('Training Curve')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    
    # 图2: 最终策略分布
    ax2 = axes[1]
    probs = policy.get_action_probabilities()
    bars = ax2.bar(['Action 0\n(E[R]=0.2)', 'Action 1\n(E[R]=0.5)', 'Action 2\n(E[R]=0.3)'], 
                   probs, color=['#3498db', '#2ecc71', '#e74c3c'])
    ax2.set_ylabel('Policy Probability π(a)')
    ax2.set_title('Learned Policy Distribution')
    ax2.set_ylim(0, 1)
    for bar, prob in zip(bars, probs):
        ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02, 
                f'{prob:.2%}', ha='center', fontsize=12)
    ax2.grid(True, alpha=0.3, axis='y')
    
    plt.tight_layout()
    plt.savefig('reinforce_results.png', dpi=150)
    print(">>> 结果图已保存为 reinforce_results.png")

# ============================================
# 第五部分: 主程序入口
# ============================================

if __name__ == "__main__":
    print("=" * 60)
    print("REINFORCE 算法演示 (多臂老虎机问题)")
    print("=" * 60)
    print()
    print("环境设置:")
    print("  - 动作0: 期望奖励 0.2")
    print("  - 动作1: 期望奖励 0.5 (最优)")
    print("  - 动作2: 期望奖励 0.3")
    print()
    print("目标: 策略应该学会选择动作1 (最高期望奖励)")
    print("=" * 60)
    print()
    
    # 初始化
    config = Config()
    env = SimpleBanditEnv()
    policy = SoftmaxPolicy(num_actions=env.num_actions)
    
    print("初始策略概率 (均匀分布):", policy.get_action_probabilities())
    print()
    
    # 训练
    rewards = reinforce_train(env, policy, config)
    
    # 可视化
    visualize_results(rewards, policy, env)
    
    print("=" * 60)
    print("训练完成!")
    print(f"最终策略: P(a=0)={policy.get_action_probabilities()[0]:.3f}, " +
          f"P(a=1)={policy.get_action_probabilities()[1]:.3f}, " +
          f"P(a=2)={policy.get_action_probabilities()[2]:.3f}")
    print("理论最优: P(a=1) ≈ 1.0 (选择期望奖励最高的动作)")
    print("=" * 60)
