import torch
import torch.nn as nn
import torch.nn.functional as F

class LitePPO(nn.Module):
    """
    LitePPO: A minimalist PPO implementation focusing on Stability & Efficiency.
    Features:
    - Critic-Free Mode (Optional)
    - Strong Advantage Normalization
    - Token-level aggregation
    """
    def __init__(self, model, epsilon=0.2, lr=1e-5):
        super().__init__()
        self.model = model
        self.epsilon = epsilon
        self.optimizer = torch.optim.AdamW(self.model.parameters(), lr=lr)
    
    def compute_advantages(self, rewards, use_critic=False, values=None):
        """
        Lite Strategy: If no critic, use Mean-Std Normalization acting as a dynamic baseline.
        """
        if use_critic and values is not None:
             # Standard GAE-style advantage (Simplified)
            adv = rewards - values.detach()
        else:
            # Critic-Free: Just normalize the rewards batch-wise
            # This is surprisingly effective (like GRPO but with Clipping)
            mean = rewards.mean()
            std = rewards.std() + 1e-8
            adv = (rewards - mean) / std
        return adv

    def update(self, batch):
        """
        batch: {
            'input_ids': [B, L],
            'old_log_probs': [B, L], # Pre-computed during rollout
            'rewards': [B]
        }
        """
        input_ids = batch['input_ids']
        old_log_probs = batch['old_log_probs']
        rewards = batch['rewards']
        
        # 1. Forward Pass (Get new log probs)
        # In reality, you'd mask out the prompt part
        outputs = self.model(input_ids)
        logits = outputs.logits # [B, L, V]
        
        # Gather log probs of the selected tokens
        new_log_probs = logits.log_softmax(dim=-1)
        # Assuming we just gather the correct indices... (Simplified for demo)
        # selection = input_ids... 
        # Here we pretend new_log_probs is already gathered [B, L]
        # For demo purposes, let's just use log_softmax on the target indices
        entropy = -(new_log_probs.exp() * new_log_probs).sum(dim=-1).mean()
        
        # 2. Compute Advantages (The "Lite" Magic)
        # We broadcast rewards to sequence length if needed, or just use last token
        advantages = self.compute_advantages(rewards, use_critic=False)
        # Broadcast [B] -> [B, L]
        advantages = advantages.unsqueeze(1).expand_as(old_log_probs)

        # 3. Ratio
        ratio = torch.exp(new_log_probs - old_log_probs)
        
        # 4. PPO Clip Loss
        surr1 = ratio * advantages
        surr2 = torch.clamp(ratio, 1 - self.epsilon, 1 + self.epsilon) * advantages
        loss = -torch.min(surr1, surr2).mean()
        
        # 5. Optimize
        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()
        
        return loss.item(), entropy.item()

# Mock Model
class MockTransformer(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = nn.Linear(10, 10)
    def forward(self, x):
        return type('Output', (), {'logits': torch.randn(x.shape[0], x.shape[1], 10, requires_grad=True)})()

if __name__ == "__main__":
    model = MockTransformer()
    trainer = LitePPO(model)
    
    # Mock Batch
    batch = {
        'input_ids': torch.randint(0, 10, (4, 10)),
        'old_log_probs': torch.randn(4, 10),
        'rewards': torch.tensor([1.0, -1.0, 0.5, -0.5])
    }
    
    loss, ent = trainer.update(batch)
    print(f"LitePPO Step - Loss: {loss:.4f}, Entropy: {ent:.4f}")
