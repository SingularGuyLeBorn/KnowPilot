---
title: "Markdown & KaTeX LaTeX & 手绘标注 终极语法速查手册"
category: "教程"
tags: ["Markdown", "LaTeX", "KaTeX", "RoughAnnotation", "语法指南"]
published: true
excerpt: "全网最全的 Markdown 标准语法、GFM 拓展、KaTeX 数学公式大全与 RoughAnnotation 动态手绘标注的完整示例速查指南。"
---

# 📖 Markdown & KaTeX & 手绘标注 终极速查手册

本手册汇集了 OasisMind 引擎支持的全部 **Markdown (GFM)** 标准语法、**KaTeX 数学公式** 表达方式以及 **RoughAnnotation 动态手绘标注** 的全套语法示例。

---

## 🎨 一、 RoughAnnotation 动态手绘标注大全

在文本中，你可以通过 HTML `<mark>` 标签配合 `data-annotation` 属性触发动态手绘笔触动效（当页面滚动到该位置时自动绘制）。

### 1. 基础手绘类型与参数

| 效果类型 | Markdown / HTML 标签源码 | 效果说明 |
| :--- | :--- | :--- |
| **手绘下划线** | `<mark data-annotation="underline" data-color="#e74c3c">重点标注文字</mark>` | 底部手绘红线 |
| **手绘画圈** | `<mark data-annotation="circle" data-color="#3498db">圈选核心概念</mark>` | 手绘蓝圈整体包围 |
| **手绘方框** | `<mark data-annotation="box" data-color="#2ecc71">框住关键参数</mark>` | 绿色矩形外框 |
| **荧光高亮** | `<mark data-annotation="highlight" data-color="#fef08a">黄底荧光高亮</mark>` | 黄色背景笔刷涂满 |
| **手绘括号** | `<mark data-annotation="bracket" data-color="#9b59b6">括号包围正文</mark>` | 左右两侧手绘紫色大括号 |
| **打叉删除** | `<mark data-annotation="crossed-off" data-color="#e74c3c">打叉划掉废弃案</mark>` | 红色手绘打叉斜线 |
| **手绘删除线** | `<mark data-annotation="strike-through" data-color="#e74c3c">手绘贯穿删除线</mark>` | 单条手绘水平贯穿线 |

---

### 2. 高阶属性调节（粗细 / 边距 / 笔触）

可以通过以下 `data-` 属性精细微调手绘质感：

- `data-color`: 笔触颜色（Hex，如 `#3b82f6`、`#10b981`）
- `data-stroke-width`: 线条粗细（默认 `2`，可设为 `1` ~ `5`）
- `data-padding`: 标注边距（默认 `4`）
- `data-iterations`: 迭代重复笔刷次数（默认 `2`，值越大越有手绘随意感）

```html
<!-- 粗笔触橙色框选 -->
<mark data-annotation="box" data-color="#f97316" data-stroke-width="3" data-padding="6">粗笔触橙色矩形框</mark>

<!-- 多重手绘迭代深紫圈选 -->
<mark data-annotation="circle" data-color="#7c3aed" data-iterations="4">多重手绘迭代线条</mark>
```

---

### 3. 实战案例：任务看板图解（复刻代码说明图）

结合 Markdown 任务列表与 `<mark>` 手绘标注，可轻松制作清晰直观的代码/任务图解：

# Tasks

- [ ] <mark data-annotation="box" data-color="#3b82f6">CLI-042</mark> Add export command <mark data-annotation="highlight" data-color="#d1fae5">#cli</mark> <mark data-annotation="highlight" data-color="#fee2e2">!high</mark> <mark data-annotation="underline" data-color="#8b5cf6">@blocked_by:CLI-041</mark>
      <mark data-annotation="underline" data-color="#94a3b8">Write task output as JSON for scripts and agents</mark>

```markdown
- [ ] <mark data-annotation="box" data-color="#3b82f6">CLI-042</mark> Add export command <mark data-annotation="highlight" data-color="#d1fae5">#cli</mark> <mark data-annotation="highlight" data-color="#fee2e2">!high</mark> <mark data-annotation="underline" data-color="#8b5cf6">@blocked_by:CLI-041</mark>
      <mark data-annotation="underline" data-color="#94a3b8">Write task output as JSON for scripts and agents</mark>
```

---

## 🧮 二、 KaTeX / LaTeX 数学公式穷尽指南

OasisMind 内置了完整的 KaTeX 解析引擎，支持包含微分方程、矩阵、方程组、希腊字母在内的全量学术公式。

### 1. 行内公式与独立块级公式

