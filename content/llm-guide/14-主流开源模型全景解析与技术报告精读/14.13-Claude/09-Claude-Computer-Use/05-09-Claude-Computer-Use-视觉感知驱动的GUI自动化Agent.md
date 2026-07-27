---
title: "05 · Claude Computer Use：视觉感知驱动的GUI自动化Agent——从API集成到像素级操控的范式转移"
---

# Claude Computer Use：视觉感知驱动的GUI自动化Agent

> **模型定位**：Anthropic 首个公开提供的计算机操控Agent(2024-10)，业界首个基于纯视觉感知操作GUI的前沿AI
> **家族归属**：14.13-Claude｜编号 09-Claude-Computer-Use
> **核心论文/报告**：*Developing a Computer Use Capability* (Anthropic, 2024-10)
>  **[返回 14.13-Claude 家族总览](../../14.13-Claude.md)**

---

## 一、发布背景：Agent交互的范式革命

### 1.1 从"API集成"到"像人一样操作"

在Claude Computer Use发布之前，AI与计算机的交互方式是**API驱动**的：

```
传统AI自动化：
用户指令 → AI理解 → 调用特定API → 获取结果
                    ↑
              每个软件需要专用API集成
```

这种方式的致命局限：
- **API覆盖不全**：大多数软件(尤其是遗留系统)没有公开API
- **集成成本高**：每个新软件需要单独开发集成
- **脆弱性强**：UI变化可能导致API失效
- **学习成本高**：AI需要"学习"每个API的用法

Anthropic提出了**根本不同的思路**：

> **不是让AI学习API，而是让AI像人一样看屏幕、点鼠标、敲键盘。**

```
Claude Computer Use：
用户指令 → AI看屏幕截图 → 理解界面 → 移动鼠标/点击/输入 → 观察结果 → 循环
                     ↑
              无需API，适用于任何有GUI的软件
```

### 1.2 发布历程

| 时间 | 里程碑 |
|------|--------|
| 2024-10 | Claude 3.5 Sonnet (Oct) 发布，Computer Use公开beta |
| 2024-10 | OSWorld 14.9%(截图-only)，业界领先 |
| 2025 | 集成至Claude Code(IDE Agent) |
| 2026-03 | OSWorld 72.5%，接近人类水平(70-75%) |

---

## 二、核心技术架构

### 2.1 观察-决策-执行-反馈循环

Claude Computer Use的核心是一个**持续的感知-行动循环**：

```
┌─────────────────────────────────────────┐
│         Claude Computer Use Loop         │
│                                          │
│  1. Screenshot ──→ Vision Analysis       │
│         ↓                                │
│  2. Reasoning ──→ Action Planning        │
│         ↓                                │
│  3. Execution ──→ Mouse/Keyboard/Command │
│         ↓                                │
│  4. Observation ──→ New Screenshot       │
│         ↓                                │
│  5. Verification ──→ Task Complete?      │
│         ↓ No                             │
│      Back to Step 1                      │
└─────────────────────────────────────────┘
```

**每个步骤的技术细节**：

**Step 1：截图分析(Screenshot Analysis)**
- 捕获当前屏幕的完整截图
- Claude使用视觉能力识别界面元素：按钮、输入框、菜单、文本、图标
- 理解界面布局和元素间的空间关系

**Step 2：像素坐标映射(Coordinate Mapping)**
这是最关键的技术突破：
- 传统LLM难以精确处理像素级坐标
- Claude被专门训练来**准确计数像素**，计算精确的X/Y坐标
- 将识别的UI元素映射到具体像素位置："submit button at (320, 450)"

**Step 3：动作执行(Action Execution)**
Claude支持的动作集：

| 动作类型 | 说明 |
|---------|------|
| `mouse_move` | 移动鼠标到指定坐标 |
| `mouse_click` | 左键点击 |
| `mouse_double_click` | 双击 |
| `mouse_right_click` | 右键点击 |
| `mouse_drag` | 从一个坐标拖动到另一个坐标 |
| `scroll` | 滚动指定方向和距离 |
| `type` | 键盘输入文本 |
| `key_press` | 按下特定按键或快捷键 |
| `screenshot` | 截取当前屏幕 |

