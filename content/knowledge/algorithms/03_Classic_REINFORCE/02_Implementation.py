"""
算法名称: REINFORCE (蒙特卡洛策略梯度)
论文: Simple Statistical Gradient-Following Algorithms for Connectionist RL
作者: Ronald J. Williams
年份: 1992

功能: 完整的REINFORCE算法实现，可用于OpenAI Gym的CartPole环境
关联理论: 01_Theory_Derivation.md

核心公式:
$$\theta \leftarrow \theta + \alpha \nabla_\theta \log \pi_\theta(a_t|s_t) \cdot G_t$$

本代码包含:
1. 神经网络策略的定义 (PyTorch)
2. 轨迹采样模块
3. 回报计算模块
4. 策略梯度更新模块
5. 训练循环与可视化
"""

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import torch.nn.functional as F
from torch.distributions import Categorical
import matplotlib.pyplot as plt
from typing import List, Tuple, Dict
from dataclasses import dataclass
from collections import deque

# ============================================
# 第一部分: 配置类
# ============================================

@dataclass
class REINFORCEConfig:
    """REINFORCE算法超参数配置
    
    Attributes:
        env_name: 环境名称，默认使用CartPole-v1
        hidden_size: 策略网络隐藏层大小
        learning_rate: 学习率 α
        gamma: 折扣因子 γ
        num_episodes: 训练回合数
        max_steps: 每回合最大步数
        seed: 随机种子
        log_interval: 日志打印间隔
    """
    env_name: str = "CartPole-v1"
    hidden_size: int = 128
    learning_rate: float = 1e-2
    gamma: float = 0.99
    num_episodes: int = 1000
    max_steps: int = 500
    seed: int = 42
    log_interval: int = 100

# ============================================
# 第二部分: 策略网络
# ============================================

class PolicyNetwork(nn.Module):
    """
    参数化策略 π_θ(a|s)
    
    使用两层全连接神经网络:
    输入: 状态 s (维度: state_dim)
    输出: 动作概率分布 π(·|s) (维度: action_dim)
    
    网络结构:
    fc1: Linear(state_dim, hidden_size) + ReLU
    fc2: Linear(hidden_size, action_dim) + Softmax
    """
    def __init__(self, state_dim: int, action_dim: int, hidden_size: int = 128):
        super(PolicyNetwork, self).__init__()
        
        # 网络层定义
        self.fc1 = nn.Linear(state_dim, hidden_size)
        self.fc2 = nn.Linear(hidden_size, action_dim)
        
        # 保存维度信息
        self.state_dim = state_dim
        self.action_dim = action_dim
        
    def forward(self, state: torch.Tensor) -> torch.Tensor:
        """
        前向传播: 状态 → 动作概率
        
        数学表示:
        h = ReLU(W_1 · s + b_1)
        logits = W_2 · h + b_2
        π(·|s) = Softmax(logits)
        
        Args:
            state: 状态张量 [batch_size, state_dim]
            
        Returns:
            action_probs: 动作概率 [batch_size, action_dim]
        """
        x = F.relu(self.fc1(state))
        logits = self.fc2(x)
        action_probs = F.softmax(logits, dim=-1)
        return action_probs
    
    def select_action(self, state: np.ndarray) -> Tuple[int, torch.Tensor]:
        """
        根据当前策略采样动作
        
        对应理论:
        a ~ π_θ(·|s)
        
        同时返回动作的对数概率 log π_θ(a|s)，用于后续梯度计算
        
        Args:
            state: numpy数组形式的状态
            
        Returns:
            action: 采样的动作 (int)
            log_prob: 该动作的对数概率 (Tensor)
        """
        # 转换为Tensor
        state_tensor = torch.FloatTensor(state).unsqueeze(0)  # [1, state_dim]
        
        # 获取动作概率
        action_probs = self.forward(state_tensor)  # [1, action_dim]
        
        # 创建分类分布并采样
        dist = Categorical(action_probs)
        action = dist.sample()  # 采样动作
        
        # 计算对数概率 log π_θ(a|s)
        log_prob = dist.log_prob(action)
        
        return action.item(), log_prob

# ============================================
# 第三部分: 回报计算
# ============================================

def compute_returns(
    rewards: List[float], 
    gamma: float
) -> List[float]:
    """
    计算每个时刻的折扣回报 G_t
    
    数学公式:
    G_t = r_{t+1} + γ r_{t+2} + γ² r_{t+3} + ... + γ^{T-t-1} r_T
    
    高效递归实现:
    G_t = r_{t+1} + γ · G_{t+1}
    从后往前计算，时间复杂度 O(T)
    
    Args:
        rewards: 奖励列表 [r_1, r_2, ..., r_T]
        gamma: 折扣因子
        
    Returns:
        returns: 回报列表 [G_0, G_1, ..., G_{T-1}]
    """
    T = len(rewards)
    returns = [0.0] * T
    
    # G_{T-1} = r_T (最后一步)
    returns[T-1] = rewards[T-1]
    
    # 从后往前: G_t = r_{t+1} + γ · G_{t+1}
    for t in range(T-2, -1, -1):
        returns[t] = rewards[t] + gamma * returns[t+1]
    
    return returns