- **行内公式**：使用单美元符号包围，例如：质能方程 $E = mc^2$ 与欧拉恒等式 $e^{i\pi} + 1 = 0$。
- **独立块级公式**：使用双美元符号 `$$ ... $$` 包围或 ` ```math ` 代码块：

$$
i\hbar\frac{\partial}{\partial t}\Psi(\mathbf{r},t) = \left[ -\frac{\hbar^2}{2m}\nabla^2 + V(\mathbf{r},t) \right]\Psi(\mathbf{r},t)
$$

---

### 2. 希腊字母 (Greek Letters)

#### 小写希腊字母
$\alpha$ (`\alpha`), $\beta$ (`\beta`), $\gamma$ (`\gamma`), $\delta$ (`\delta`), $\epsilon$ (`\epsilon`), $\varepsilon$ (`\varepsilon`), $\zeta$ (`\zeta`), $\eta$ (`\eta`), $\theta$ (`\theta`), $\iota$ (`\iota`), $\kappa$ (`\kappa`), $\lambda$ (`\lambda`), $\mu$ (`\mu`), $\nu$ (`\nu`), $\xi$ (`\xi`), $\pi$ (`\pi`), $\rho$ (`\rho`), $\sigma$ (`\sigma`), $\tau$ (`\tau`), $\upsilon$ (`\upsilon`), $\phi$ (`\phi`), $\varphi$ (`\varphi`), $\chi$ (`\chi`), $\psi$ (`\psi`), $\omega$ (`\omega`)

#### 大写希腊字母
$\Gamma$ (`\Gamma`), $\Delta$ (`\Delta`), $\Theta$ (`\Theta`), $\Lambda$ (`\Lambda`), $\Xi$ (`\Xi`), $\Pi$ (`\Pi`), $\Sigma$ (`\Sigma`), $\Upsilon$ (`\Upsilon`), $\Phi$ (`\Phi`), $\Psi$ (`\Psi`), $\Omega$ (`\Omega`)

---

### 3. 基础算子、关系符与符号 (Operators & Symbols)

| 符号类别 | 常见 LaTeX 表达式 | 渲染输出 |
| :--- | :--- | :--- |
| **四则算术** | `a \pm b \mp c \times d \div e \cdot f` | $a \pm b \mp c \times d \div e \cdot f$ |
| **比较关系** | `a \le b \ge c \neq d \approx e \equiv f \propto g` | $a \le b \ge c \neq d \approx e \equiv f \propto g$ |
| **集合与逻辑**| `x \in A \notin B \subset C \subseteq D \cup E \cap F` | $x \in A \notin B \subset C \subseteq D \cup E \cap F$ |
| **量词与符号**| `\forall x, \exists y, \infty, \partial, \nabla, \hbar` | $\forall x, \exists y, \infty, \partial, \nabla, \hbar$ |

---

### 4. 分式、根式、求和与积分 (Calculus & Algebra)

- **分式**：`\frac{a}{b}` $\rightarrow \frac{a}{b}$；大尺寸分式 `\dfrac{a}{b}` $\rightarrow \dfrac{a}{b}$
- **根式**：`\sqrt{x}` $\rightarrow \sqrt{x}$；高次根式 `\sqrt[3]{x^2 + y^2}` $\rightarrow \sqrt[3]{x^2 + y^2}$
- **求和与连乘**：
  $$\sum_{k=1}^{n} k = \frac{n(n+1)}{2}, \quad \prod_{i=1}^{n} i = n!$$
- **定积分与重积分**：
  $$\int_{a}^{b} f(x) \, dx, \quad \iint_{D} f(x,y) \, dx dy, \quad \oint_{C} \mathbf{F} \cdot d\mathbf{r}$$
- **极限**：
  $$\lim_{x \to 0} \frac{\sin x}{x} = 1, \quad \lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e$$

---

### 5. 矩阵与行列式 (Matrices & Determinants)

#### 圆括号矩阵 (`pmatrix`)
$$
\mathbf{A} = \begin{pmatrix}
a_{11} & a_{12} & \cdots & a_{1n} \\
a_{21} & a_{22} & \cdots & a_{2n} \\
\vdots & \vdots & \ddots & \vdots \\
a_{m1} & a_{m2} & \cdots & a_{mn}
\end{pmatrix}
$$

#### 方括号矩阵 (`bmatrix`) 与 行列式 (`vmatrix`)
$$
\mathbf{B} = \begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix}, \quad |\mathbf{B}| = \begin{vmatrix} 1 & 2 \\ 3 & 4 \end{vmatrix} = 1 \times 4 - 2 \times 3 = -2
$$

---

### 6. 多行推导对齐与分段函数 (Aligned & Cases)

#### 分段函数 (`cases`)
$$
f(x) = \begin{cases}
0, & x < 0 \\
x^2 \sin\left(\frac{1}{x}\right), & x > 0 \\
\frac{1}{2}, & x = 0
\end{cases}
$$

#### 步骤推导等号对齐 (`aligned`)
$$
\begin{aligned}
(a + b)^3 &= (a + b)(a + b)^2 \\
&= (a + b)(a^2 + 2ab + b^2) \\
&= a^3 + 3a^2b + 3ab^2 + b^3
\end{aligned}
$$

---

### 7. 向量、张量与箭头 (Vectors & Arrows)

- 向量箭头：`\vec{v}` $\rightarrow \vec{v}$，黑体向量：`\mathbf{v}` $\rightarrow \mathbf{v}$
- 粗体张量：`\hat{\mathbf{n}}` $\rightarrow \hat{\mathbf{n}}$，平均值：`\bar{x}` $\rightarrow \bar{x}$
- 逻辑推导箭头：`A \implies B` $\rightarrow A \implies B$；`A \iff B` $\rightarrow A \iff B$

---

## 📝 三、 标准 Markdown & GFM 拓展语法

### 1. 标题与排版

# 一级标题 H1
## 二级标题 H2
### 三级标题 H3
#### 四级标题 H4

---

### 2. 文本强调与内联样式

- **粗体文字**：`**粗体文字**` 或 `__粗体文字__`
- *斜体文字*：`*斜体文字*` 或 `_斜体文字_`
- ***粗斜体***：`***粗斜体***`
- ~~删除线文字~~：`~~删除线文字~~`
- <u>带下划线文字</u>：`<u>带下划线文字</u>`
- 上标与下标：$H_2O$ (`H_2O`)， $2^{10} = 1024$ (`2^{10}`)
- 键盘按键风格：按 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> 打开命令面板

---

### 3. 引用与多层嵌套引用

> 这是一级引用文本。
> 
> > 这是二级嵌套引用文本。
> > > 这是三级嵌套引用文本。

---

### 4. 列表与任务清单 (Task Lists)

#### 无序列表
- 关联项目 1
- 关联项目 2
  - 子项目 2.1
  - 子项目 2.2

#### 有序列表
1. 第一步：准备配置环境
2. 第二步：执行构建脚本
3. 第三步：部署服务节点

#### 任务清单 (GFM Task List)
- [x] 已完成的任务项
- [ ] 待处理的开发任务
- [ ] 待验证的测试用例

---

### 5. 代码块与语法高亮 (Code Blocks)

行内代码示例：`const version = "v2.5.0";`

#### TypeScript 代码块
```typescript
interface UserProfile {
  id: string;
  name: string;
  role: "admin" | "user";
}

