---
title: "Markdown 全语法渲染测试与示例"
category: "测试"
tags:
  - "Markdown"
  - "语法"
  - "示例"
  - "测试"
  - "LaTeX"
published: true
excerpt: "覆盖标题、段落、强调、列表、代码、表格、图片、HTML 嵌入、数学公式、LaTeX 公式大全、脚注等 Markdown / GFM 语法，用于检验 KnowPilot 渲染效果。"
---

# Markdown 全语法渲染测试

这篇文章尽可能多地覆盖日常写作会用到的 Markdown、GFM、HTML、行内代码、数学语法与 LaTeX 公式示范，方便在升级渲染器后快速回归验证。

---

## 1. 标题

# 一级标题 H1
## 二级标题 H2
### 三级标题 H3
#### 四级标题 H4
##### 五级标题 H5
###### 六级标题 H6

---

## 2. 段落与文本格式

这是一段普通段落。Markdown 允许通过**两个空格 + 回车**实现换行。  
这是同一段落内的第二行。

文本样式包括：

- **粗体**
- *斜体*
- ***粗体 + 斜体***
- ~~删除线~~
- `行内代码`
- <mark>高亮（HTML）</mark>
- 化学式：H<sub>2</sub>O、面积：m<sup>2</sup>
- 键盘快捷键：<kbd>Ctrl</kbd> + <kbd>S</kbd>

---

## 3. 链接

