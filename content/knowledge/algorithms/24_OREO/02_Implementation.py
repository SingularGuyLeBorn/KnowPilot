import torch
import torch.nn as nn
import torch.nn.functional as F

class OREOTrainer(nn.Module):
    """
    OREO: Offline Reasoning Optimization
    A simplified implementation focusing on Value-Weighted Regression.
    """
    def __init__(self, policy_model, value_model, alpha=0.1):
        super().__init__()
        self.policy_model = policy_model
        # Value Model predicts Q(s, a) for each token/step
        self.value_model = value_model 
        self.alpha = alpha
        
        self.opt_policy = torch.optim.AdamW(policy_model.parameters(), lr=1e-5)
        self.opt_value = torch.optim.AdamW(value_model.parameters(), lr=1e-4)

    def update(self, batch):
        """
        batch: {
            'input_ids': [B, L],
            'rewards': [B], # Sparse rewards for the whole sequence
            'masks': [B, L] # Padding masks
        }
        """
        input_ids = batch['input_ids']
        rewards = batch['rewards']
        
        # --- 1. Value Step (Bellman Update) ---
        # Predict Value for all tokens
        values = self.value_model(input_ids) # [B, L, 1]
        
        # Target: For Offline RL, we often use MC Return or One-Step Bootstrap
        # Here we use simplified MC Return: every step predicts final reward
        # (Rigorous OREO solves Soft Bellman, simplified here for demo)
        target_values = rewards.unsqueeze(1).expand_as(values)
        
        value_loss = F.mse_loss(values, target_values)
        
        self.opt_value.zero_grad()
        value_loss.backward()
        self.opt_value.step()
        
        # --- 2. Policy Step (Weighted BC) ---
        # AWR/CRR: Weight = exp(Advantage / alpha)
        # Advantage = R - V(s)
        
        # Valid logic:
        # weights = exp((Q - V) / alpha) or exp((R - V) / alpha)
        # Here target_values is our 'R' (Broadcasted Reward).
        # We use target_values which was defined earlier in the method.
        advantage = target_values - values.detach()
        
        weights = torch.exp(advantage / self.alpha)
        # Normalize weights for stability
        weights = weights / (weights.mean() + 1e-8)
        
        outputs = self.policy_model(input_ids)
        logits = outputs.logits # [B, L, V]
        
        # Standard Next-Token Prediction Loss (Weighted)
        # Shift inputs for labels
        shift_logits = logits[..., :-1, :].contiguous()
        shift_labels = input_ids[..., 1:].contiguous()
        shift_weights = weights[..., :-1, 0].contiguous()
        
        loss_fct = nn.CrossEntropyLoss(reduction='none')
        raw_loss = loss_fct(shift_logits.view(-1, 50257), shift_labels.view(-1))
        
        # Apply Weights
        policy_loss = (raw_loss * shift_weights.view(-1)).mean()
        
        self.opt_policy.zero_grad()
        policy_loss.backward()
        self.opt_policy.step()
        
        return policy_loss.item(), value_loss.item()

# Mock Models
class MockValue(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = nn.Linear(10, 1)
    def forward(self, x):
        return torch.randn(x.shape[0], x.shape[1], 1)

class MockTransformer(nn.Module):
    def __init__(self):
        super().__init__()
        self.dummy = nn.Linear(1, 1) # Dummy parameter for optimizer
    def forward(self, x):
        # We need to make sure the output depends on the parameter so gradients flow? 
        # Actually, for the optimizer check, just having a parameter is enough to init.
        # But for backward() to work and update something, we might want it to be part of the graph.
        # However, since we mock the logits with requires_grad=True, the gradients will flow to that tensor but not to the model parameters unless we compute logits from parameters.
        # For this simple "runnable" check, just having a parameter is enough to stop the crash.
        return type('Output', (), {'logits': torch.randn(x.shape[0], x.shape[1], 50257, requires_grad=True)})()

if __name__ == "__main__":
    policy = MockTransformer()
    value = MockValue()
    trainer = OREOTrainer(policy, value)
    
    batch = {
        'input_ids': torch.randint(0, 10, (4, 10)),
        'rewards': torch.randn(4)
    }
    
    pl, vl = trainer.update(batch)
    print(f"OREO Update - Policy Loss: {pl:.4f}, Value Loss: {vl:.4f}")
