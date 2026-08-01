---
title: Markdown & KaTeX LaTeX 全能速查手册
category: 教程
published: true
excerpt: >-
  见微 OasisMind 的 Markdown、GFM 扩展语法、KaTeX / LaTeX 全量数学公式以及 RoughAnnotation
  手绘注解效果全景穷尽指南。
tags:
  - Markdown
  - LaTeX
  - KaTeX
  - 手写效果
  - 指南
---
# 见微 · OasisMind Markdown & KaTeX 全能速查手册

欢迎使用 **见微 (OasisMind)** 终极 Markdown 与数学公式指南！本文档作为系统的**语法示范与渲染标准**，穷尽涵盖了 Markdown 常用及高级语法、GFM 扩展、KaTeX / LaTeX 数学符号与环境，以及独具特色的 **RoughAnnotation 手绘注解** 效果。

***

## 一、基础 Markdown 与 GFM 扩展

### 1. 标题与层级

# 一级标题 H1

## 二级标题 H2

### 三级标题 H3

#### 四级标题 H4

##### 五级标题 H5

###### 六级标题 H6

> **提示**：鼠标悬停在任意标题上，左侧会自动浮现与标题字号一致的 `#` 锚点标识，点击即可复制链接或跳转。

***

### 2. 文本强调与行内样式

* **加粗文本** (`**加粗**` 或 `__加粗__`)
* *斜体文本* (`*斜体*` 或 `_斜体_`)
* ***加粗斜体*** (`***加粗斜体***`)
* ~~删除线~~ (`~~删除线~~`)
* 行内代码 `const oasis = "Mind"`
* 下标：H~~2~~O，上标：X^2^
* 键盘按键：<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>

***

### 3. 列表与任务清单

#### 无序列表

* 墨色花园设计语言
* 本地优先，Markdown 为唯一事实源
  * 支持三栏式 Agent 智能体对话
  * 支持自定义 Skill 与 MCP 工具扩展

#### 有序列表

1. 第一步：配置 SQLite / Prisma 数据库
2. 第二步：同步 `content/` 目录下知识库文件
3. 第三步：启动 Next.js 16 + React 19 客户端

#### 任务清单 (Task Lists)

* [x] 完成 L1–L5 系统基础架构落地
* [x] 重构 Chat 三层状态机 store
* [x] 支持 RoughAnnotation 局部滚动定位与手绘标注
* [ ] 探索分布式 Swarm 多 Agent 编排

***

### 4. 引用块与多级嵌套

> **哲学声明**：见微（OasisMind）定位是以 Markdown 为原子、AI 为引擎的数字花园。
>
> > **架构原则**：本地 Markdown 文件是数据的唯一事实源，SQLite 只作为查询与缓存层。
> >
> > > **设计铁律**：禁止打补丁，必须从架构层面根治不变量。

***

### 5. 表格 (GFM Tables)

| 功能特性 |          技术栈 / 规范         |                                         状态                                         |                         备注说明 |
| :--- | :-----------------------: | :--------------------------------------------------------------------------------: | ---------------------------: |
| 前端框架 | Next.js 16.2 (App Router) | <mark data-annotation="highlight" data-color="rgba(52, 211, 153, 0.35)">已落地</mark> | React 19 + Server Components |
| 样式系统 |      Tailwind CSS 4.3     | <mark data-annotation="highlight" data-color="rgba(52, 211, 153, 0.35)">已落地</mark> |       莫兰迪配色 + tw-animate-css |
| 通信协议 |   tRPC 11.1 + SuperJSON   | <mark data-annotation="highlight" data-color="rgba(52, 211, 153, 0.35)">已落地</mark> |                 类型安全 端到端 API |
| 白板手绘 |    perfect-freehand SVG   |             <mark data-annotation="box" data-color="#1f8a7a">交互式</mark>            |             压感笔迹 + Undo/Redo |

***

### 6. 代码块与语法高亮

