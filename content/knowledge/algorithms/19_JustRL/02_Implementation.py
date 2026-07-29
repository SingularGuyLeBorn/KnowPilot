import torch
import torch.nn as nn
import torch.nn.functional as F

class JustRLTrainer:
    """
    JustRL: A Minimalist RL Recipe for LLMs (Based on arXiv:2512.16649)
    
    Philosophy:
    - No Critic Network (Use Group Relative Reward)
    - No PPO Clipping (Trust Region via small LR & Batch Size)
    - No KL Penalty term in Loss (Use Early Stopping if needed)
    - Maximize Expected Reward directly via Group Policy Gradient
    """
    
    def __init__(self, model, optimizer, group_size=64):
        self.model = model
        self.optimizer = optimizer
        self.group_size = group_size
        
    def compute_loss(self, batch_prompts, batch_responses, batch_rewards):
        """
        JustRL Loss Calculation
        
        Args:
            batch_prompts: [B, Seq_Len]
            batch_responses: [B, Group_Size, Resp_Len]
            batch_rewards: [B, Group_Size] - Scalar rewards for each response
        """
        # 1. Compute Group Statistics (Mean, Std) for Baseline
        # Reward Normalization (The ONLY "Trick" JustRL keeps)
        # mean_r: [B, 1], std_r: [B, 1]
        mean_r = batch_rewards.mean(dim=1, keepdim=True)
        std_r = batch_rewards.std(dim=1, keepdim=True) + 1e-8
        
        # Advantages: [B, Group_Size]
        advantages = (batch_rewards - mean_r) / std_r
        
        # 2. Forward Pass to get Log Probabilities
        # We process [B * G] sequences
        # In practice, reshaping is needed.
        # logits: [B*G, Seq_Len, Vocab]
        logits = self.model(batch_prompts, batch_responses) 
        
        # Calculate Log Prob of the generated responses
        # log_probs: [B, Group_Size] (Sum of log_probs over response tokens)
        log_probs = self._gather_log_probs(logits, batch_responses)
        
        # 3. Policy Gradient Loss
        # L = - E [ A * log_pi ]
        # No Clipping, No KL penalty term.
        loss = - (advantages * log_probs).mean()
        
        return loss
    
    def _gather_log_probs(self, logits, labels):
        """
        Helper to gather log probabilities of label tokens.
        Simplified for demo.
        """
        # Standard Next-Token-Prediction LogProb gather
        # ... logic to gather log_softmax(logits) at label indices ...
        # resulting in sum over sequence length
        return torch.randn(labels.shape[0], labels.shape[1], requires_grad=True).sum(dim=1) # Dummy

    def train_step(self, dataloader):
        self.optimizer.zero_grad()
        # Simulation of a training step
        # 1. Sampling (Inference) - Done outside usually or inside via vLLM
        # 2. Reward Scoring - Done outside
        # 3. Backward
        
        # Mock data
        B = 2
        G = self.group_size
        rewards = torch.randn(B, G) # Random rewards
        prompts = torch.zeros(B, 10)
        responses = torch.zeros(B, G, 20)
        
        loss = self.compute_loss(prompts, responses, rewards)
        loss.backward()
        self.optimizer.step()
        
        return loss.item()

# Comparison with PPO
# PPO: Loss = min(r*A, clip(r)*A) - c1*V_loss + c2*Ent
# JustRL: Loss = - (A_group * log_pi)

if __name__ == "__main__":
    print("JustRL Implementation (Minimalist Recipe)")
    print("-----------------------------------------")
    print("Initializing Trainer...")
    # Mock Model
    model = nn.Linear(10, 10) 
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-6) # Small LR is key
    
    trainer = JustRLTrainer(model, optimizer, group_size=16)
    
    loss = trainer.train_step(None)
    print(f"Training Step Completed. Loss: {loss:.4f}")
    print("\nKey Takeaway: The implementation is < 50 lines of core logic.")
    print("No Critic Buffer, No GAE calculation, No Clipping logic.")