export function greet(user: UserProfile): string {
  return `Hello, ${user.name}! (Role: ${user.role})`;
}
```

#### Python 代码块
```python
def fibonacci(n: int) -> list[int]:
    a, b = 0, 1
    result = []
    for _ in range(n):
        result.append(a)
        a, b = b, a + b
    return result

print(fibonacci(8))
```

---

### 6. 表格与对齐 (GFM Tables)

| 左对齐列 (Left) | 居中对齐列 (Center) | 右对齐列 (Right) | 状态 |
| :--- | :---: | ---: | :---: |
| React 19 | Frontend | 128.5 KB | <mark data-annotation="highlight" data-color="#d1fae5">稳定</mark> |
| Next.js 16 | App Router | 2.4 MB | <mark data-annotation="highlight" data-color="#d1fae5">稳定</mark> |
| Prisma 6 | ORM | 450 KB | <mark data-annotation="box" data-color="#3b82f6">活跃</mark> |

---

### 7. 链接、双链与超链接

- **标准超链接**：[OasisMind 官方文档](https://github.com/SingularGuyLeBorn/KnowPilot)
- **双链 (Wiki Links)**：`[[posts/welcome-to-knowpilot|欢迎使用指南]]`
- **自动解析链接**：<https://github.com>

---

## 🛠️ 四、 OasisMind 特有高级组件

### 1. Thinking Node 结构化思考块

可以使用自定义 `<thinkingnode>` 标签插入结构化推导与思考过程：

<thinkingnode category="架构分析">
这是系统的底层思考推导逻辑过程。Thinking Node 常用于展示 AI Agent 的推理推断或复杂计算链路。
</thinkingnode>

```html
<thinkingnode category="架构分析">
这是系统的底层思考推导逻辑过程。
</thinkingnode>
```

---

### 2. Excalidraw 手绘画板嵌入

使用 ` ```kp-board ` 代码块可直接在 Markdown 中嵌入可交互的手绘 Canvas 画板：

```kp-board
{"type":"excalidraw","version":2,"elements":[]}
```

---

### 🌟 总结

这份速查手册穷尽了 Markdown、KaTeX 公式与 OasisMind 动态手绘标注的全部常见语法。你可以随时编辑或引用本文档作为写作与设计的参考指南！
