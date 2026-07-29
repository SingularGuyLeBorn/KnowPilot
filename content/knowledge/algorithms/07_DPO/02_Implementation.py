"""
算法名称: Direct Preference Optimization (DPO)
论文: Direct Preference Optimization: Your Language Model is Secretly a Reward Model
作者: Rafael Rafailov et al. (Stanford)
年份: 2023
arXiv: 2305.18290

核心创新:
1. 证明语言模型可以作为隐式奖励模型
2. 跳过奖励模型训练，直接从偏好数据优化策略
3. 将RLHF的3阶段简化为1阶段

核心公式:
$$
\\mathcal{L}_{DPO} = -\\mathbb{E}\\left[\\log\\sigma\\left(\\beta\\log\\frac{\\pi_\\theta(y_w|x)}{\\pi_{ref}(y_w|x)} - \\beta\\log\\frac{\\pi_\\theta(y_l|x)}{\\pi_{ref}(y_l|x)}\\right)\\right]
$$

参考实现:
- TRL: https://github.com/huggingface/trl
- verl: https://github.com/volcengine/verl
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, Dict, Optional
from dataclasses import dataclass
import math

# ============================================
# 第一部分: 配置类
# ============================================

@dataclass
class DPOConfig:
    """DPO算法超参数配置
    
    Attributes:
        beta: KL惩罚系数，控制策略与参考模型的偏离程度
              较大的beta → 策略更保守，更接近参考模型
              较小的beta → 策略更激进，可能偏离更多
        label_smoothing: 标签平滑系数，防止过拟合
        loss_type: 损失类型 "sigmoid" (原始DPO) 或 "hinge"
        reference_free: 是否使用无参考模型变体 (SimPO风格)
    """
    beta: float = 0.1
    label_smoothing: float = 0.0
    loss_type: str = "sigmoid"  # "sigmoid" | "hinge" | "ipo"
    reference_free: bool = False
    
    # 训练参数
    learning_rate: float = 5e-7
    batch_size: int = 4
    max_length: int = 512

# ============================================
# 第二部分: 核心损失函数
# ============================================

def compute_dpo_loss(
    policy_chosen_logps: torch.Tensor,    # [B] 策略模型对chosen的log概率
    policy_rejected_logps: torch.Tensor,  # [B] 策略模型对rejected的log概率
    reference_chosen_logps: torch.Tensor, # [B] 参考模型对chosen的log概率
    reference_rejected_logps: torch.Tensor,# [B] 参考模型对rejected的log概率
    beta: float = 0.1,
    label_smoothing: float = 0.0,
    loss_type: str = "sigmoid"
) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
    """
    计算DPO损失
    
    数学公式:
    $$
    L = -\\log\\sigma(\\beta(\\log\\frac{\\pi_\\theta(y_w)}{\\pi_{ref}(y_w)} - \\log\\frac{\\pi_\\theta(y_l)}{\\pi_{ref}(y_l)}))
    $$
    
    等价于:
    $$
    L = -\\log\\sigma(\\beta(\\hat{r}(y_w) - \\hat{r}(y_l)))
    $$
    
    其中隐式奖励 $\\hat{r}(y) = \\log\\frac{\\pi_\\theta(y)}{\\pi_{ref}(y)}$
    
    Args:
        policy_chosen_logps: 当前策略对chosen response的log概率
        policy_rejected_logps: 当前策略对rejected response的log概率
        reference_chosen_logps: 参考策略对chosen response的log概率
        reference_rejected_logps: 参考策略对rejected response的log概率
        beta: KL惩罚系数
        label_smoothing: 标签平滑
        loss_type: 损失类型
        
    Returns:
        loss: 标量损失
        metrics: 调试指标
    """
    # 步骤1: 计算隐式奖励
    # π_chosen_logratios = log π_θ(y_w) - log π_ref(y_w)
    pi_logratios_chosen = policy_chosen_logps - reference_chosen_logps
    pi_logratios_rejected = policy_rejected_logps - reference_rejected_logps
    
    # 步骤2: 计算隐式奖励差
    # Δr = β * (log(π_θ(y_w)/π_ref(y_w)) - log(π_θ(y_l)/π_ref(y_l)))
    logits = beta * (pi_logratios_chosen - pi_logratios_rejected)
    
    # 步骤3: 计算损失
    if loss_type == "sigmoid":
        # 原始DPO: -log σ(Δr)
        if label_smoothing > 0:
            # 带标签平滑的版本
            losses = (
                -F.logsigmoid(logits) * (1 - label_smoothing) +
                -F.logsigmoid(-logits) * label_smoothing
            )
        else:
            losses = -F.logsigmoid(logits)
            
    elif loss_type == "hinge":
        # Hinge损失变体
        losses = F.relu(1 - logits)
        
    elif loss_type == "ipo":
        # IPO: (Δr - 1/β)^2
        losses = (logits - 1.0 / beta) ** 2
        
    else:
        raise ValueError(f"Unknown loss type: {loss_type}")
    
    loss = losses.mean()
    
    # 计算调试指标
    with torch.no_grad():
        # 隐式奖励
        chosen_rewards = beta * pi_logratios_chosen
        rejected_rewards = beta * pi_logratios_rejected
        
        # 准确率: 模型是否正确地偏好chosen
        reward_accuracies = (chosen_rewards > rejected_rewards).float()
        
        # 奖励边界
        reward_margins = chosen_rewards - rejected_rewards
        
    metrics = {
        "loss": loss.detach(),
        "chosen_rewards": chosen_rewards.mean().detach(),
        "rejected_rewards": rejected_rewards.mean().detach(),
        "reward_accuracy": reward_accuracies.mean().detach(),
        "reward_margin": reward_margins.mean().detach(),
        "logits": logits.mean().detach(),
    }
    
    return loss, metrics

# ============================================
# 第三部分: 无参考模型变体 (SimPO风格)
# ============================================

def compute_dpo_loss_reference_free(
    policy_chosen_logps: torch.Tensor,
    policy_rejected_logps: torch.Tensor,
    beta: float = 0.1,
    gamma: float = 0.5,  # margin参数
) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
    """
    无参考模型的DPO变体 (类似SimPO)
    
    公式:
    $$
    L = -\\log\\sigma(\\beta(\\log\\pi_\\theta(y_w) - \\log\\pi_\\theta(y_l)) - \\gamma)
    $$
    
    无需保存参考模型，节省显存. 
    通过margin参数γ控制偏好强度. 
    """
    logits = beta * (policy_chosen_logps - policy_rejected_logps) - gamma
    losses = -F.logsigmoid(logits)
    loss = losses.mean()
    
    with torch.no_grad():
        reward_accuracies = (policy_chosen_logps > policy_rejected_logps).float()
    
    metrics = {
        "loss": loss.detach(),
        "reward_accuracy": reward_accuracies.mean().detach(),
        "logits": logits.mean().detach(),
    }
    
    return loss, metrics

# ============================================
# 第四部分: 序列对数概率计算
# ============================================

def compute_log_probs(
    logits: torch.Tensor,      # [B, T, V] 模型输出的logits
    labels: torch.Tensor,      # [B, T] 目标token ids
    attention_mask: torch.Tensor,  # [B, T] 注意力掩码
    average_log_prob: bool = False  # 是否平均(用于长度归一化)
) -> torch.Tensor:
    """
    计算序列的对数概率
    
    这是DPO中将语言模型输出转换为log π(y|x)的关键函数
    
    Args:
        logits: 语言模型输出的logits [batch, seq_len, vocab_size]
        labels: 目标token序列 [batch, seq_len]
        attention_mask: 掩码，标记有效token [batch, seq_len]
        average_log_prob: 如果True，返回平均log概率(用于长度归一化)
        
    Returns:
        log_probs: 序列log概率 [batch]
    """
    # 右移labels以对齐
    # logits[t]预测labels[t+1]
    labels = labels[:, 1:].clone()
    logits = logits[:, :-1, :]
    attention_mask = attention_mask[:, 1:].clone()
    
    # 计算每个位置的log概率
    # log_softmax得到 [B, T-1, V]
    log_probs_all = F.log_softmax(logits, dim=-1)
    
    # 提取目标token的log概率
    # gather沿着vocab维度，取labels对应的概率
    # [B, T-1]
    per_token_logps = torch.gather(
        log_probs_all, 
        dim=2, 
        index=labels.unsqueeze(-1)
    ).squeeze(-1)
    
    # 应用掩码(忽略padding)
    per_token_logps = per_token_logps * attention_mask
    
    if average_log_prob:
        # 平均log概率(用于SimPO的长度归一化)
        return per_token_logps.sum(dim=-1) / attention_mask.sum(dim=-1).clamp(min=1)
    else:
        # 总log概率
        return per_token_logps.sum(dim=-1)

# ============================================
# 第五部分: DPO训练器
# ============================================

class DPOTrainer:
    """
    DPO训练器
    
    封装模型、参考模型、优化器
    """
    def __init__(
        self,
        model: nn.Module,
        ref_model: nn.Module,
        config: DPOConfig
    ):
        self.model = model
        self.ref_model = ref_model
        self.config = config
        
        # 冻结参考模型
        for param in self.ref_model.parameters():
            param.requires_grad = False
            
        # 优化器
        self.optimizer = torch.optim.AdamW(
            self.model.parameters(),
            lr=config.learning_rate
        )
    
    def compute_reference_log_probs(
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor,
        labels: torch.Tensor
    ) -> torch.Tensor:
        """计算参考模型的log概率"""
        with torch.no_grad():
            ref_logits = self.ref_model(
                input_ids=input_ids,
                attention_mask=attention_mask
            ).logits
            ref_log_probs = compute_log_probs(ref_logits, labels, attention_mask)
        return ref_log_probs
    
    def train_step(
        self,
        chosen_input_ids: torch.Tensor,
        chosen_attention_mask: torch.Tensor,
        chosen_labels: torch.Tensor,
        rejected_input_ids: torch.Tensor,
        rejected_attention_mask: torch.Tensor,
        rejected_labels: torch.Tensor
    ) -> Dict[str, float]:
        """
        DPO单步训练
        
        Args:
            chosen_*: 人类偏好的response
            rejected_*: 人类不偏好的response
            
        Returns:
            metrics: 训练指标
        """
        self.model.train()
        
        # 1. 计算策略模型的log概率
        policy_chosen_logits = self.model(
            input_ids=chosen_input_ids,
            attention_mask=chosen_attention_mask
        ).logits
        policy_chosen_logps = compute_log_probs(
            policy_chosen_logits, chosen_labels, chosen_attention_mask
        )
        
        policy_rejected_logits = self.model(
            input_ids=rejected_input_ids,
            attention_mask=rejected_attention_mask
        ).logits
        policy_rejected_logps = compute_log_probs(
            policy_rejected_logits, rejected_labels, rejected_attention_mask
        )
        
        # 2. 计算参考模型的log概率
        ref_chosen_logps = self.compute_reference_log_probs(
            chosen_input_ids, chosen_attention_mask, chosen_labels
        )
        ref_rejected_logps = self.compute_reference_log_probs(
            rejected_input_ids, rejected_attention_mask, rejected_labels
        )
        
        # 3. 计算DPO损失
        if self.config.reference_free:
            loss, metrics = compute_dpo_loss_reference_free(
                policy_chosen_logps, policy_rejected_logps, self.config.beta
            )
        else:
            loss, metrics = compute_dpo_loss(
                policy_chosen_logps, policy_rejected_logps,
                ref_chosen_logps, ref_rejected_logps,
                self.config.beta, self.config.label_smoothing, self.config.loss_type
            )
        
        # 4. 反向传播
        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()
        
        return {k: v.item() if torch.is_tensor(v) else v for k, v in metrics.items()}

# ============================================
# 第六部分: 简单模型用于测试
# ============================================

class SimpleLM(nn.Module):
    """简单语言模型用于测试DPO"""
    def __init__(self, vocab_size: int = 1000, hidden_size: int = 128):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, hidden_size)
        self.lstm = nn.LSTM(hidden_size, hidden_size, batch_first=True)
        self.lm_head = nn.Linear(hidden_size, vocab_size)
        
    def forward(self, input_ids, attention_mask=None):
        x = self.embedding(input_ids)
        x, _ = self.lstm(x)
        logits = self.lm_head(x)
        
        # 返回类似HuggingFace格式的输出
        class Output:
            def __init__(self, logits):
                self.logits = logits
        return Output(logits)

# ============================================
# 第七部分: 使用示例
# ============================================

if __name__ == "__main__":
    print("=" * 60)
    print("DPO (Direct Preference Optimization) 演示")
    print("=" * 60)
    
    # 配置
    config = DPOConfig(beta=0.1, loss_type="sigmoid")
    
    # 初始化模型
    model = SimpleLM(vocab_size=1000, hidden_size=64)
    ref_model = SimpleLM(vocab_size=1000, hidden_size=64)
    ref_model.load_state_dict(model.state_dict())  # 复制权重
    
    # 模拟偏好数据
    batch_size = 4
    seq_len = 32
    
    # 随机生成input_ids作为演示
    chosen_ids = torch.randint(0, 1000, (batch_size, seq_len))
    rejected_ids = torch.randint(0, 1000, (batch_size, seq_len))
    attention_mask = torch.ones(batch_size, seq_len)
    
    # 计算log概率
    with torch.no_grad():
        policy_chosen = model(chosen_ids, attention_mask)
        policy_rejected = model(rejected_ids, attention_mask)
        ref_chosen = ref_model(chosen_ids, attention_mask)
        ref_rejected = ref_model(rejected_ids, attention_mask)
        
        policy_chosen_logps = compute_log_probs(
            policy_chosen.logits, chosen_ids, attention_mask
        )
        policy_rejected_logps = compute_log_probs(
            policy_rejected.logits, rejected_ids, attention_mask
        )
        ref_chosen_logps = compute_log_probs(
            ref_chosen.logits, chosen_ids, attention_mask
        )
        ref_rejected_logps = compute_log_probs(
            ref_rejected.logits, rejected_ids, attention_mask
        )
    
    # 计算DPO损失
    loss, metrics = compute_dpo_loss(
        policy_chosen_logps, policy_rejected_logps,
        ref_chosen_logps, ref_rejected_logps,
        beta=config.beta
    )
    
    print(f"\nDPO损失: {loss.item():.4f}")
    print(f"奖励准确率: {metrics['reward_accuracy'].item():.2%}")
    print(f"Chosen奖励: {metrics['chosen_rewards'].item():.4f}")
    print(f"Rejected奖励: {metrics['rejected_rewards'].item():.4f}")
    print(f"奖励边界: {metrics['reward_margin'].item():.4f}")
    
    print("\n" + "=" * 60)
    print("DPO核心公式:")
    print("L = -log σ(β(log π_θ(y_w)/π_ref(y_w) - log π_θ(y_l)/π_ref(y_l)))")
    print("=" * 60)
