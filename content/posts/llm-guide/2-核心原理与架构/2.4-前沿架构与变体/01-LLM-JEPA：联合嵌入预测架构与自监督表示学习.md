# LLM-JEPA：联合嵌入预测架构与自监督表示学习

> 来源: 知乎专栏 (https://zhuanlan.zhihu.com/p/32098458322)
> 标签: #JEPA #自监督学习 #表示学习 #EMA #SpanMasking

## 1. 演进脉络：从 Token 预测到表示预测

### 1.1 自监督学习的三代范式

| 代际 | 代表方法 | 预测目标 | 核心思想 | 局限 |
|------|---------|---------|---------|------|
| 第一代 | BERT (MLM) | 被遮蔽的 **token** | 从上下文推断缺失词 | 只在浅层学习, 高层表示质量有限 |
| 第二代 | MAE (CV) | 被遮蔽的 **像素块** | 从可见区域重建图像 | 像素级重建消耗计算, 且可能过拟合低频信息 |
| 第三代 | **JEPA** | 被遮蔽的 **嵌入表示** | 预测语义层面的表示, 而非具体 token | 避免像素/token级重建的冗余计算 |

JEPA(Joint Embedding Predictive Architecture)由 Yann LeCun 提出, 其核心洞察是：

> **"模型的真正目标不是预测下一个词, 而是学习世界的内部表示. "**

传统语言模型(GPT、BERT)通过预测 token 学习, 相当于强迫模型记忆词汇的统计规律. JEPA 则让模型在**表示空间**中预测——学习"这个被遮蔽的片段在语义上是什么意思", 而非"这个被遮蔽的位置具体是哪个词". 

### 1.2 LLM-JEPA 与 BERT 的本质区别

| 维度 | BERT (MLM) | LLM-JEPA |
|------|-----------|----------|
| **输入** | 单视图(部分 token 被 [MASK] 替换) | 双视图：Context(遮蔽)+ Target(完整) |
| **Encoder ** | 单个可训练Encoder  | Context Encoder (可训练)+ Target Encoder (EMA 冻结) |
| **预测目标** | Token ID(分类问题) | 嵌入向量(回归问题) |
| **损失函数** | Cross-Entropy | 余弦距离 |
| **监督信号** | 离散词汇表(有限信息) | 连续表示空间(丰富语义信息) |
| **计算效率** | 需在词汇表上计算 softmax | 仅计算向量距离 |

**关键优势**：JEPA 避免了在大型词汇表上做 softmax 分类的计算开销, 同时学习到的表示更聚焦于语义而非词汇形式. 

---

## 2. LLM-JEPA 的架构设计

### 2.1 双Encoder  + 预测器的三元结构

```
Input Text
    ├─→ Context View(遮蔽部分 span)
    │   └─→ Context Encoder(可训练 Transformer)
    │       └─→ z_ctx = Enc_ctx(masked_input_ids)
    │           └─→ Predictor(可训练 MLP)
    │               └─→ pred = MLP(z_ctx)
    │
    └─→ Target View(完整文本)
        └─→ Target Encoder(EMA 副本, 冻结梯度)
            └─→ z_tgt = Enc_tgt(input_ids)
                └─→ [只在遮蔽位置比较 pred vs z_tgt]
```

**三个核心组件**：

1. **Context Encoder** ($\text{Enc}_{\text{ctx}}$)：接收遮蔽后的文本, 生成上下文表示. **可训练**, 是模型学习的核心. 
2. **Target Encoder** ($\text{Enc}_{\text{tgt}}$)：接收完整文本, 生成目标表示. **不参与梯度回传**, 通过 EMA 缓慢更新. 
3. **Predictor** ($\text{MLP}$)：将 Context 表示映射到 Target 表示空间, 缩小二者的语义差距. 

### 2.2 为什么 Target Encoder 需要冻结 + EMA？

**问题**：如果 Target Encoder 也是可训练的, 模型可以通过"共谋"来最小化损失——Context 和 Target Encoder 同时坍塌到同一个常数向量, 损失为 0, 但什么都没学到(表示坍塌). 

**解决方案**：
- **冻结梯度**：Target Encoder 不参与反向传播, 其输出作为" ground truth "
- **EMA 更新**：Target Encoder 缓慢跟随 Context Encoder, 保持稳定性

$$
\theta_{\text{tgt}}^{(t+1)} = m \cdot \theta_{\text{tgt}}^{(t)} + (1-m) \cdot \theta_{\text{ctx}}^{(t)}
$$

其中 $m = 0.99$ 是动量系数. 这意味着 Target Encoder 的变化速度是 Context Encoder 的 1%. 

**类比**：Target Encoder 就像一个"老师", Context Encoder 是"学生". 学生每学一点新东西, 老师只更新 1%, 保持教学标准的稳定性. 如果老师更新太快($m$ 太小), 标准会跟着学生一起漂移; 如果老师完全不更新($m=1$), 标准会过时. 

### 2.3 Span Masking：遮蔽策略的关键

与 BERT 的随机 token 遮蔽不同, JEPA 采用 **Span Masking**——遮蔽连续的 token 片段：

```python
def sample_span_mask(seq_len, mask_ratio=0.3, mean_span_len=3):
    """采样连续 span 遮蔽位置
    
    Args:
        seq_len: 序列长度
        mask_ratio: 遮蔽比例(如 0.3 表示遮蔽 30% token)
        mean_span_len: 平均 span 长度
    
    Returns:
        mask: bool 张量, True 表示该位置被遮蔽
    """
    mask = torch.zeros(seq_len, dtype=torch.bool)
    target_to_mask = max(1, int(round(seq_len * mask_ratio)))
    masked = 0
    
    while masked < target_to_mask:
        # 从指数分布采样 span 长度：产出大量短 span + 少量长 span
        span_len = max(1, int(random.expovariate(1.0 / mean_span_len)))
        start = random.randint(0, seq_len - 1)
        
        # 过滤特殊 token 位置(CLS、SEP)
        valid_positions = [i for i in range(start, min(start + span_len, seq_len))
                          if i not in special_positions]
        
        for pos in valid_positions:
            if not mask[pos]:
                mask[pos] = True
                masked += 1
                if masked >= target_to_mask:
                    break
    
    return mask
```

**为什么 Span Masking 更好？**

- **语义完整性**：连续遮蔽迫使模型从更大范围的上下文推断语义, 而非记忆局部词汇共现
- **难度适中**：单个 token 遮蔽太简单, 整句遮蔽太难, span 长度提供了可调节的难度梯度
- **指数分布**：`expovariate(1.0 / mean_span_len)` 产生大量短 span 和少量长 span, 符合自然语言中语义单元的分布

---

## 3. 损失函数：表示空间中的余弦距离

### 3.1 损失定义

JEPA 的损失在**表示空间**中计算, 而非词汇表空间：

$$
\mathcal{L}_{\text{JEPA}} = 1 - \frac{\text{pred} \cdot z_{\text{tgt}}}{\|\text{pred}\| \cdot \|z_{\text{tgt}}\|}
$$

即 **1 - 余弦相似度**. 当预测表示与目标表示方向完全一致时, 损失为 0. 

**归一化的必要性**：

```python
masked_pred = F.normalize(masked_pred, dim=-1)  # [N, D]
masked_tgt = F.normalize(masked_tgt, dim=-1)    # [N, D]

# 余弦距离 = 1 - 余弦相似度
loss = 1.0 - (masked_pred * masked_tgt).sum(dim=-1)
```

归一化确保损失只关注**向量方向**(语义方向), 忽略向量大小. 这避免了模型通过简单缩放嵌入维度来"作弊"最小化损失. 

### 3.2 为什么不用 MSE？

MSE(均方误差)也可以衡量向量差异, 但余弦距离更适合表示学习：

| 特性 | MSE | 余弦距离 |
|------|-----|---------|
| 关注 | 绝对数值差异 | 方向一致性 |
| 对缩放的敏感度 | 高(大向量惩罚重) | 无(归一化后) |
| 语义解释 | "这两个表示数值差多少" | "这两个表示指向同一语义方向吗" |
| 在高维空间 | 容易饱和 | 保持区分度 |

在语义表示学习中, **方向比绝对值更重要**——两个嵌入即使长度不同, 只要方向相同, 就代表相同的语义. 

---

## 4. 完整训练流程

### 4.1 数据流

```python
def collate_jepa(batch_texts, tokenizer, max_length, mask_ratio, mean_span_len):
    # 1. Tokenize
    toks = tokenizer(batch_texts, padding=True, truncation=True, 
                     max_length=max_length, return_tensors="pt")
    input_ids = toks["input_ids"]          # [B, L]
    attention_mask = toks["attention_mask"]  # [B, L]
    
    # 2. 对每个样本生成遮蔽版本
    masked_input_ids_list = []
    pred_mask_list = []
    
    for b in range(input_ids.size(0)):
        mi, pm = apply_mask_to_input_ids(
            input_ids[b], attention_mask[b], tokenizer,
            mask_ratio=mask_ratio, mean_span_len=mean_span_len
        )
        masked_input_ids_list.append(mi)
        pred_mask_list.append(pm)
    
    return Batch(
        input_ids=input_ids,
        attention_mask=attention_mask,
        masked_input_ids=torch.stack(masked_input_ids_list),
        pred_mask=torch.stack(pred_mask_list),
    )
```

### 4.2 前向传播

```python
class LLMJEPA(nn.Module):
    def __init__(self, context_encoder, target_encoder, dim, ema_m=0.99):
        super().__init__()
        self.context_encoder = context_encoder  # 可训练
        self.target_encoder = target_encoder    # 冻结梯度
        self.predictor = PredictorMLP(dim)      # 可训练
        self.ema_m = ema_m
        
        # Target encoder 初始化为 Context encoder 的深拷贝
        self.target_encoder.load_state_dict(context_encoder.state_dict())
        for p in self.target_encoder.parameters():
            p.requires_grad = False
    
    def ema_update(self):
        """每次优化器 step 后调用"""
        with torch.no_grad():
            for p_tgt, p_ctx in zip(self.target_encoder.parameters(),
                                    self.context_encoder.parameters()):
                p_tgt.data.mul_(self.ema_m).add_(p_ctx.data, alpha=1 - self.ema_m)
    
    def forward(self, masked_input_ids, input_ids, attention_mask, pred_mask):
        # Context 路径：可训练
        out_ctx = self.context_encoder(
            input_ids=masked_input_ids, 
            attention_mask=attention_mask
        )
        z_ctx = out_ctx.last_hidden_state  # [B, L, D]
        
        # Target 路径：冻结梯度
        with torch.no_grad():
            out_tgt = self.target_encoder(
                input_ids=input_ids, 
                attention_mask=attention_mask
            )
            z_tgt = out_tgt.last_hidden_state  # [B, L, D]
        
        # Predictor：将 Context 表示映射到 Target 空间
        pred = self.predictor(z_ctx)  # [B, L, D]
        
        # 只在遮蔽位置计算损失
        masked_pred = pred[pred_mask]    # [N, D]
        masked_tgt = z_tgt[pred_mask]    # [N, D]
        
        # 归一化 + 余弦距离
        masked_pred = F.normalize(masked_pred, dim=-1)
        masked_tgt = F.normalize(masked_tgt, dim=-1)
        
        loss = 1.0 - (masked_pred * masked_tgt).sum(dim=-1)
        return loss.mean()
```

### 4.3 训练循环

```python
# 训练主循环
while step < args.steps:
    batch = next(data_iter)
    
    # 前向传播
    loss = model(
        masked_input_ids=batch.masked_input_ids.to(device),
        input_ids=batch.input_ids.to(device),
        attention_mask=batch.attention_mask.to(device),
        pred_mask=batch.pred_mask.to(device),
    )
    
    # 反向传播
    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    
    # EMA 更新(关键！必须在 optimizer.step() 之后)
    model.ema_update()
    
    step += 1
```

**EMA 更新时机**：必须在 `optimizer.step()` 之后, 因为 EMA 需要基于更新后的 Context Encoder 参数来更新 Target Encoder. 

---

## 5. JEPA 与对比学习的区别

### 5.1 自监督学习的两大路线

| 维度 | 对比学习(SimCLR, MoCo) | JEPA |
|------|------------------------|------|
| **核心思想** | "正样本拉近, 负样本推远" | "从部分信息预测完整表示" |
| **需要负样本** | **是**(需要大量负样本) | **否**(无需负样本) |
| **数据增强** | 强依赖(裁剪、颜色抖动等) | 轻依赖(仅 span masking) |
| **表示坍塌风险** | 有(所有样本坍塌到同一点) | 有(需 EMA 防止) |
| **损失函数** | InfoNCE(基于 softmax) | 余弦距离(直接回归) |

### 5.2 为什么 JEPA 不需要负样本？

对比学习需要负样本的原因是：如果没有"推远"的信号, 模型会把所有样本映射到同一个点(表示坍塌). 

JEPA 通过以下机制避免了这一问题：
1. **预测任务本身提供约束**：模型必须从部分信息(遮蔽文本)预测完整表示, 这天然要求模型学习有意义的语义结构
2. **EMA Target Encoder 提供稳定目标**：Target Encoder 的缓慢更新确保了预测目标不会随训练漂移, 防止"共谋坍塌"
3. **Predictor 的瓶颈设计**：MLP 预测器作为一个"适配器", 限制了表示空间的自由度

---

## 6. 边界条件与失效模式

| 场景 | 症状 | 根因 | 缓解 |
|------|------|------|------|
| EMA 动量过大 ($m \to 1$) | 训练停滞, loss 不再下降 | Target Encoder 更新过慢, 标准长期过时 | 降低 $m$ 至 0.95-0.99 |
| EMA 动量过小 ($m \to 0$) | 表示坍塌, loss 突降至 0 | Target Encoder 紧跟 Context, 共谋坍塌 | 提高 $m$ 至 0.999+ |
| Span 过长 | 遮蔽信息过多, 预测困难 | mask_ratio 或 mean_span_len 过大 | 降低 mask_ratio 至 0.15-0.3 |
| Span 过短 | 任务太简单, 学不到深层表示 | 接近 token-level masking | 提高 mean_span_len 至 5-10 |
| Predictor 过深 | 训练不稳定, 梯度爆炸 | MLP 层数过多引入非线性复杂度 | 保持 Predictor 为 2-3 层 MLP |
| 无 Predictor | Context 和 Target 表示空间不对齐 | 直接比较Encoder 输出 | 始终保留 Predictor 作为适配器 |

---

## 7. 技术前瞻

1. **多模态 JEPA**：将 JEPA 从纯文本扩展到图像-文本-视频统一架构, 学习跨模态的共享表示空间
2. **JEPA + Next Token Prediction 混合目标**：原始 LLM-JEPA 论文已将表示预测与 token 预测结合, 兼顾语义理解和生成能力
3. **世界模型(World Model)**：JEPA 的本质是世界模型的一种实现——学习环境的内部动力学, 支持"想象"和规划
4. **与 MoE 的结合**：JEPA 的表示学习可作为 MoE 路由器的预训练目标, 提升专家分配的语义一致性

---

## 8. 参考文献

1. LeCun, Y. (2022). A Path Towards Autonomous Machine Intelligence. Open Review.
2. Assran, M., et al. (2023). Self-Supervised Learning from Images with a Joint-Embedding Predictive Architecture. CVPR. (I-JEPA)
3. LLM-JEPA: Large Language Models Meet Joint Embedding Predictive Architectures. arXiv:2509.14252.
4. Devlin, J., et al. (2019). BERT: Pre-training of Deep Bidirectional Transformers. NAACL.
5. He, K., et al. (2022). Masked Autoencoders Are Scalable Vision Learners. CVPR. (MAE)