**Step 4：反馈验证(Feedback Verification)**
- 执行动作后，Claude截取新截图
- 验证预期效果是否发生
- 如果失败，分析原因并调整策略

### 2.2 三大工具系统

Claude Computer Use通过三个核心工具与计算机交互：

**1. Computer Tool(计算机控制)**
- 控制鼠标和键盘
- 截取屏幕截图
- 模拟人类的所有基本输入操作

**2. Text Editor Tool(文本编辑器)**
- 查看文件内容
- 创建、编辑、删除文件
- 搜索和替换文本
- 比直接用鼠标操作编辑器更可靠

**3. Bash Tool(命令行)**
- 执行shell命令
- 安装软件包
- 系统管理任务
- 文件系统操作

### 2.3 混合架构：云端+本地

Claude Computer Use采用**混合拓扑架构**：

```
┌─────────────┐      网络       ┌─────────────┐
│  Anthropic  │ ←────────────→ │  用户本地    │
│   云端      │   API调用       │   计算机    │
│             │                 │             │
│ 高级语义规划 │                 │ 鼠标/键盘操控│
│ 推理和决策  │                 │ 截图捕获    │
│ 安全监控   │                 │ 命令执行    │
└─────────────┘                 └─────────────┘
```

**设计考量**：
- 云端处理：复杂的推理、规划、安全判断
- 本地执行：低延迟的鼠标键盘操作、截图
- 减少网络往返对交互式任务的影响

---

## 三、Benchmark性能与演进

### 3.1 OSWorld：计算机操作能力的金标准

OSWorld(Xie et al., 2024)是评估AI操控计算机能力的权威基准，包含369个真实桌面任务：

| 时间 | 模型 | OSWorld得分 | 说明 |
|------|------|------------|------|
| 2024-10 | Claude 3.5 Sonnet | **14.9%** | 首次发布，业界领先 |
| 2024-10 | GPT-4(次优) | 7.7% | 接近Claude的一半 |
| 2024-10 | Claude(多步) | 22.0% | 允许重试后 |
| 2025 | Claude 3.7/4系列 | 持续提升 | — |
| 2026-03 | Claude最新 | **72.5%** | 接近人类水平 |

**人类基准**：70-75%

**关键洞察**：从14.9%到72.5%，Claude Computer Use在约18个月内实现了**近5倍的性能提升**，从" barely functional "到" near-human "。

### 3.2 WebArena：网页自动化

在网页自动化基准WebArena上，Claude Computer Use同样表现优异：
- 不依赖网站的特定API或DOM结构
- 纯视觉理解网页内容
- 通过鼠标点击和键盘输入与网页交互

### 3.3 与竞争对手的对比

| 能力 | Claude Computer Use | OpenAI Operator | Google Project Mariner |
|------|--------------------|----------------|----------------------|
| 发布 | 2024-10 | 2025-01 | 2024-12 |
| 操控层级 | OS级+Web | Web为主 | Web为主 |
| OSWorld | 72.5%(2026) | 38.1% | — |
| WebArena | 领先 | 58.1% | — |
| WebVoyager | — | 87% | **83.5%** |
| 安全确认 | 最频繁 | 中等 | 中等 |
| 多任务并行 | 不支持 | 不支持 | **10个并行** |

---

## 四、应用场景与案例

### 4.1 典型应用场景

**1. 网页自动化**
- 填写复杂表单
- 跨网站数据收集
- 在线预订(机票、酒店、餐厅)
- 电商操作(搜索、比较、购买)

**2. 桌面软件操作**
- 电子表格数据处理
- 文档编辑和格式化
- 演示文稿制作
- 图片编辑(基础操作)

**3. 开发辅助**
- 在IDE中编写和调试代码
- 运行测试套件
- 查看和分析日志
- 操作版本控制系统

**4. 系统管理**
- 文件组织和管理
- 软件安装和配置
- 系统监控和诊断