def normalize_returns(returns: List[float]) -> torch.Tensor:
    """
    标准化回报以降低方差
    
    公式: G'_t = (G_t - mean(G)) / (std(G) + ε)
    
    标准化的好处:
    1. 使梯度大小更稳定
    2. 让一半的更新增大概率，一半减小概率
    3. 对不同尺度的奖励更鲁棒
    
    Args:
        returns: 原始回报列表
        
    Returns:
        normalized: 标准化后的回报张量
    """
    returns_tensor = torch.FloatTensor(returns)
    
    # 计算均值和标准差
    mean = returns_tensor.mean()
    std = returns_tensor.std()
    
    # 标准化 (加小量避免除零)
    eps = 1e-8
    normalized = (returns_tensor - mean) / (std + eps)
    
    return normalized

# ============================================
# 第四部分: 策略梯度计算与更新
# ============================================

def compute_policy_loss(
    log_probs: List[torch.Tensor], 
    returns: torch.Tensor
) -> torch.Tensor:
    """
    计算策略梯度损失
    
    理论公式 (最大化):
    J(θ) = Σ_t log π_θ(a_t|s_t) · G_t
    
    PyTorch损失 (最小化):
    Loss = -J(θ) = -Σ_t log π_θ(a_t|s_t) · G_t
    
    Args:
        log_probs: 对数概率列表 [log π(a_0|s_0), log π(a_1|s_1), ...]
        returns: 标准化回报张量 [G_0, G_1, ...]
        
    Returns:
        loss: 策略损失标量
    """
    # 将log_probs列表转换为张量
    log_probs_tensor = torch.stack(log_probs)
    
    # 计算损失: -Σ log π · G
    # 负号是因为PyTorch做梯度下降，我们要最大化
    policy_loss = -(log_probs_tensor * returns).sum()
    
    return policy_loss

# ============================================
# 第五部分: REINFORCE智能体
# ============================================

class REINFORCEAgent:
    """
    REINFORCE智能体
    
    封装策略网络、优化器和训练逻辑
    """
    def __init__(self, state_dim: int, action_dim: int, config: REINFORCEConfig):
        self.config = config
        
        # 初始化策略网络
        self.policy = PolicyNetwork(state_dim, action_dim, config.hidden_size)
        
        # 优化器
        self.optimizer = optim.Adam(self.policy.parameters(), lr=config.learning_rate)
        
        # 训练过程中的记录
        self.log_probs: List[torch.Tensor] = []
        self.rewards: List[float] = []
        
    def select_action(self, state: np.ndarray) -> int:
        """
        选择动作并记录对数概率
        """
        action, log_prob = self.policy.select_action(state)
        self.log_probs.append(log_prob)
        return action
    
    def store_reward(self, reward: float):
        """
        存储奖励
        """
        self.rewards.append(reward)
    
    def update(self) -> float:
        """
        回合结束后更新策略
        
        REINFORCE算法核心步骤:
        1. 计算每步的回报 G_t
        2. 标准化回报
        3. 计算策略损失
        4. 反向传播更新参数
        5. 清空缓存
        
        Returns:
            loss_value: 本次更新的损失值
        """
        # 步骤1: 计算回报
        returns = compute_returns(self.rewards, self.config.gamma)
        
        # 步骤2: 标准化回报
        returns_normalized = normalize_returns(returns)
        
        # 步骤3: 计算损失
        loss = compute_policy_loss(self.log_probs, returns_normalized)
        
        # 步骤4: 梯度更新
        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()
        
        # 步骤5: 清空缓存
        loss_value = loss.item()
        self.log_probs = []
        self.rewards = []
        
        return loss_value

# ============================================
# 第六部分: 简单环境(用于测试)
# ============================================

class SimpleCartPoleEnv:
    """
    简化版CartPole环境(不依赖Gym)
    
    状态: [位置, 速度, 角度, 角速度]
    动作: 0 (向左推), 1 (向右推)
    奖励: 每步存活 +1
    终止: 角度过大或偏离过远
    """
    def __init__(self):
        self.state_dim = 4
        self.action_dim = 2
        self.gravity = 9.8
        self.cart_mass = 1.0
        self.pole_mass = 0.1
        self.pole_length = 0.5
        self.force_magnitude = 10.0
        self.tau = 0.02  # 时间步长
        
        self.state = None
        self.steps = 0
        
    def reset(self) -> np.ndarray:
        """重置环境"""
        self.state = np.random.uniform(low=-0.05, high=0.05, size=(4,))
        self.steps = 0
        return self.state.copy()
    
    def step(self, action: int) -> Tuple[np.ndarray, float, bool]:
        """
        执行一步
        
        Returns:
            next_state: 下一状态
            reward: 奖励
            done: 是否终止
        """
        x, x_dot, theta, theta_dot = self.state
        
        force = self.force_magnitude if action == 1 else -self.force_magnitude
        
        # 物理模拟(简化版)
        cos_theta = np.cos(theta)
        sin_theta = np.sin(theta)
        
        total_mass = self.cart_mass + self.pole_mass
        pole_mass_length = self.pole_mass * self.pole_length
        
        temp = (force + pole_mass_length * theta_dot**2 * sin_theta) / total_mass
        theta_acc = (self.gravity * sin_theta - cos_theta * temp) / \
                    (self.pole_length * (4.0/3.0 - self.pole_mass * cos_theta**2 / total_mass))
        x_acc = temp - pole_mass_length * theta_acc * cos_theta / total_mass
        
        # 欧拉积分
        x = x + self.tau * x_dot
        x_dot = x_dot + self.tau * x_acc
        theta = theta + self.tau * theta_dot
        theta_dot = theta_dot + self.tau * theta_acc
        
        self.state = np.array([x, x_dot, theta, theta_dot])
        self.steps += 1
        
        # 终止条件
        done = bool(
            x < -2.4 or x > 2.4 or
            theta < -0.209 or theta > 0.209 or
            self.steps >= 500
        )
        
        reward = 1.0 if not done else 0.0
        
        return self.state.copy(), reward, done