```typescript
export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

// 示例：类型安全的 tRPC Procedure 调用
export const getPostBySlug = publicProcedure
  .input(z.object({ slug: z.string() }))
  .query(async ({ ctx, input }) => {
    return ctx.prisma.post.findUnique({ where: { slug: input.slug } });
  });
```

***

## 二、KaTeX / LaTeX 全量数学公式 (穷尽速查)

见微 内置 `react-markdown` + `remark-math` + `rehype-katex`，支持高精度的 LaTeX 数学公式渲染。点击任意公式可展开交互式源码面板。

### 1. 上下括号与标记 (`\overbrace` & `\underbrace` & `\tag`)

#### 上括号 `\overbrace`

$$
\overbrace{a_1 + a_2 + \dots + a_n}^{n \text{ 个正实数}} \ge n \sqrt[n]{a_1 a_2 \dots a_n} \tag{1.1}
$$

#### 下括号 `\underbrace`

$$
f(x) = \underbrace{x^4 - 2x^2 + 1}_{\text{可化为 } (x^2-1)^2} + \underbrace{\sin^2(x) + \cos^2(x)}_{\text{恒等于 } 1} \tag{1.2}
$$

#### 定位与间距 (`\quad`, `\qquad`, `\,`)

$$
A \quad \text{与} \qquad B \quad \text{之间具有间距}
$$

***

### 2. 矩阵全系列 (Six Matrix Environments)

#### 普通矩阵 `matrix`

$$
\begin{matrix} a & b \\ c & d \end{matrix}
$$

#### 圆括号矩阵 `pmatrix`

$$
\begin{pmatrix} 1 & 2 & 3 \\ 0 & 1 & 4 \\ 5 & 6 & 0 \end{pmatrix}
$$

#### 方括号矩阵 `bmatrix`

$$
\mathbf{J} = \begin{bmatrix} \frac{\partial f_1}{\partial x_1} & \dots & \frac{\partial f_1}{\partial x_n} \\ \vdots & \ddots & \vdots \\ \frac{\partial f_m}{\partial x_1} & \dots & \frac{\partial f_m}{\partial x_n} \end{bmatrix} \tag{2.1}
$$

#### 行列式矩阵 `vmatrix`

