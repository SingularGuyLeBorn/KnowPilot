"""
算法名称: Trust Region Policy Optimization (TRPO)
论文: Trust Region Policy Optimization
作者: John Schulman et al.
年份: 2015
arXiv: 1502.05477

核心创新:
1. 信任区域约束: D_KL(theta_old || theta) <= delta
2. 自然梯度: sum_t g^T H^-1 g
3. 共轭梯度法: 高效求解 Hx = g

核心公式:
$$
\theta_{k+1} = \theta_k + \sqrt{\frac{2\delta}{g^T H^{-1} g}} H^{-1} g
$$

注意: 这是一个简化版实现，用于教学目的，展示CG和Hv product的核心逻辑. 
"""

import torch
import torch.nn as nn
from torch.autograd import grad
from typing import List, Callable

# ============================================
# 第一部分: 共轭梯度算法 (Conjugate Gradient)
# ============================================

def conjugate_gradient(
    Ax_fn: Callable[[torch.Tensor], torch.Tensor],
    b: torch.Tensor,
    n_steps: int = 10,
    residual_tol: float = 1e-10
) -> torch.Tensor:
    """
    使用共轭梯度法求解线性方程 Ax = b
    
    Args:
        Ax_fn: 一个函数，输入向量x，输出矩阵乘积Ax (Hessian-vector product)
        b: 目标向量 (梯度g)
        n_steps: 迭代次数
    
    Returns:
        x: 近似解 H^-1 g
    """
    x = torch.zeros_like(b)
    r = b.clone() # 残差 r_0 = b - Ax_0 = b (因为x_0=0)
    p = r.clone() # 搜索方向 p_0 = r_0
    rdotr = torch.dot(r, r)
    
    for _ in range(n_steps):
        Ap = Ax_fn(p)
        alpha = rdotr / (torch.dot(p, Ap) + 1e-8)
        x += alpha * p
        r -= alpha * Ap
        new_rdotr = torch.dot(r, r)
        
        if new_rdotr < residual_tol:
            break
            
        beta = new_rdotr / rdotr
        p = r + beta * p
        rdotr = new_rdotr
        
    return x

# ============================================
# 第二部分: Hessian-Vector Product
# ============================================

def compute_fisher_vector_product(
    model: nn.Module,
    states: torch.Tensor,
    p_vector: torch.Tensor,
    damping: float = 0.1
) -> torch.Tensor:
    """
    计算 Fisher Information Matrix 与向量 p 的乘积 (FIM * p)
    使用 Pearlmutter技巧 (两次反向传播)
    
    Args:
        model: 策略网络
        states: 状态输入
        p_vector: 待乘向量
    """
    # 1. 前向传播计算KL散度
    # KL(pi_old || pi_new) 在 theta_old 处的一阶导为0，我们需要Hessian
    # 等价于求 D_KL 的二阶导
    
    logits = model(states)
    probs = torch.softmax(logits, dim=-1)
    action_dist = torch.distributions.Categorical(probs)
    
    # 使用detach的概率作为old分布 (固定住)
    old_probs = probs.detach()
    old_dist = torch.distributions.Categorical(old_probs)
    
    kl = torch.distributions.kl_divergence(old_dist, action_dist).mean()
    
    # 2. 求一次梯度: grads = grad(KL, theta)
    params = list(model.parameters())
    grads = torch.autograd.grad(kl, params, create_graph=True)
    flat_grad = torch.cat([g.view(-1) for g in grads])
    
    # 3. 计算 grad * p
    kl_v = torch.dot(flat_grad, p_vector)
    
    # 4. 求二次梯度: grad(grad * p, theta) = H * p
    grads_2nd = torch.autograd.grad(kl_v, params)
    flat_grad_2nd = torch.cat([g.contiguous().view(-1) for g in grads_2nd])
    
    # 添加阻尼项防止Hessian奇异: (H + damping * I) p = Hp + damping * p
    return flat_grad_2nd + damping * p_vector

# ============================================
# 第三部分: TRPO核心步骤
# ============================================

def trpo_step(
    model: nn.Module,
    states: torch.Tensor,
    actions: torch.Tensor,
    advantages: torch.Tensor,
    max_kl: float = 0.01,
    damping: float = 0.1
):
    """
    执行一步TRPO更新
    """
    # 1. 计算目标函数梯度 g
    logits = model(states)
    probs = torch.softmax(logits, dim=-1)
    dist = torch.distributions.Categorical(probs)
    
    # 这是一个简化，假设 importance sampling ratio = 1 (在起点theta_old)
    # 实际应计算 ratio * advantage
    log_probs = dist.log_prob(actions)
    loss = -(log_probs * advantages).mean()
    
    params = list(model.parameters())
    grads = torch.autograd.grad(loss, params)
    g = torch.cat([grad.view(-1) for grad in grads])
    
    # 2. 定义 FIM-vector product 函数
    def Fvp(v):
        return compute_fisher_vector_product(model, states, v, damping)
    
    # 3. 共轭梯度法求解 Hx = g -> x = H^-1 g
    # 注意: 我们通常求解 Hs = g，方向是 H^-1 g
    step_dir = conjugate_gradient(Fvp, -g) # 梯度下降方向是 -g
    
    # 4. 计算步长 beta
    # beta = sqrt(2 * delta / (s^T H s))
    shs = torch.dot(step_dir, Fvp(step_dir))
    lagrange_multiplier = torch.sqrt(2 * max_kl / (shs + 1e-8))
    full_step = lagrange_multiplier * step_dir
    
    # 5. 更新参数 (这里省略了 Line Search，直接更新)
    new_params = torch.cat([p.view(-1) for p in params]) + full_step
    
    # 将flat parameters填回模型
    # (实际代码需要更复杂的 unflatten 逻辑)
    return True
