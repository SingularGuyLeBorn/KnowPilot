"""
算法名称: 价值迭代 (Value Iteration)
功能: 通过求解贝尔曼最优方程，在一个简单的 GridWorld 环境中找到最优策略. 
关联理论: 01_Theory_Derivation.md - 贝尔曼最优方程

核心逻辑:
我们迭代应用贝尔曼最优算子 T^* 直到收敛: 
$$ V_{k+1}(s) = \max_a (R(s,a) + \gamma \sum_{s'} P(s'|s,a) V_k(s')) $$
"""

import numpy as np
import matplotlib.pyplot as plt
from typing import Dict, List, Tuple

# ============================================
# 第一部分: 定义简单的 GridWorld MDP
# ============================================

class SimpleGridWorld:
    """
    一个 3x3 的网格世界:
    S = {(0,0), ..., (2,2)}
    A = {Up, Down, Left, Right}
    Goal = (2,2) with Reward +1
    Trap = (1,1) with Reward -1
    Step Reward = 0
    """
    def __init__(self):
        self.rows = 3
        self.cols = 3
        self.states = [(r, c) for r in range(self.rows) for c in range(self.cols)]
        self.actions = ['Up', 'Down', 'Left', 'Right']
        self.goal_state = (2, 2)
        self.trap_state = (1, 1)
        self.gamma = 0.9
        
    def get_transition(self, s: Tuple[int, int], a: str) -> Tuple[Tuple[int, int], float]:
        """
        确定性转移: 返回 (next_state, reward)
        """
        if s == self.goal_state or s == self.trap_state:
            return s, 0.0  # 终止状态，无奖励循环
        
        r, c = s
        if a == 'Up':    nr, nc = max(0, r-1), c
        elif a == 'Down':  nr, nc = min(self.rows-1, r+1), c
        elif a == 'Left':  nr, nc = r, max(0, c-1)
        elif a == 'Right': nr, nc = r, min(self.cols-1, c+1)
        else: nr, nc = r, c
            
        ns = (nr, nc)
        
        reward = 0.0
        if ns == self.goal_state:
            reward = 1.0
        elif ns == self.trap_state:
            reward = -1.0
            
        return ns, reward

# ============================================
# 第二部分: 价值迭代算法实现
# ============================================

def value_iteration(env: SimpleGridWorld, theta: float = 1e-4):
    """
    求解最优价值函数 V*
    """
    # 初始化 V(s) = 0
    V = {s: 0.0 for s in env.states}
    
    iteration = 0
    while True:
        delta = 0
        new_V = V.copy()
        
        for s in env.states:
            if s == env.goal_state or s == env.trap_state:
                continue
                
            q_values = []
            for a in env.actions:
                ns, r = env.get_transition(s, a)
                # Bellman Optimality Equation
                q_v = r + env.gamma * V[ns]
                q_values.append(q_v)
            
            best_value = max(q_values)
            delta = max(delta, abs(best_value - V[s]))
            new_V[s] = best_value
            
        V = new_V
        iteration += 1
        
        if delta < theta:
            break
            
    print(f"Converged after {iteration} iterations.")
    return V

# ============================================
# 第三部分: 可视化与验证
# ============================================

def visualize_values(env: SimpleGridWorld, V: Dict):
    """打印网格价值"""
    print("\nState Values:")
    grid = np.zeros((env.rows, env.cols))
    for r in range(env.rows):
        row_str = ""
        for c in range(env.cols):
            val = V[(r, c)]
            grid[r, c] = val
            row_str += f"{val:6.3f} "
        print(row_str)
    
    # 简单的 Matplotlib 热力图
    try:
        plt.figure(figsize=(6, 5))
        plt.imshow(grid, cmap='viridis')
        plt.colorbar(label='State Value V(s)')
        plt.title('Value Iteration Result')
        
        # 标注数值
        for i in range(env.rows):
            for j in range(env.cols):
                plt.text(j, i, f'{grid[i, j]:.2f}', ha='center', va='center', color='white')
                
        plt.savefig('value_iteration_grid.png')
        print(">>> 结果图已保存为 value_iteration_grid.png")
    except Exception as e:
        print(f"Plotting failed: {e}")

if __name__ == "__main__":
    env = SimpleGridWorld()
    optimal_V = value_iteration(env)
    visualize_values(env, optimal_V)