$$
\det(A) = \begin{vmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{vmatrix} = a_{11}a_{22} - a_{12}a_{21}
$$

#### 范数矩阵 `Vmatrix`

$$
\|A\| = \begin{Vmatrix} x_1 & x_2 \\ y_1 & y_2 \end{Vmatrix}
$$

#### 行内小矩阵 `smallmatrix`

行内嵌入小矩阵：$\left(\begin{smallmatrix} a & b \\ c & d \end{smallmatrix}\right)$ 完美适应正文行高。

***

### 3. 多行对齐与分段函数 (`aligned` & `cases`)

#### 多行推导对齐 `aligned`

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \cdot \mathbf{B} &= 0 \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
\nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\end{aligned} \tag{3.1}
$$

#### 分段函数 `cases`

$$
u(x, t) = \begin{cases} 
u_0(x - ct), & t \ge 0, \, x > ct \\ 
g\left(t - \frac{x}{c}\right), & t \ge 0, \, x \le ct 
\end{cases} \tag{3.2}
$$

***

### 4. 微积分、极限与多重积分

#### 多重积分与路径积分

$$
\iint_D \left( \frac{\partial Q}{\partial x} - \frac{\partial P}{\partial y} \right) \mathrm{d}x \mathrm{d}y = \oint_{\partial D} (P \mathrm{d}x + Q \mathrm{d}y) \tag{4.1}
$$

#### 三重积分与极限

$$
\lim_{N \to \infty} \sum_{i=1}^N f(x_i^*) \Delta x = \iiint_\Omega f(x, y, z) \, \mathrm{d}V
$$

#### 偏导数与拉普拉斯算子

$$
\Delta \psi = \nabla^2 \psi = \frac{\partial^2 \psi}{\partial x^2} + \frac{\partial^2 \psi}{\partial y^2} + \frac{\partial^2 \psi}{\partial z^2} = \frac{1}{c^2} \frac{\partial^2 \psi}{\partial t^2}
$$

***

### 5. 希腊字母与字体变体

#### 希腊字母及变体

* 小写：
* 大写：$\Gamma, \Delta, \Theta, \Lambda, \Xi, \Pi, \Sigma, \Upsilon, \Phi, \Psi, \Omega$

#### 数学字体集

* 双线体（黑板报体）：
* 花体（手写体）：
* 德文哥特体：$\mathbf{v}, \mathbf{x}, \mathrm{d}x, \mathrm{e}^{ix}, \mathsf{Var}(X)$
* 粗体与正体：$\mathbf{v}, \mathbf{x}, \mathrm{d}x, \mathrm{e}^{ix}, \mathsf{Var}(X)$

#### 帽子与修饰符

$$
\hat{x}, \quad \bar{x}, \quad \tilde{x}, \quad \vec{v}, \quad \dot{y}, \quad \ddot{y}, \quad \widehat{AB}, \quad \widetilde{XYZ}
$$

***

## 三、RoughAnnotation 手绘注解效果全集

见微 采用 `rough-notation` 打造极致手绘感文本标注。所有手绘效果均具有视口滚动自然随文平移的架构保障。

### 1. 常见手绘样式示范

* **单/双下划线**：`<mark data-annotation="underline" data-color="#7d917f">莫兰迪鼠尾草绿</mark>` 渲染效果为 <mark data-annotation="underline" data-color="#7d917f">莫兰迪鼠尾草绿</mark>。
* **手绘矩形框**：`<mark data-annotation="box" data-color="#1f8a7a">青绿高亮框</mark>` 渲染效果为 <mark data-annotation="box" data-color="#1f8a7a">青绿高亮框</mark>。
* **手绘圆圈**：`<mark data-annotation="circle" data-color="#e74c3c">红色重点圈出</mark>` 渲染效果为 <mark data-annotation="circle" data-color="#e74c3c">红色重点圈出</mark>。
* **荧光笔高亮**：`<mark data-annotation="highlight" data-color="rgba(250, 204, 21, 0.45)">黄色半透明荧光</mark>` 渲染效果为 <mark data-annotation="highlight" data-color="rgba(250, 204, 21, 0.45)">黄色半透明荧光</mark>。
* **手绘删除线**：`<mark data-annotation="strike-through" data-color="#95a5a6">废弃逻辑标记</mark>` 渲染效果为 <mark data-annotation="strike-through" data-color="#95a5a6">废弃逻辑标记</mark>。
* **叉号标记 (Crossed-off)**：`<mark data-annotation="crossed-off" data-color="#e74c3c">禁止违规调用</mark>` 渲染效果为 <mark data-annotation="crossed-off" data-color="#e74c3c">禁止违规调用</mark>。

### 2. 四向手绘括号 (Brackets)

* **左括号**：`<mark data-annotation="bracket" data-bracket="left" data-color="#8e44ad">左侧大括号包裹内容</mark>` 渲染为 <mark data-annotation="bracket" data-bracket="left" data-color="#8e44ad">左侧大括号包裹内容</mark>
* **右括号**：`<mark data-annotation="bracket" data-bracket="right" data-color="#8e44ad">右侧大括号包裹内容</mark>` 渲染为 <mark data-annotation="bracket" data-bracket="right" data-color="#8e44ad">右侧大括号包裹内容</mark>
* **上括号**：`<mark data-annotation="bracket" data-bracket="top" data-color="#1f8a7a">顶部大括号包裹内容</mark>` 渲染为 <mark data-annotation="bracket" data-bracket="top" data-color="#1f8a7a">顶部大括号包裹内容</mark>
* **下括号**：`<mark data-annotation="bracket" data-bracket="bottom" data-color="#1f8a7a">底部大括号包裹内容</mark>` 渲染为 <mark data-annotation="bracket" data-bracket="bottom" data-color="#1f8a7a">底部大括号包裹内容</mark>

***

## 四、交互式手绘白板 (`kp-board`)

见微 提供了内嵌真笔迹手绘白板，支持**钢笔、荧光笔、压感调节、橡皮擦、Undo (Ctrl+Z) 与 Redo (Ctrl+Y)**。

```kp-board
{"v":2,"w":960,"h":540,"strokes":[{"color":"#1c1917","size":8,"points":[134.71206665039062,90.64749908447266,0.5,133.7053680419922,91.65416717529297,0.5,132.69874572753906,94.67420196533203,0.5,130.68533325195312,100.71420288085938,0.5,129.67869567871094,107.76091003417969,0.5,128.6719970703125,115.81424713134766,0.5,128.6719970703125,122.86095428466797,0.5,127.66536712646484,130.91432189941406,0.5,127.66536712646484,137.96099853515625,0.5,127.66536712646484,144.00103759765625,0.5,127.66536712646484,153.0610809326172,0.5,130.68533325195312,161.11444091796875,0.5,134.71206665039062,169.16778564453125,0.5,141.7587127685547,178.2278289794922,0.5,150.81875610351562,187.28785705566406,0.5,160.88548278808594,196.34786987304688,0.5,173.97219848632812,204.40127563476562,0.5,192.09228515625,212.45462036132812,0.5,206.1856231689453,217.4879913330078,0.5,219.27232360839844,220.50794982910156,0.5,231.35240173339844,223.52798461914062,0.5,241.41908264160156,224.53468322753906,0.5,248.4657745361328,224.53468322753906,0.5,253.4991455078125,224.53468322753906,0.5,256.5191955566406,222.5213623046875,0.5,259.5391540527344,221.5146484375,0.5,260.5458679199219,218.49461364746094,0.5,260.5458679199219,216.4812774658203,0.5,260.5458679199219,213.46131896972656,0.5,256.5191955566406,207.42124938964844,0.5,249.4724884033203,199.36790466308594,0.5,240.41244506835938,191.3145294189453,0.5,233.36573791503906,186.2812042236328,0.5,226.31903076171875,182.25450134277344,0.5,224.30569458007812,180.2411651611328,0.5,222.2923583984375,179.2344970703125,0.5,226.31903076171875,181.24783325195312,0.5,232.35903930664062,185.2745361328125,0.5,240.41244506835938,190.307861328125,0.5,251.48582458496094,196.34786987304688,0.5,263.5658264160156,203.3945770263672,0.5,275.6459045410156,208.42794799804688,0.5,286.7192687988281,214.46795654296875,0.5,294.7726135253906,217.4879913330078,0.5,299.80596923828125,220.50794982910156,0.5,301.8193054199219,221.5146484375,0.5,300.81268310546875,222.5213623046875,0.5,298.7992858886719,222.5213623046875,0.5,294.7726135253906,222.5213623046875,0.5,290.7459411621094,222.5213623046875,0.5,286.7192687988281,222.5213623046875,0.5,284.7059326171875,222.5213623046875,0.5,282.6925964355469,222.5213623046875,0.5,286.7192687988281,222.5213623046875,0.5,292.75927734375,222.5213623046875,0.5,302.8260192871094,222.5213623046875,0.5,311.885986328125,222.5213623046875,0.5,320.946044921875,222.5213623046875,0.5,328.99945068359375,222.5213623046875,0.5,337.0527648925781,222.5213623046875,0.5,345.1061096191406,222.5213623046875,0.5,352.15283203125,222.5213623046875,0.5,356.1794738769531,222.5213623046875,0.5,360.2061462402344,222.5213623046875,0.5,363.2261962890625,222.5213623046875,0.5,365.2395935058594,222.5213623046875,0.5],"tool":"pen"}]}
```

***

*总结：见微（OasisMind）旨在融合极致的写字体验、数学严密性与 AI 智能体生产力。*
