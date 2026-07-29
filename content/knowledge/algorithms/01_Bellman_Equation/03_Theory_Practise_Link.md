# 理论与实践的桥梁: 从公式到迭代 (Theory to Iteration)

## 1. 为什么代码里有个 While True 循环？

### 理论视角
贝尔曼最优方程是一个**不动点方程 (Fixed Point Equation)** : 
$$ V = T^*(V) $$
其中 $T^*$ 是贝尔曼最优算子. 压缩映射定理 (Contraction Mapping Theorem) 保证了无论初始值 $V_0$ 是什么，只要不断应用 $T^*$，序列 $V_k$ 最终都会收敛到唯一的 $V^*$. 

### 代码实现
```python
while True:
    new_V = V.copy()
    # ... 计算 Bellman Update ...
    if delta < theta:  # 收敛判据
        break
```
代码中的循环正是 $V_{k+1} = T^*(V_k)$ 的直接体现. 

## 2. $\max$ 操作去哪了？

### 理论公式
$$ V^*(s) = \max_{a} (R + \gamma \sum P V^*) $$

### 代码对应
```python
q_values = []
for a in env.actions:
    # 计算 Q(s,a)
    q_v = r + env.gamma * V[ns]
    q_values.append(q_v)

# 取最大值对应的 max 操作
best_value = max(q_values)
```
这里 `best_value` 就是 $V^*(s)$ 的新估计值. 如果我们还需要策略 $\pi^*$，只需要 `argmax(q_values)`. 

## 3. 确定性 vs 随机性 (Deterministic vs Stochastic)

在我们的简单网格代码中: 
```python
ns, r = env.get_transition(s, a)
```
这是一个**确定性环境**(概率 $P=1$). 所以在贝尔曼更新中，$\sum_{s'} P(s'|s,a) V(s')$ 退化为单项 $1.0 \times V(ns)$. 

如果环境是随机的(比如 10% 概率滑向反方向)，我们就需要: 
```python
expected_value = 0
for next_state, prob in transitions:
    expected_value += prob * V[next_state]
```
这对应了理论公式中的 $\sum_{s'}$ 部分. 

## 4. 总结

- **Value Iteration** 算法就是将数学上的 **Fixed Point Iteration** 翻译成了计算机的 **While Loop**. 
- **Discount Factor $\gamma$** 保证了数值稳定性(避免无穷大). 
