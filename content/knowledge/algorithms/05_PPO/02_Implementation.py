"""
算法名称: PPO (Proximal Policy Optimization)
论文: Proximal Policy Optimization Algorithms
作者: John Schulman et al. (OpenAI)
年份: 2017
arXiv: 1707.06347

功能: 完整的PPO算法实现，包含Actor-Critic架构
关联理论: 01_Theory_Derivation.md

核心公式:
$$L^{CLIP}(\theta) = \mathbb{E}_t[\min(r_t(\theta)A_t, \text{clip}(r_t, 1-\epsilon, 1+\epsilon)A_t)]$$
"""

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import torch.nn.functional as F
from torch.distributions import Categorical
import matplotlib.pyplot as plt
from typing import List, Tuple, Dict, Optional
from dataclasses import dataclass, field
from collections import deque

# ============================================
# 第一部分: 配置类
# ============================================

@dataclass
class PPOConfig:
    """PPO算法超参数配置
    
    所有超参数的详细说明请参考 01_Theory_Derivation.md
    """
    # 环境参数
    state_dim: int = 4        # 状态空间维度 (CartPole: 4)
    action_dim: int = 2       # 动作空间维度 (CartPole: 2)
    
    # 网络参数
    hidden_size: int = 64     # 隐藏层大小
    
    # PPO核心参数
    clip_epsilon: float = 0.2      # 裁剪参数 ε
    gamma: float = 0.99            # 折扣因子 γ
    gae_lambda: float = 0.95       # GAE参数 λ
    
    # 训练参数
    learning_rate: float = 3e-4    # 学习率
    num_epochs: int = 4            # 每批数据的优化轮数 K
    batch_size: int = 64           # 小批量大小
    
    # 损失系数
    value_coef: float = 0.5        # 价值损失系数 c_1
    entropy_coef: float = 0.01     # 熵正则化系数 c_2
    
    # 采集参数
    rollout_steps: int = 2048      # 每次采集的步数
    num_updates: int = 100         # 总更新次数
    
    # 其他
    max_grad_norm: float = 0.5     # 梯度裁剪
    seed: int = 42

# ============================================
# 第二部分: Actor-Critic网络
# ============================================

