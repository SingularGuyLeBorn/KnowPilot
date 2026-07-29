# Theory to Practice: TRPO (Trust Region Policy Optimization)

## 1. 核心映射 (Core Mapping)

TRPO 是现代 RL 的数学巅峰之一，它用精确的二阶优化替代了一阶 SGD. 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 (Implementation.py) |
| :--- | :--- | :--- |
| **信任域约束 (Trust Region)** | `KL(old || new) <= delta` | Line 120 (Line Search Check) |
| **自然梯度 (Natural Gradient)** | $H^{-1} g$ | Line 85 (Conjugate Gradient) |
| **海森向量积 (HVP)** | $\nabla (\nabla KL \cdot v)$ | Line 65 `hessian_vector_product` |

---

## 2. 关键代码解析

### 2.1 共轭梯度法 (Conjugate Gradient)

我们无法直接计算 Hessian 矩阵 $H$ 的逆(参数量太大). 
TRPO 利用 CG 算法近似计算 $x = H^{-1} g$. 

```python
# 02_Implementation.py
def conjugate_gradient(f_Ax, b, cg_iters=10):
    # Solves Ax = b iteratively
    r = b.clone()
    p = r.clone()
    for i in range(cg_iters):
        Ap = f_Ax(p) # Hessian-Vector Product
        alpha = rs_old / (p * Ap).sum()
        x += alpha * p
        ...
```

**理论解释**:
HVP 允许我们只计算 $\nabla^2 f \cdot v$，这可以通过两次反向传播 (Double Backprop) 在 $O(N)$ 时间内完成，而不需要构建 $O(N^2)$ 的 Hessian 矩阵. 这是 TRPO 能跑起来的关键. 

### 2.2 线性搜索 (Line Search)

即便方向对了，步长太大也会破坏 KL 约束. 
TRPO 使用回溯线性搜索: 

```python
# 02_Implementation.py
for step_frac in [1, 0.5, 0.25, ...]:
    new_params = params + step_frac * full_step
    if improvement > 0 and kl_dist <= delta:
        accept()
```

---

## 3. 工程实现的挑战

*   **计算昂贵**: 每次更新需要多次前向和反向传播来计算 HVP 和 Line Search. 
*   **PPO 的崛起**: PPO 通过简单的 Clipping 模拟了 TRPO 的行为，虽然理论上是近似，但工程上快得多. 

---

## 4. 总结

TRPO 是 RL 中的"贵族". 它严谨、优雅，但难以在大规模分布式系统中生存. 
理解 TRPO 是理解 PPO 的前提. 