- 内部链接：[返回首页](/)
- 外部链接：[OpenAI 官网](https://openai.com)
- 引用式链接：[GitHub][github]

[github]: https://github.com "GitHub 首页"

---

## 4. 列表

### 无序列表

- 项目 A
- 项目 B
  - 子项目 B1
  - 子项目 B2
    - 更深层级
- 项目 C

### 有序列表

1. 第一步
2. 第二步
   1. 子步骤 2.1
   2. 子步骤 2.2
3. 第三步

### 任务列表

- [x] 已完成：初始化项目
- [x] 已完成：接入 tRPC
- [ ] 待完成：部署上线
- [ ] 待完成：SEO 优化

---

## 5. 引用

> 这是一段普通引用。
>
> 引用可以包含**粗体**、`代码`和[链接](https://example.com)。

> 嵌套引用示例：
>> 第一层嵌套
>>> 第二层嵌套

> [!TIP]
> 这是一个提示块（GFM 告警语法），用于高亮重要信息。

---

## 6. 代码

### 行内代码

使用 `pnpm dev` 启动开发服务器，然后访问 `http://localhost:3000`。

在句子中混排行内代码：Vue 的 `v-model`、React 的 `useState`、Rust 的 `Option<T>` 都应该正常渲染。

### 代码块

代码块支持**复制按钮**和**语言标签**。

#### TypeScript / TSX

```tsx
"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <div className="p-8">
      <h1>KnowPilot</h1>
      <Link href="/posts">浏览文章</Link>
    </div>
  );
}
```

#### Python

```python
def hello(name: str = "World") -> str:
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(hello("KnowPilot"))
```

#### Bash

```bash
pnpm install
pnpm --filter @knowpilot/web dev
```

#### JSON

```json
{
  "name": "knowpilot",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build"
  }
}
```

#### YAML

```yaml
name: KnowPilot
category: 知识管理
tags:
  - markdown
  - ai
published: true
```

#### SQL

```sql
SELECT id, title, slug, published
FROM Post
WHERE published = true
ORDER BY updatedAt DESC
LIMIT 10;
```

#### Rust

```rust
fn main() {
    let message = "Hello, KnowPilot!";
    println!("{}", message);
}
```

---

## 7. 表格

| 功能 | 状态 | 优先级 | 备注 |
| :--- | :---: | ---: | --- |
| 文章列表 |  完成 | 高 | 支持分页 |
| 编辑器 |  完成 | 高 | Milkdown 集成 |
| 搜索 |  待办 | 中 | 全文检索 |
| 深色模式 |  完成 | 低 | CSS 变量 |

---

## 8. 图片

### Markdown 图片

![KnowPilot 测试图片](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjYjhhMDkwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNmZmYiIGZvbnQtc2l6ZT0iMjQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIj5Lbm93UGlsb3QgVGVzdCBJbWFnZTwvdGV4dD48L3N2Zz4= "SVG 测试图")

### 带标题的图片

![莫兰迪色块](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjYjhhMDkwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNmZmYiIGZvbnQtc2l6ZT0iMjQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIj5Lbm93UGlsb3QgVGVzdCBJbWFnZTwvdGV4dD48L3N2Zz4=)
*图注：这是一张内嵌的 SVG 测试图，用于验证图片渲染。*

### HTML 图片

<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjNmE2NTYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNmZmYiIGZvbnQtc2l6ZT0iMTYiPkhUTUwgaW1nPC90ZXh0Pjwvc3ZnPg==" alt="HTML 图片" width="200" />

---

## 9. HTML 嵌入

### 样式块

<div style="padding: 1rem; background: var(--kp-brand-soft); border: 1px solid var(--kp-divider); border-radius: 0.75rem; margin: 1rem 0;">
  <strong>HTML 样式块</strong><br />
  这段内容使用内联 <code>style</code> 渲染，可以验证 <code>rehype-raw</code> 是否正常解析原始 HTML。
</div>

### 折叠详情

<details>
  <summary>点击展开：KnowPilot 技术栈</summary>
  <ul>
    <li>Next.js 16 + React 19</li>
    <li>tRPC 11 + Prisma</li>
    <li>SQLite</li>
    <li>Tailwind CSS 4</li>
    <li>Milkdown</li>
  </ul>
</details>

### Iframe 嵌入

<iframe src="data:text/html;base64,PCFET0NUWVBFIGh0bWw+PGh0bWw+PGhlYWQ+PHN0eWxlPmJvZHl7Zm9udC1mYW1pbHk6c2Fucy1zZXJpZjtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7aGVpZ2h0OjEwMHZoO21hcmdpbjowO2JhY2tncm91bmQ6I2Y4ZjZmMztjb2xvcjojMmQyYTI2O308L3N0eWxlPjwvaGVhZD48Ym9keT48ZGl2IHN0eWxlPSJwYWRkaW5nOjFyZW0gMnJlbTtiYWNrZ3JvdW5kOiNmZmY7Ym9yZGVyLXJhZGl1czowLjc1cmVtO2JveC1zaGFkb3c6MCAycHggOHB4IHJnYmEoMCwwLDAsMC4wOCk7Ij48aDI+RW1iZWRkZWQgSFRNTDwvaDI+PHA+VGhpcyBjb250ZW50IGxpdmVzIGluc2lkZSBhbiA8Y29kZT4mbHQ7aWZyYW1lJmd0OzwvY29kZT4uPC9wPjwvZGl2PjwvYm9keT48L2h0bWw+" width="100%" height="220" style="border: 1px solid var(--kp-divider); border-radius: 0.75rem;"></iframe>

### 定义列表

<dl>
  <dt>KnowPilot</dt>
  <dd>智能知识管理与博客平台。</dd>
  <dt>tRPC</dt>
  <dd>端到端类型安全的 RPC 框架。</dd>
</dl>

---

## 10. 数学公式

### 行内公式

行内公式应该与文字自然混排：$E = mc^2$、$a^2 + b^2 = c^2$、$\vec{F} = m \vec{a}$、$\hat{y} = X\beta + \varepsilon$。

### 块级公式

$$
\int_{a}^{b} f(x) \, dx = F(b) - F(a)
$$

---

## 11. LaTeX 公式示范大全

### 11.1 上下标

行内上下标：$x^2$、$a_i$、$x_i^j$、$x^{a+b}$、$a_{ij}$、$e^{i\pi} + 1 = 0$。

块级展示：

$$
x_i^j = \sum_{k=1}^{n} a_{ik} b_{kj}
$$

### 11.2 上下括号

$$
\overbrace{a + b + c}^{\text{三个加数}} \quad \underbrace{a \cdot b \cdot c}_{\text{三个乘数}}
$$

带标注的上下括号：

$$
\overbrace{x + \cdots + x}^{k \text{ 次}} = kx
$$

### 11.3 分数、根号与分式

$$
\frac{a}{b}, \quad \dfrac{a}{b}, \quad \tfrac{1}{2}, \quad \sqrt{x^2 + y^2}, \quad \sqrt[n]{x^n + y^n}
$$

### 11.4 求和、积分、极限、乘积

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

$$
\int_{-\infty}^{+\infty} e^{-x^2} dx = \sqrt{\pi}
$$

$$
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

$$
\prod_{i=1}^{n} x_i = x_1 x_2 \cdots x_n
$$

### 11.5 矩阵与行列式

普通矩阵：

$$
\mathbf{A} = \begin{bmatrix}
a_{11} & a_{12} & a_{13} \\
a_{21} & a_{22} & a_{23} \\
a_{31} & a_{32} & a_{33}
\end{bmatrix}
$$

行列式：

$$
\det(\mathbf{A}) = \begin{vmatrix}
a_{11} & a_{12} \\
a_{21} & a_{22}
\end{vmatrix}
= a_{11}a_{22} - a_{12}a_{21}
$$

### 11.6 分段函数与对齐方程

分段函数：

$$
f(x) = \begin{cases}
x^2 & x \ge 0 \\
-x^2 & x < 0
\end{cases}
$$

多行对齐方程：

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
\nabla \cdot \mathbf{B} &= 0
\end{aligned}
$$

### 11.7 帽子、向量、导数与重音

$$
\hat{x}, \quad \bar{x}, \quad \vec{x}, \quad \dot{x}, \quad \ddot{x}, \quad \tilde{x}, \quad \widetilde{xyz}
$$

### 11.8 希腊字母与常用运算符

$$
\alpha, \beta, \gamma, \delta, \epsilon, \varepsilon, \theta, \lambda, \mu, \pi, \rho, \sigma, \phi, \varphi, \omega
$$

$$
\sin x, \quad \cos x, \quad \tan x, \quad \log x, \quad \ln x, \quad \exp x, \quad \max(a,b), \quad \min(a,b)
$$

### 11.9 集合与逻辑

$$
A \subset B, \quad x \in A, \quad A \cup B, \quad A \cap B, \quad A \setminus B, \quad \forall x \in \mathbb{R}, \quad \exists x \in \mathbb{N}
$$

$$
p \Rightarrow q, \quad p \iff q, \quad \neg p, \quad p \land q, \quad p \lor q
$$

### 11.10 箭头与对齐

$$
x \to \infty, \quad A \Leftarrow B, \quad a \xrightarrow{f} b, \quad x \mapsto f(x)
$$

### 11.11 标注与颜色

$$
\boxed{x^2 + y^2 = z^2}
$$

$$
f(x) = \textcolor{red}{x^2} + \textcolor{blue}{y^2}
$$

### 11.12 复杂公式组合

贝叶斯定理：

$$
P(A \mid B) = \frac{P(B \mid A) \, P(A)}{P(B)}
$$

正态分布：

$$
f(x) = \frac{1}{\sigma\sqrt{2\pi}} \exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)
$$

欧拉公式：

$$
e^{i\pi} + 1 = 0
$$

---

## 12. 脚注

GFM 脚注语法示例：KnowPilot 使用 React 作为 UI 框架[^1]，服务端使用 tRPC 提供类型安全 API[^2]。

[^1]: React 官网：https://react.dev
[^2]: tRPC 官网：https://trpc.io

---

## 13. 分隔线与转义

上方是水平分隔线：

---

转义字符：\* 不是斜体 \*，\` 不是代码 \`，\# 不是标题。

---

## 14. Emoji 与特殊符号

-  火箭
-  勾选
-  笔记
-  红心
- → ← ↑ ↓
- …… 省略号
- —— 破折号

---

## 结语

如果以上所有元素都能正确渲染，说明 KnowPilot 的 Markdown 渲染链路（`react-markdown`、`remark-gfm`、`remark-math`、`rehype-raw`、`rehype-katex`、`rehype-highlight`）已经正常工作，并且代码块已支持莫兰迪主题、复制按钮和语言标签。