### 4.2 Anthropic的Demo案例

Anthropic展示的典型用例：
- 研究任务：打开浏览器 → 搜索信息 → 访问多个网页 → 综合信息 → 生成报告
- 数据处理：打开Excel → 导入CSV → 创建图表 → 格式化 → 保存
- 编程任务：打开IDE → 编写代码 → 运行测试 → 调试 → 提交Git

**有趣的"意外"**：
- Claude在演示中不小心停止了录屏软件
- Claude在编码演示中"休息"，开始浏览黄石公园的照片
- 这些意外反而证明了Claude的"自主性"和"好奇心"

---

## 五、安全设计与挑战

### 5.1 Anthropic的安全优先策略

Claude Computer Use采用**最严格的安全策略**之一：

| 安全措施 | 实现 |
|---------|------|
| 频繁确认 | 敏感操作(购买、删除、支付)暂停并请求用户确认 |
| 沙箱环境 | 推荐在虚拟机/容器中运行 |
| 权限最小化 | 以最低权限运行，限制系统访问 |
| 操作审计 | 记录所有操作，可追溯 |
| 超时保护 | 长时间任务自动暂停 |

### 5.2 已知局限

**1. 速度和延迟**
- 每步需要截图-上传-推理-执行，速度较慢
- 复杂任务可能需要数十分钟

**2. 精确操作**
- 拖拽、缩放等精细操作仍有困难
- 小按钮或密集UI可能点错

**3. 错误恢复**
- 一次误操作可能导致任务失败
- 容错能力有限

**4. 环境依赖**
- 界面布局变化可能导致失败
- 对动态内容(动画、弹窗)处理不完美

### 5.3 竞争格局的演进

| 厂商 | 产品 | 特点 |
|------|------|------|
| Anthropic | Computer Use | 最严格安全，OS级操控 |
| OpenAI | Operator/CUA | 2025年1月发布，网页为主 |
| Google | Project Mariner | 10任务并行，Chrome集成 |
| 开源 | UI-TARS | 基于Qwen2.5-VL，数据高效 |

---

## 六、工程实现与API

### 6.1 API设计

```python
from anthropic import Anthropic

client = Anthropic()

response = client.beta.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=4096,
    tools=[
        {
            "type": "computer_use",
            "display_width_px": 1280,
            "display_height_px": 800,
        }
    ],
    messages=[{
        "role": "user",
        "content": "打开计算器并计算123*456"
    }]
)
```

### 6.2 与Claude Code的集成

Claude Computer Use是**Claude Code**(Anthropic的编码Agent)的基础能力：
- 在IDE中自动导航、编辑、运行代码
- 查看终端输出并做出响应
- 在文件系统中查找和修改文件

---

## 七、小结：Claude Computer Use的历史定位

Claude Computer Use是AI Agent领域的**里程碑式突破**：

> **不需要API，不需要集成，AI可以直接像人一样使用任何软件。**

其深远影响：

1. **范式转移**：从"API优先"转向"GUI优先"的Agent设计
2. **通用性**：理论上可以操作任何有人类界面的软件
3. **可访问性**：让AI能够使用没有API的遗留系统
4. **安全标杆**：最严格的确认机制，为行业树立了安全基准

从2024年10月的14.9%到2026年3月的72.5%，Claude Computer Use的进化速度惊人。当OSWorld得分突破人类基准时，我们将见证AI Agent从"演示玩具"进化为"生产力工具"的历史时刻。

---

**相关阅读**：
- [14.13-Claude 家族总览](../../14.13-Claude.md)
- [07-Claude-3.5-Sonnet 编码能力突破与Agent化交互设计](../07-Claude-3.5-Sonnet/05-07-Claude-3.5-Sonnet-编码能力突破与Agent化交互设计.md)
- [05-Gemini-2.0-Pro 原生多模态输出与Agentic工具链](../../14.11-Gemini/05-Gemini-2.0-Pro/05-05-Gemini-2.0-Pro-原生多模态输出与Agentic工具链.md)
