# Theory to Practice: RL Scaling Laws

## 1. 核心映射 (Core Mapping)

这一章通过代码将 Meta 的 Scale 论文中的经验公式转化为可执行的预算规划器. 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 (Implementation.py) |
| :--- | :--- | :--- |
| **Critic Capacity** | `req = policy_size ** 1.2` | Line 30 |
| **SNR Decay** | `exp(-kappa * L) / sqrt(L)` | Line 50 |
| **Temperature Decay** | `tau = C ** -0.25` | Line 65 |

---

## 2. 关键代码解析

### 2.1 临界容量检测

```python
# 02_Implementation.py
def simulate_critic_stability(policy_size, ...):
    required = policy_size ** 1.2
    if critic_size < required:
        return "COLLAPSE"
```

**理论依据**:
这是 Scaling Law 最直接的应用. 它告诉工程师: 当你把 Policy升级为 70B 时，不要复用旧的 7B Critic，否则训练必挂. 

### 2.2 温度规划

```python
# 02_Implementation.py
def optimal_temperature(compute):
    # normalized compute
    return (compute / 1e18) ** -0.25
```

**工程意义**:
这指导我们在部署大模型服务时，超参数 `temperature` 不应该凭感觉设，而应该根据模型的 FLOPs 估算出一个理论最优起点. 

---

## 3. 实际应用场景

*   **集群采购**: 在购买 GPU 之前，先运行这个 Script，计算你需要多少显存来存 Critic. 
*   **任务规划**: 根据任务的推理长度 $L$，判断是否需要启用 PRM. 如果 `simulate_snr_decay(L)` 输出过低，则立项做 PRM 标注. 

---

## 4. 总结

理论不仅仅是解释过去的，更是预测未来的. 
这个代码模块就是 RL 训练的 "指南针". 