# ============================================
# 第七部分: 训练主循环
# ============================================

def train(config: REINFORCEConfig) -> Dict:
    """
    REINFORCE训练主函数
    
    Args:
        config: 配置对象
        
    Returns:
        results: 包含训练历史的字典
    """
    # 设置随机种子
    torch.manual_seed(config.seed)
    np.random.seed(config.seed)
    
    # 初始化环境
    env = SimpleCartPoleEnv()
    
    # 初始化智能体
    agent = REINFORCEAgent(
        state_dim=env.state_dim,
        action_dim=env.action_dim,
        config=config
    )
    
    # 训练记录
    episode_rewards = []
    running_reward = 10  # 初始化滑动平均奖励
    
    print("=" * 60)
    print("REINFORCE训练开始")
    print(f"配置: γ={config.gamma}, lr={config.learning_rate}")
    print("=" * 60)
    
    for episode in range(1, config.num_episodes + 1):
        state = env.reset()
        episode_reward = 0
        
        # 采集一个完整回合
        for step in range(config.max_steps):
            # 选择动作
            action = agent.select_action(state)
            
            # 与环境交互
            next_state, reward, done = env.step(action)
            
            # 存储奖励
            agent.store_reward(reward)
            episode_reward += reward
            
            state = next_state
            
            if done:
                break
        
        # 回合结束，更新策略
        loss = agent.update()
        
        # 记录
        episode_rewards.append(episode_reward)
        running_reward = 0.05 * episode_reward + 0.95 * running_reward
        
        # 日志
        if episode % config.log_interval == 0:
            print(f"Episode {episode}/{config.num_episodes}")
            print(f"  回合奖励: {episode_reward:.0f}")
            print(f"  滑动平均: {running_reward:.2f}")
            print(f"  损失: {loss:.4f}")
            print()
        
        # 提前终止条件
        if running_reward > 475:
            print(f"环境在 {episode} 回合后视为解决!")
            break
    
    return {
        "episode_rewards": episode_rewards,
        "final_running_reward": running_reward,
        "agent": agent
    }

# ============================================
# 第八部分: 可视化
# ============================================

def plot_training_curve(episode_rewards: List[float], save_path: str = None):
    """绘制训练曲线"""
    plt.figure(figsize=(12, 5))
    
    # 原始奖励
    plt.subplot(1, 2, 1)
    plt.plot(episode_rewards, alpha=0.4, label='Episode Reward')
    
    # 滑动平均
    window = 50
    if len(episode_rewards) >= window:
        smoothed = np.convolve(episode_rewards, np.ones(window)/window, mode='valid')
        plt.plot(range(window-1, len(episode_rewards)), smoothed, 
                label=f'Moving Average ({window} episodes)')
    
    plt.xlabel('Episode')
    plt.ylabel('Reward')
    plt.title('REINFORCE Training Curve')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # 奖励分布
    plt.subplot(1, 2, 2)
    plt.hist(episode_rewards, bins=30, edgecolor='black', alpha=0.7)
    plt.xlabel('Episode Reward')
    plt.ylabel('Frequency')
    plt.title('Reward Distribution')
    plt.axvline(x=np.mean(episode_rewards), color='red', linestyle='--',
                label=f'Mean: {np.mean(episode_rewards):.1f}')
    plt.legend()
    
    plt.tight_layout()
    
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"训练曲线已保存至 {save_path}")
    else:
        plt.show()

# ============================================
# 第九部分: 主程序入口
# ============================================

if __name__ == "__main__":
    # 创建配置
    config = REINFORCEConfig(
        num_episodes=500,
        learning_rate=0.01,
        gamma=0.99,
        hidden_size=64,
        log_interval=50
    )
    
    # 训练
    results = train(config)
    
    # 可视化
    plot_training_curve(results["episode_rewards"], 
                        save_path="reinforce_training_curve.png")
    
    print("=" * 60)
    print("训练完成!")
    print(f"最终滑动平均奖励: {results['final_running_reward']:.2f}")
    print("=" * 60)
