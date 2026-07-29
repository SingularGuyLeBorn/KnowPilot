"""
算法名称: Guided Distribution Policy Optimization (GDPO)
别名: SteerLM (Attribute Conditioned SFT)
论文: SteerLM: Attribute Conditioned SFT as an (User-Friendly) RLHF Alternative (NVIDIA)
arXiv: 2310.10696

核心思想:
- 将 RL 视为条件生成 (Conditional Generation)
- 在 SFT 输入中通过 Prompt 显式加入属性标签 (Attributes)
- 训练目标: P(y | x, attributes)

示例格式:
User: {prompt}
PA: helpfulness:9,correctness:9
Assistant: {response}
"""

import torch
import torch.nn as nn
from typing import Dict, List, Optional

def format_steerlm_prompt(
    prompt: str,
    attributes: Dict[str, int],
    template: str = "User: {prompt}\nPA: {attr_str}\nAssistant:"
) -> str:
    """
    构造 SteerLM 的 Prompt
    
    Args:
        prompt: 用户的问题
        attributes: 属性字典 {"helpfulness": 9}
    """
    # 格式化属性字符串, e.g., "helpfulness:9,correctness:8"
    attr_list = [f"{k}:{v}" for k, v in attributes.items()]
    attr_str = ",".join(attr_list)
    
    return template.format(prompt=prompt, attr_str=attr_str)

class SteerLMTrainer:
    """
    SteerLM 训练器 (实际上就是标准的 SFT Trainer)
    核心在于数据预处理
    """
    def __init__(self, model, tokenizer):
        self.model = model
        self.tokenizer = tokenizer
        
    def train_step(self, batch):
        """
        batch: {
            "prompts": [...], 
            "responses": [...],
            "attributes": [{"help": 9}, {"help": 2}, ...]
        }
        """
        inputs = []
        for p, r, attrs in zip(batch['prompts'], batch['responses'], batch['attributes']):
            full_text = format_steerlm_prompt(p, attrs) + " " + r
            inputs.append(full_text)
            
        # Standard SFT (Next Token Prediction)
        # Tokenize
        encodings = self.tokenizer(inputs, padding=True, return_tensors="pt")
        input_ids = encodings.input_ids
        attention_mask = encodings.attention_mask
        
        # Labels (Mask prompt part if needed)
        labels = input_ids.clone()
        
        # Forward
        outputs = self.model(input_ids, attention_mask=attention_mask, labels=labels)
        loss = outputs.loss
        
        loss.backward()
        # optimizer step...
        return loss.item()

# 演示
if __name__ == "__main__":
    prompt = "Write a poem about rust."
    
    # 推理时: 我们想要最好的结果
    target_attrs = {"helpfulness": 10, "correctness": 10, "creativity": 10}
    
    formatted_input = format_steerlm_prompt(prompt, target_attrs)
    print(f"--- Inference Input ---\n{formatted_input}")
    
    # 也可以用来做负面约束 (Negative Constraint)
    # "给我生成一个错误的回答" (用于合成数据或对比学习)
    bad_attrs = {"helpfulness": 0, "correctness": 0}
    bad_input = format_steerlm_prompt(prompt, bad_attrs)
    print(f"\n--- Bad Input ---\n{bad_input}")
