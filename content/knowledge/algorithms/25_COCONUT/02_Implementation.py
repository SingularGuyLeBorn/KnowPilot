import torch
import torch.nn as nn

class LatentThoughtModel(nn.Module):
    """
    COCONUT: Chain of Continuous Thought Concept Demo
    Demonstrates bypassing the discrete tokenizer for reasoning steps.
    """
    def __init__(self, vocab_size=1000, dim=64):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, dim)
        # Simplified Transformer Block
        self.backbone = nn.GRU(dim, dim, batch_first=True) 
        self.lm_head = nn.Linear(dim, vocab_size)
    
    def forward(self, input_ids, thought_steps=3):
        """
        input_ids: [B, SeqLen] (Problem Prompt)
        thought_steps: How many steps to think in latent space
        """
        B = input_ids.shape[0]
        
        # 1. Process Prompt (Discrete -> Continuous)
        embeds = self.embedding(input_ids)
        hidden, last_state = self.backbone(embeds) # hidden: [B, L, D]
        
        # Current 'Thought' Vector (initialized from last state)
        current_thought = last_state.transpose(0, 1) # [B, 1, D]
        
        thought_trace = []
        
        # 2. Continuous Reasoning Loop (Latent Space)
        # Note: No argmax, no discrete tokens here!
        for _ in range(thought_steps):
            # Pass the thought vector directly back into the model
            # In a real Transformer, this would be attention over past KV cache
            out, _ = self.backbone(current_thought) 
            
            # Update thought vector
            current_thought = out 
            thought_trace.append(current_thought)
            
        # 3. Decode Final Answer (Continuous -> Discrete)
        # After thinking, we generate the final answer 
        logits = self.lm_head(current_thought) # [B, 1, V]
        
        return logits, thought_trace

if __name__ == "__main__":
    model = LatentThoughtModel()
    input_ids = torch.tensor([[10, 20, 30]]) # "2 + 2"
    
    print("Step 1: Processing Prompt...")
    logits, traces = model(input_ids, thought_steps=5)
    
    print(f"Step 2: Thinking in Latent Space for 5 steps...")
    for i, t in enumerate(traces):
        print(f"  Thought Step {i+1}: Vector Norm = {t.norm().item():.4f}")
        
    print(f"Step 3: Final Logits Shape: {logits.shape}")
    print("Observation: The model transitioned from Prompt -> Latent Loop -> Answer without outputting words in between.")