class ActorCritic(nn.Module):
    """
    Actor-Critic网络
    
    共享底层特征提取器，分别输出:
    - Actor (策略头): 动作概率分布 π(a|s)
    - Critic (价值头): 状态价值 V(s)
    
    这种设计在LLM-PPO中也广泛使用(添加Value Head)
    """
    def __init__(self, state_dim: int, action_dim: int, hidden_size: int):
        super().__init__()
        
        # 共享特征提取层
        self.shared = nn.Sequential(
            nn.Linear(state_dim, hidden_size),
            nn.Tanh(),
            nn.Linear(hidden_size, hidden_size),
            nn.Tanh()
        )
        
        # 策略头 (Actor)
        # 输出: 动作空间上的logits
        self.actor_head = nn.Linear(hidden_size, action_dim)
        
        # 价值头 (Critic)
        # 输出: 标量价值估计 V(s)
        self.critic_head = nn.Linear(hidden_size, 1)
        
    def forward(self, state: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        前向传播
        
        Args:
            state: 状态张量 [batch_size, state_dim]
            
        Returns:
            action_logits: 动作logits [batch_size, action_dim]
            value: 状态价值 [batch_size, 1]
        """
        features = self.shared(state)
        action_logits = self.actor_head(features)
        value = self.critic_head(features)
        return action_logits, value
    
    def get_action_and_value(
        self, 
        state: torch.Tensor, 
        action: Optional[torch.Tensor] = None
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        获取动作及相关量
        
        用于:
        1. 采样时: action=None，返回采样的动作
        2. 更新时: action给定，返回该动作的log_prob(用于计算概率比)
        
        Args:
            state: 状态
            action: 如果给定，计算该动作的log_prob; 否则采样新动作
            
        Returns:
            action: 动作
            log_prob: log π(a|s)
            entropy: 策略熵
            value: V(s)
        """
        logits, value = self.forward(state)
        
        # 创建分类分布
        probs = F.softmax(logits, dim=-1)
        dist = Categorical(probs)
        
        if action is None:
            action = dist.sample()
        
        # 计算对数概率
        log_prob = dist.log_prob(action)
        
        # 计算熵(用于熵正则化)
        entropy = dist.entropy()
        
        return action, log_prob, entropy, value.squeeze(-1)

# ============================================
# 第三部分: 经验回放缓冲区
# ============================================

class RolloutBuffer:
    """
    滚动缓冲区
    
    存储采集的轨迹数据，用于PPO更新
    不同于DQN的经验回放，PPO用完数据后就丢弃
    """
    def __init__(self):
        self.states = []
        self.actions = []
        self.log_probs = []      # log π_old(a|s)，用于计算概率比
        self.rewards = []
        self.values = []
        self.dones = []
        
        # 计算后得到的量
        self.advantages = []
        self.returns = []        # 目标价值
        
    def add(
        self,
        state: np.ndarray,
        action: int,
        log_prob: float,
        reward: float,
        value: float,
        done: bool
    ):
        """添加一步经验"""
        self.states.append(state)
        self.actions.append(action)
        self.log_probs.append(log_prob)
        self.rewards.append(reward)
        self.values.append(value)
        self.dones.append(done)
        
    def compute_returns_and_advantages(
        self, 
        last_value: float,
        gamma: float,
        gae_lambda: float
    ):
        """
        计算GAE优势和目标价值
        
        公式 (GAE):
        δ_t = r_t + γ V(s_{t+1}) - V(s_t)
        A_t = δ_t + γλ A_{t+1}
        
        从后往前递归计算
        """
        T = len(self.rewards)
        self.advantages = [0.0] * T
        self.returns = [0.0] * T
        
        # 从最后一步开始
        gae = 0
        for t in reversed(range(T)):
            if t == T - 1:
                next_value = last_value
                next_non_terminal = 1.0 - float(self.dones[t])
            else:
                next_value = self.values[t + 1]
                next_non_terminal = 1.0 - float(self.dones[t])
            
            # TD误差: δ_t = r_t + γ * V(s') - V(s)
            delta = self.rewards[t] + gamma * next_value * next_non_terminal - self.values[t]
            
            # GAE: A_t = δ_t + γλ * A_{t+1}
            gae = delta + gamma * gae_lambda * next_non_terminal * gae
            self.advantages[t] = gae
            
            # 目标价值: V_target = A_t + V(s_t)
            self.returns[t] = gae + self.values[t]
    
    def get_batches(self, batch_size: int):
        """
        将数据划分为小批量
        
        用于SGD优化
        """
        indices = np.arange(len(self.states))
        np.random.shuffle(indices)
        
        for start in range(0, len(self.states), batch_size):
            end = start + batch_size
            batch_indices = indices[start:end]
            
            yield (
                torch.FloatTensor(np.array([self.states[i] for i in batch_indices])),
                torch.LongTensor([self.actions[i] for i in batch_indices]),
                torch.FloatTensor([self.log_probs[i] for i in batch_indices]),
                torch.FloatTensor([self.advantages[i] for i in batch_indices]),
                torch.FloatTensor([self.returns[i] for i in batch_indices])
            )
    
    def clear(self):
        """清空缓冲区"""
        self.states = []
        self.actions = []
        self.log_probs = []
        self.rewards = []
        self.values = []
        self.dones = []
        self.advantages = []
        self.returns = []

# ============================================
# 第四部分: PPO损失计算
# ============================================

def compute_ppo_loss(
    old_log_probs: torch.Tensor,
    new_log_probs: torch.Tensor,
    advantages: torch.Tensor,
    clip_epsilon: float
) -> torch.Tensor:
    """
    计算PPO-Clip策略损失
    
    公式:
    L^CLIP = E[min(r_t * A_t, clip(r_t, 1-ε, 1+ε) * A_t)]
    
    其中 r_t = exp(log π_new - log π_old) = π_new / π_old
    
    Args:
        old_log_probs: log π_old(a|s)
        new_log_probs: log π_θ(a|s)
        advantages: 优势 A_t
        clip_epsilon: 裁剪参数 ε
        
    Returns:
        policy_loss: 策略损失(取负号因为要最大化)
    """
    # 计算概率比 r_t = π_new / π_old = exp(log_new - log_old)
    ratio = torch.exp(new_log_probs - old_log_probs)
    
    # 原始目标: r_t * A_t
    surr1 = ratio * advantages
    
    # 裁剪目标: clip(r_t, 1-ε, 1+ε) * A_t
    surr2 = torch.clamp(ratio, 1.0 - clip_epsilon, 1.0 + clip_epsilon) * advantages
    
    # PPO目标: min(surr1, surr2)
    # 取负号转化为损失(要最小化)
    policy_loss = -torch.min(surr1, surr2).mean()
    
    return policy_loss

# ============================================
# 第五部分: PPO智能体
# ============================================

class PPOAgent:
    """
    PPO智能体
    
    封装网络、优化器和训练逻辑
    """
    def __init__(self, config: PPOConfig):
        self.config = config
        
        # 初始化网络
        self.network = ActorCritic(
            config.state_dim,
            config.action_dim,
            config.hidden_size
        )
        
        # 优化器
        self.optimizer = optim.Adam(
            self.network.parameters(),
            lr=config.learning_rate
        )
        
        # 经验缓冲区
        self.buffer = RolloutBuffer()
        
    def select_action(self, state: np.ndarray) -> Tuple[int, float, float]:
        """
        选择动作
        
        Returns:
            action: 动作
            log_prob: 对数概率
            value: 状态价值
        """
        state_t = torch.FloatTensor(state).unsqueeze(0)
        
        with torch.no_grad():
            action, log_prob, _, value = self.network.get_action_and_value(state_t)
        
        return action.item(), log_prob.item(), value.item()
    
    def update(self) -> Dict[str, float]:
        """
        PPO更新
        
        使用缓冲区中的数据进行多轮优化
        
        Returns:
            logs: 训练日志
        """
        # 标准化优势(减少方差)
        advantages = torch.FloatTensor(self.buffer.advantages)
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
        self.buffer.advantages = advantages.tolist()
        
        # 记录
        total_policy_loss = 0
        total_value_loss = 0
        total_entropy = 0
        num_batches = 0
        
        # K轮优化
        for _ in range(self.config.num_epochs):
            for batch in self.buffer.get_batches(self.config.batch_size):
                states, actions, old_log_probs, advs, returns = batch
                
                # 获取新策略的输出
                _, new_log_probs, entropy, new_values = \
                    self.network.get_action_and_value(states, actions)
                
                # 策略损失 (PPO-Clip)
                policy_loss = compute_ppo_loss(
                    old_log_probs,
                    new_log_probs,
                    advs,
                    self.config.clip_epsilon
                )
                
                # 价值损失 (MSE)
                value_loss = F.mse_loss(new_values, returns)
                
                # 熵正则化(鼓励探索)
                entropy_loss = -entropy.mean()
                
                # 总损失
                loss = (
                    policy_loss +
                    self.config.value_coef * value_loss +
                    self.config.entropy_coef * entropy_loss
                )
                
                # 梯度更新
                self.optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(
                    self.network.parameters(),
                    self.config.max_grad_norm
                )
                self.optimizer.step()
                
                # 记录
                total_policy_loss += policy_loss.item()
                total_value_loss += value_loss.item()
                total_entropy += entropy.mean().item()
                num_batches += 1
        
        # 清空缓冲区
        self.buffer.clear()
        
        return {
            "policy_loss": total_policy_loss / num_batches,
            "value_loss": total_value_loss / num_batches,
            "entropy": total_entropy / num_batches
        }

# ============================================
# 第六部分: 简单环境(CartPole模拟)
# ============================================

class SimpleCartPoleEnv:
    """简化版CartPole环境"""
    def __init__(self):
        self.gravity = 9.8
        self.cart_mass = 1.0
        self.pole_mass = 0.1
        self.pole_length = 0.5
        self.force_magnitude = 10.0
        self.tau = 0.02
        self.state = None
        self.steps = 0
        
    def reset(self) -> np.ndarray:
        self.state = np.random.uniform(low=-0.05, high=0.05, size=(4,))
        self.steps = 0
        return self.state.copy()
    
    def step(self, action: int) -> Tuple[np.ndarray, float, bool]:
        x, x_dot, theta, theta_dot = self.state
        force = self.force_magnitude if action == 1 else -self.force_magnitude
        
        cos_theta = np.cos(theta)
        sin_theta = np.sin(theta)
        total_mass = self.cart_mass + self.pole_mass
        pole_mass_length = self.pole_mass * self.pole_length
        
        temp = (force + pole_mass_length * theta_dot**2 * sin_theta) / total_mass
        theta_acc = (self.gravity * sin_theta - cos_theta * temp) / \
                    (self.pole_length * (4.0/3.0 - self.pole_mass * cos_theta**2 / total_mass))
        x_acc = temp - pole_mass_length * theta_acc * cos_theta / total_mass
        
        x = x + self.tau * x_dot
        x_dot = x_dot + self.tau * x_acc
        theta = theta + self.tau * theta_dot
        theta_dot = theta_dot + self.tau * theta_acc
        
        self.state = np.array([x, x_dot, theta, theta_dot])
        self.steps += 1
        
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

def train_ppo(config: PPOConfig) -> Dict:
    """PPO训练主函数"""
    torch.manual_seed(config.seed)
    np.random.seed(config.seed)
    
    env = SimpleCartPoleEnv()
    agent = PPOAgent(config)
    
    # 记录
    all_rewards = []
    all_lengths = []
    
    print("=" * 60)
    print(f"PPO训练开始 | ε={config.clip_epsilon} | K={config.num_epochs}")
    print("=" * 60)
    
    state = env.reset()
    episode_reward = 0
    episode_length = 0
    
    for update in range(1, config.num_updates + 1):
        # 采集rollout_steps步
        for _ in range(config.rollout_steps):
            action, log_prob, value = agent.select_action(state)
            next_state, reward, done = env.step(action)
            
            agent.buffer.add(state, action, log_prob, reward, value, done)
            
            episode_reward += reward
            episode_length += 1
            state = next_state
            
            if done:
                all_rewards.append(episode_reward)
                all_lengths.append(episode_length)
                episode_reward = 0
                episode_length = 0
                state = env.reset()
        
        # 计算最后一个状态的价值
        with torch.no_grad():
            _, _, _, last_value = agent.network.get_action_and_value(
                torch.FloatTensor(state).unsqueeze(0)
            )
        
        # 计算GAE和目标价值
        agent.buffer.compute_returns_and_advantages(
            last_value.item(),
            config.gamma,
            config.gae_lambda
        )
        
        # PPO更新
        logs = agent.update()
        
        # 打印日志
        if update % 10 == 0 and len(all_rewards) > 0:
            recent_rewards = all_rewards[-20:]
            print(f"Update {update}/{config.num_updates}")
            print(f"  平均奖励: {np.mean(recent_rewards):.1f}")
            print(f"  策略损失: {logs['policy_loss']:.4f}")
            print(f"  价值损失: {logs['value_loss']:.4f}")
            print(f"  熵: {logs['entropy']:.4f}")
            print()
    
    return {"rewards": all_rewards, "lengths": all_lengths, "agent": agent}

# ============================================
# 第八部分: 可视化
# ============================================

def plot_ppo_results(rewards: List[float], save_path: str = None):
    """绘制PPO训练结果"""
    plt.figure(figsize=(12, 5))
    
    plt.subplot(1, 2, 1)
    plt.plot(rewards, alpha=0.4)
    window = min(50, len(rewards) // 5) if len(rewards) > 10 else 1
    if window > 1:
        smoothed = np.convolve(rewards, np.ones(window)/window, mode='valid')
        plt.plot(range(window-1, len(rewards)), smoothed, label=f'MA-{window}')
    plt.xlabel('Episode')
    plt.ylabel('Reward')
    plt.title('PPO Training Curve')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    plt.subplot(1, 2, 2)
    plt.hist(rewards, bins=30, edgecolor='black', alpha=0.7)
    plt.axvline(x=np.mean(rewards), color='red', linestyle='--',
                label=f'Mean: {np.mean(rewards):.1f}')
    plt.xlabel('Episode Reward')
    plt.ylabel('Frequency')
    plt.title('Reward Distribution')
    plt.legend()
    
    plt.tight_layout()
    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"结果已保存至 {save_path}")
    plt.close()

# ============================================
# 主程序
# ============================================

if __name__ == "__main__":
    config = PPOConfig(
        num_updates=50,
        rollout_steps=512,
        num_epochs=4,
        clip_epsilon=0.2
    )
    
    results = train_ppo(config)
    plot_ppo_results(results["rewards"], "ppo_training_curve.png")
    
    print("=" * 60)
    print("训练完成!")
    print(f"最终平均奖励: {np.mean(results['rewards'][-20:]):.1f}")
    print("=" * 60)
