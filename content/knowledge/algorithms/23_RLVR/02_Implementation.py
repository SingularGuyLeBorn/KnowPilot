import re

class MathVerifier:
    """
    A deterministic verifier for arithmetic problems.
    Simulating the 'Compiler' or 'Judge' in RLVR.
    """
    def __init__(self):
        pass
    
    def check(self, problem, solution_text):
        """
        Extracts the final answer from solution text and compares with ground truth.
        Problem: "2 + 2"
        Solution: "Thinking... 2+2 is 4. The answer is \boxed{4}."
        """
        # 1. Solve Ground Truth
        try:
            ground_truth = eval(problem)
        except:
            return 0.0 # Invalid problem
            
        # 2. Extract Answer (Looking for \boxed{x})
        match = re.search(r'\\boxed\{(\d+)\}', solution_text)
        if match:
            student_answer = int(match.group(1))
            if student_answer == ground_truth:
                return 1.0 # Perfect!
            else:
                return -1.0 # Wrong answer
        else:
            return -0.5 # Format error (No boxed answer)

class ReasoningEnvironment:
    def __init__(self):
        self.verifier = MathVerifier()
        self.problems = ["15 + 27", "10 * 5", "100 - 1", "12 / 4"]
    
    def sample_problem(self):
        import random
        return random.choice(self.problems)
    
    def get_reward(self, problem, completion):
        return self.verifier.check(problem, completion)

# --- 3. The Missing Piece: The Agent ---
class SimpleAgent:
    """
    A mock Language Model agent that generates solutions.
    In reality, this would be a local LLM (e.g., DeepSeek-Math-7B).
    """
    def __init__(self):
        self.knowledge = {
            "15 + 27": [
                "Thinking... 10+20=30, 5+7=12. Sum is 42. \\boxed{42}", # Correct
                "It is clearly 40. \\boxed{40}", # Wrong
                "Maybe 42?" # Format Error
            ],
            "10 * 5": ["50. \\boxed{50}", "55. \\boxed{55}"]
        }
    
    def generate(self, problem):
        """
        Simulates sampling from the policy \pi_\theta(a|s).
        Returns: solution_text, log_prob (mocked)
        """
        import random
        # Default fallback for unknown problems
        options = self.knowledge.get(problem, ["I don't know. \\boxed{0}"])
        completion = random.choice(options)
        return completion

    def update(self, reward):
        """
        Mock update step (e.g., GRPO or PPO).
        """
        # In a real scenario: loss = -log_prob * reward
        pass

# --- 4. The Training Loop ---
if __name__ == "__main__":
    env = ReasoningEnvironment()
    agent = SimpleAgent()
    
    print(f"{'='*20} RLVR Training Loop Demo {'='*20}")
    print("Goal: Optimize policy to maximize Verifiable Reward.\n")
    
    for episode in range(5):
        # 1. Environment provides a problem (State)
        problem = env.sample_problem()
        
        # 2. Agent generates a solution (Action)
        # DeepSeek R1 Trick: This step is where 'Thinking' happens
        solution = agent.generate(problem)
        
        # 3. Environment verifies the solution (Reward)
        # Deterministic, Binary, Verifiable
        reward = env.get_reward(problem, solution)
        
        # 4. Agent updates policy (Learning)
        agent.update(reward)
        
        print(f"Ep {episode+1} | Problem: {problem.ljust(10)} | Reward: {reward: .1f} | Output: {solution[:40]}...")
        
    print(f"\n{'='*60}")
    print("Key Takeaway: The Verifier provides the Ground Truth signal.")
    print("RL optimizes the Agent to produce outputs satisfying the Verifier.")

