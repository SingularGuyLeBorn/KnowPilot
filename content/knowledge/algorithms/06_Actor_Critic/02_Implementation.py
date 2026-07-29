"""
算法名称: Advantage Actor-Critic (A2C)
类别: Classic RL / Policy Gradient

核心思想:
1. Actor (策略网络) 输出动作概率
2. Critic (价值网络) 输出状态价值 V(s)
3. 使用 TD Error 作为优势估计: A = r + gamma * V_next - V_curr
4. 熵正则化鼓励探索

核心公式:
L_policy = -log pi(a|s) * A.detach()
L_value = (V(s) - Target)^2
L_total = L_policy + 0.5 * L_value - 0.01 * Entropy
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import List, Tuple

class ActorCritic(nn.Module):
    def __init__(self, state_dim, action_dim, hidden_dim=128):
        super().__init__()
        # Shared Backbone (Feature Extractor)
        self.fc1 = nn.Linear(state_dim, hidden_dim)
        
        # Actor Head
        self.actor_head = nn.Linear(hidden_dim, action_dim)
        
        # Critic Head
        self.critic_head = nn.Linear(hidden_dim, 1)
        
    def forward(self, x):
        x = F.relu(self.fc1(x))
        
        # Actor: output logits
        action_logits = self.actor_head(x)
        action_probs = F.softmax(action_logits, dim=-1)
        
        # Critic: output scalar value
        state_value = self.critic_head(x)
        
        return action_probs, state_value

def compute_a2c_loss(
    action_probs: torch.Tensor,
    values: torch.Tensor,
    returns: torch.Tensor,
    actions: torch.Tensor,
    entropy_coef: float = 0.01,
    value_loss_coef: float = 0.5
):
    """
    计算A2C损失
    
    Args:
        action_probs: [Batch, ActionDim]
        values: [Batch, 1] 预测的V(s)
        returns: [Batch, 1] 真实的G_t (Target)
        actions: [Batch] 实际采取的动作索引
    """
    # 1. Advantage Calculation
    # A = Target - V(s)
    advantages = returns - values
    
    # 2. Policy Loss
    dist = torch.distributions.Categorical(action_probs)
    log_probs = dist.log_prob(actions)
    
    # Detach advantage to prevent gradients flowing to Critic via Actor loss
    policy_loss = -(log_probs * advantages.detach()).mean()
    
    # 3. Value Loss (MSE)
    value_loss = F.mse_loss(values, returns)
    
    # 4. Entropy Loss (Maximize Entropy)
    entropy = dist.entropy().mean()
    
    # Total Loss
    total_loss = policy_loss + value_loss_coef * value_loss - entropy_coef * entropy
    
    return total_loss, {
        "policy_loss": policy_loss.item(),
        "value_loss": value_loss.item(),
        "entropy": entropy.item()
    }

def compute_gae(
    rewards: List[float], 
    values: List[float], 
    next_value: float, 
    gamma: float = 0.99, 
    lam: float = 0.95
):
    """
    广义优势估计 (GAE)
    A_t = delta_t + gamma * lambda * A_{t+1}
    delta_t = r_t + gamma * V_{t+1} - V_t
    """
    gae = 0
    returns = []
    
    # 从后往前遍历
    values = values + [next_value] # Append V_last
    
    for t in reversed(range(len(rewards))):
        delta = rewards[t] + gamma * values[t+1] - values[t]
        gae = delta + gamma * lam * gae
        
        # Return = Advantage + Value
        ret = gae + values[t]
        returns.insert(0, ret)
        
    return torch.tensor(returns).float().unsqueeze(1)
