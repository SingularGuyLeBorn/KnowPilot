# OLMoE: Open Mixture-of-Experts Language Models

![](images/a8400adbaa77ce2f94f53c17287b49080fd88ecb7520320090f6df34dd8b168d.jpg)

# Abstract

We introduce OLMOE,1 a fully open, state-of-the-art language model leveraging sparse Mixture-of-Experts (MoE). OLMOE-1B-7B has 7 billion (B) parameters but uses only 1B per input token. We pretrain it on 5 trillion tokens and further adapt it to create OLMOE-1B-7B-INSTRUCT. Our models outperform all available models with similar active parameters, even surpassing larger ones like Llama2-13B-Chat and DeepSeekMoE-16B. We present various experiments on MoE training, analyze routing in our model showing high specialization, and open-source all aspects of our work: model weights, training data, code, and logs.

![](images/3c094175f87a0c1ba58132d0332df8841a95b101091bb7a7677338e7e3a85b2a.jpg)

Model hf.co/allenai/OLMoE-1B-7B-0924

Data hf.co/datasets/allenai/OLMoE-mix-0924

![](images/d618f44c8bf03a65f6d4aa6d178b84c6f31d96cabe582363d24d3c0adb972945.jpg)

Code github.com/allenai/OLMoE

![](images/353cb0fc8cb8dde0d68c2e92bbe05b71ff5be575504d05b96da16f62e7d4de9d.jpg)

Logs wandb.ai/ai2-llm/olmoe/reports/ OLMoE-1B-7B-0924--Vmlldzo4OTcyMjU3

![](images/1886d99383ed1435d6e5f3c6806131379ed548d98073aa094af84789d83a821c.jpg)

<details>
<summary>scatter</summary>

| Model | Name | Model | Cost (Billion active parameters) | Performance (% MMLU) | Best performance/cost ratio |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Grok-86B-314B | Grok-86B-314B | Data | 1 | 65 | 65 |
| Mixtral-39B-141B | Mixtral-39B-141B | Data | 1 | 60 | 60 |
| DBRX-36B-132B | DBRX-36B-132B | Data | 1 | 55 | 55 |
| Skywork-22B-146B | Skywork-22B-146B | Data | 1 | 50 | 50 |
| DeepSeekV2-21B-236B | DeepSeekV2-21B-236B | Data | 1 | 45 | 45 |
| Arctic-17B-480B | Arctic-17B-480B | Data | 1 | 40 | 40 |
| Qwen2-14B-57B | Qwen2-14B-57B | Data | 1 | 35 | 35 |
| Mixtral-13B-47B | Mixtral-13B-47B | Data | 1 | 30 | 30 |
| Jamba-12B-52B | Jamba-12B-52B | Data | 1 | 25 | 25 |
| DeepSeekMoE-3B-16B | DeepSeekMoE-3B-16B | Data | 1 | 20 | 20 |
| Qwen1.5-3B-14B | Qwen1.5-3B-14B | Data | 1 | 15 | 15 |
| OpenMoE-3B-9B | OpenMoE-3B-9B | Data | 1 | 10 | 10 |
| JetMoE-2B-9B | JetMoE-2B-9B | Data | 1 | 5 | 5 |
| OLMoE-1B-7B | OLMoE-1B-7B | Data | 1 | 0 | 0 |
| Llama2-13B | Llama2-13B | Data | 1 | 0 | 0 |
| OLMo-7B (0724) | OLMo-7B (0724) | Data | 1 | 0 | 0 |
| Llama3.1-8B | Llama3.1-8B | Data | 1 | 0 | 0 |
| Mistral-7B | Mistral-7B | Data | 1 | 0 | 0 |
| DCLM-7B | DCLM-7B | Data | 1 | 0 | 0 |
| Qwen1.5-3B-14B | Qwen1.5-3B-14B | Data | 1 | 0 | 0 |
| Gemma2-3B | Gemma2-3B | Data | 1 | 0 | 0 |
| JetMoE-2B-9B | JetMoE-2B-9B | Data | 1 | 0 | 0 |
| StableLM2-2B | StableLM2-2B | Data | 1 | 0 | 0 |
| Llama2-7B | Llama2-7B | Data | 1 | 0 | 0 |
| Falcon-7B | Falcon-7B | Data | 1 | 0 | 0 |
| MPT-7B | MPT-7B | Data | 1 | 0 | 0 |
| Pythia-7B | Pythia-7B | Data | 1 | 0 | 0 |
| Llama-7B | Llama-7B | Data | 1 | 0 | 0 |
| BLOOM-7B | BLOOM-7B | Data | 1 | 0 | 0 |
| TinyLlama-1B | TinyLlama-1B | Data | 1 | 0 | 0 |
How open are open MoEs?
</details>

Figure 1: Performance, cost, and degree of openness of open MoE and dense LMs. Model names contain rounded parameter counts: model-active-total for MoEs and model-total for dense LMs. #ckpts is the number of intermediate checkpoints available. We highlight MMLU as a  !✓ ⤫⛌  ⛌ ⛌ ⛌ 1 summary of overall performance; see §3 for more results. OLMOE-1B-7B performs best among models with similar active parameter counts and is the most open MoE.

1 Introduction 3   
2 Pretraining and Adaptation 3   
3 Results 6   
4 Experimenting with Alternative Design Choices 8

4.1 MoE-specific Pretraining Settings 8

4.1.1 Mixture-of-Experts vs. Dense 8   
4.1.2 Expert Granularity 9   
4.1.3 Shared Experts 10   
4.1.4 Expert Choice vs. Token Choice . . . . 11   
4.1.5 Sparse Upcycling . . . 11   
4.1.6 Load Balancing Loss . . . . 12   
4.1.7 Router Z-loss . . 13

4.2 General Pretraining Settings . . 14

4.2.1 Dataset Experiments . . . 14   
4.2.2 Initialization 14   
4.2.3 RMSNorm 15   
4.2.4 Decaying Embedding Parameters 16   
4.2.5 QK-Norm . . . 16  
4.2.6 AdamW Epsilon . . 17

4.3 Adaptation Settings . . 17

5 MoE Analysis 18

5.1 Router Saturation 18   
5.2 Expert Co-activation 19   
5.3 Domain Specialization 20   
5.4 Vocabulary Specialization . . . 22

6 Related Work 24

7 Conclusion 24

A Artifacts 44   
B Training Configuration 44   
C Evaluation Setup 47   
D Openness of Models 48   
E Additional Evaluation 50   
F Additional Experiments 54   
G Additional Analysis 56   
H Limitations and Future Work 62   
OLMOE-1B-7B-0125 62   
J Change log 63

# 1 Introduction

Despite significant advances in Large Language Models (LMs) on various tasks, there remains a clear trade-off between performance and cost in both training and inference. High-performing LMs are inaccessible for many academics and open-source developers as they are prohibitively expensive to build and deploy.2 One approach to improve the cost-performance trade-off lies in using sparselyactivated Mixture-of-Experts (MoEs) [154]. MoEs have several experts in each layer, only a subset of which is activated at a time (see Figure 2). This makes MoEs significantly more efficient than dense models with a similar number of total parameters, which activate all parameters for every input [205]. For this reason, industry frontier models use MoEs including Gemini-1.5 [175] and reportedly GPT-4 [29].

Most MoE models, however, are closed-source: While some have publicly released model weights [43, 79, 158, 178, 180], they offer limited to no information about their training data, code, or recipes (see Figure 1). While there have been prior efforts to make language modeling research fully accessible [18, 65, 90, 103, 193, 209], they have been largely limited to dense LMs. This comes despite MoEs requiring more openness as they add complex new design questions to LMs, such as how many total versus active parameters to use, whether to use many small or few large experts, if experts should be shared, and what routing algorithm to use. The lack of open resources and findings about these details prevents the field from building cost-efficient open MoEs that approach the capabilities of closed-source frontier models.

To address these issues, we introduce OLMOE, a fully open Mixture-of-Experts language model with state-of-the-art performance among similarly-sized models. In particular, we pretrain OLMOE-1B-7B for 5.1 trillion tokens with 6.9B total parameters, of which only 1.3B are activated for each input token. This leads to a similar inference cost as using dense models with around 1B parameters, such as OLMo 1B [65] or TinyLlama 1B [210], but requires more GPU memory to store its 7B total parameters. Our experiments show that MoEs train ∼2× faster than dense LMs with equivalent active parameters. In Figure 1, we show that OLMOE-1B-7B significantly outperforms all open 1B models and displays competitive performance to dense models with significantly higher inference costs and memory storage (e.g., similar MMLU scores to Llama2-13B, which is ∼10× more costly). Via instruction- and preference tuning, we create OLMOE-1B-7B-INSTRUCT, which we find exceeds various larger instruct models including Llama2-13B-Chat [183], OLMo-7B-Instruct (0724), and DeepSeekMoE-16B [42] on common benchmarks (MMLU, GSM8k, HumanEval, etc.).

Our comprehensive set of controlled experiments highlights key design choices for MoEs (see Table 1) and LMs in general. One critical design decision for making MoEs performant is the use of fine-grained routing with granular experts [42]: we employ 64 small experts in each layer with 8 being activated. The choice of routing algorithm is also important: we find dropless [58] token-based routing [154] outperforms expert-based routing [219]. Our findings also include those that challenge prior work, such as the ineffectiveness of shared experts [42] and the limited benefits of sparsely upcycling a pretrained dense LM into an MoE [85] unless under small compute budgets. Finally, we analyze the routing behavior in OLMOE-1B-7B, finding that routing saturates early in pretraining, experts are rarely co-activated, and experts exhibit domain and vocabulary specialization.

We hope our fully open MoE facilitates more research and analysis to improve our understanding of these models. We release training code, intermediate checkpoints (every 5000 steps), training logs, and training data under open-source licenses (Apache 2.0 http://www.apache.org/licenses/ LICENSE-2.0 or ODC-By 1.0 https://opendatacommons.org/licenses/by/1-0/).

# 2 Pretraining and Adaptation

Pretraining architecture OLMOE is a decoder-only LM consisting of $N _ { L }$ transformer [185] layers. The feedforward network (FFN) in dense models like OLMo [65], is replaced with an MoE module consisting of $N _ { E }$ smaller FFN modules called experts, of which a subset of k experts is

![](images/a02f7bda7a2c2fbfae633c38ba62c165df0b3ccdd5bf2b0d9482e900a357fa62.jpg)

<details>
<summary>flowchart</summary>

```mermaid
graph TD
    A["Input"] --> B["Multi-head Attention"]
    B --> C["Feedforward Network (FFN)"]
    C --> D["Norm"]
    D --> E["Output"]
    E --> F["+"]
    F --> G["+"]
    G --> C
    C --> H["N_L x"]
```
</details>

![](images/d69f0956c624b451ebfa807d23603415c9137118a14c8689e4f7497cf7ad2c9d.jpg)

<details>
<summary>flowchart</summary>

```mermaid
graph TD
    A["Input"] --> B["Multi-head Attention"]
    B --> C["Norm"]
    C --> D["Router"]
    D --> E["+"]
    E --> F["Output"]
    G["OEM Module"] --> H["+"]
    H --> I["Norm"]
    I --> D
    J["OEM Module"] --> K["+"]
    K --> L["Norm"]
    L --> D
    M["OEM Module"] --> N["+"]
    N --> O["Norm"]
    O --> D
    P["OEM Module"] --> Q["+"]
    Q --> R["Norm"]
    R --> D
    S["OEM Module"] --> T["+"]
    T --> U["Norm"]
    U --> D
    V["OEM Module"] --> W["+"]
    W --> X["Norm"]
    X --> D
    Y["OEM Module"] --> Z["+"]
    Z --> AA["Norm"]
    AA --> D
    AB["OEM Module"] --> AC["+"]
    AC --> AD["Norm"]
    AD --> D
    AE["OEM Module"] --> AF["+"]
    AF --> AG["Norm"]
    AG --> D
    AH["OEM Module"] --> AI["+"]
    AI --> AJ["Norm"]
    AJ --> D
    AK["OEM Module"] --> AL["+"]
    AL --> AM["Norm"]
    AM --> D
    AN["OEM Module"] --> AO["+"]
    AO --> AP["Norm"]
    AP --> D
    AQ["OEM Module"] --> AR["+"]
    AR --> AS["Norm"]
    AS --> D
    AT["OEM Module"] --> AU["+"]
    AU --> AV["Norm"]
    AV --> D
    AW["OEM Module"] --> AX["+"]
    AX --> AY["Norm"]
    AY --> D
    AX --> AZ["OEM Module"]
    style A fill:#f9f,stroke:#333
    style B fill:#f9f,stroke:#333
    style C fill:#f9f,stroke:#333
    style AD fill:#f9f,stroke:#333
    style AE fill:#f9f,stroke:#333
    style AF fill:#f9f,stroke:#333
    style AG fill:#f9f,stroke:#333
    style AH fill:#f9f,stroke:#333
    style AI fill:#f9f,stroke:#333
    style AJ fill:#f9f,stroke:#333
    style AK fill:#f9f,stroke:#333
    style AL fill:#f9f,stroke:#333
    style AM fill:#f9f,stroke:#333
    style AN fill:#f9f,stroke:#333
    style AO fill:#f9f,stroke:#333
    style AP fill:#f9f,stroke:#333
    style AQ fill:#f9f,stroke:#333
    style AR fill:#f9f,stroke:#333
    style AS fill:#f9f,stroke:#333
    style AT fill:#f9f,stroke:#333
    style AU fill:#f9f,stroke:#333
    style AV fill:#f9f,stroke:#333
    style AW fill:#f9f,stroke:#333
```
</details>

Figure 2: Comparison of the architecture of dense LMs and MoE models like OLMOE. The figure excludes some details, e.g., OLMOE-1B-7B also uses QK-Norm (§4.2.5).

<table><tr><td>Design choice</td><td>Description</td><td>Experiment</td><td>OLMoE-1B-7B</td></tr><tr><td>Active params</td><td># active parameters per input token</td><td>§4.1.1</td><td>1.3B active</td></tr><tr><td>Total params</td><td>Total # of parameters in the model</td><td>§4.1.1</td><td>6.9B total</td></tr><tr><td>Expert granularity</td><td>Using fine-grained small experts vs. a few large experts [39]</td><td>§4.1.2</td><td>64 small experts with 8 activated</td></tr><tr><td>Expert sharing</td><td>Whether or not to include a shared expert [39]</td><td>§4.1.3</td><td>No shared expert</td></tr><tr><td>Routing algorithm</td><td>How inputs are assigned to experts, e.g., assignment on a per token basis (e.g., 2 experts per token) or per expert basis (e.g., 2 tokens per expert), and whether or not all tokens get assigned or some get dropped [58, 219]</td><td>§4.1.4</td><td>Dropless [58] MoE with token choice</td></tr><tr><td>Sparse upcycling</td><td>Whether to start from a dense model [85, 211]</td><td>§4.1.5</td><td>Not used</td></tr><tr><td>Load balancing loss</td><td>Auxiliary loss to penalize unequal assignment to experts that may harm performance [154]</td><td>§4.1.6</td><td>Used with weight 0.01</td></tr><tr><td>Router z-loss</td><td>Auxiliary loss to penalize large logits in the router that may cause instabilities [221]</td><td>§4.1.7</td><td>Used with weight 0.001</td></tr></table>

Table 1: Key MoE design choices and our setup for OLMOE-1B-7B based on our experiments. Full configuration for OLMOE-1B-7B is in Appendix B.

<table><tr><td>Source</td><td>Doc Type</td><td>GPT-NeoX tokens (billions)</td><td>Words (billions)</td><td>UTF-8 bytes (GB)</td><td>Documents (millions)</td></tr><tr><td>DCLM-Baseline [90]</td><td>web pages</td><td>3,860</td><td>3,380</td><td>16,700</td><td>2,950</td></tr><tr><td>StarCoder [92, 84]</td><td>code</td><td>101</td><td>63.9</td><td>325</td><td>78.7</td></tr><tr><td>peS2o [164, 163]</td><td>STEM papers</td><td>57.2</td><td>51.3</td><td>268</td><td>38.8</td></tr><tr><td>arXiv [36]</td><td>STEM papers</td><td>21.1</td><td>23.5</td><td>88.8</td><td>1.55</td></tr><tr><td>OpenWebMath [131]</td><td>math web pages</td><td>12.7</td><td>10.2</td><td>42.4</td><td>2.91</td></tr><tr><td>Algebraic Stack [11]</td><td>math proofs code</td><td>12.6</td><td>9.6</td><td>39.3</td><td>2.83</td></tr><tr><td>English Wikipedia &amp; Wikibooks [163]</td><td>encyclopedic</td><td>3.69</td><td>3.16</td><td>16.2</td><td>6.17</td></tr><tr><td colspan="2">Total</td><td>4,060</td><td>3,530</td><td>17,400</td><td>3,080</td></tr></table>

Table 2: Composition of the pretraining data for OLMOE-1B-7B. StarCoder, $\mathrm { p e } S 2 0 ,$ and Wikipedia parts come from Dolma 1.7 [163]. Links to our data are in Appendix A.

<table><tr><td>Source</td><td>Domain</td><td>Samples</td></tr><tr><td colspan="3">Instruction Tuning</td></tr><tr><td>Tulu 2 SFT Mix [76]</td><td>Various</td><td>326,154</td></tr><tr><td>No Robots [140]</td><td>Various</td><td>9,500</td></tr><tr><td>CodeFeedback-Filtered-Instruction [214]</td><td>Coding</td><td>156,526</td></tr><tr><td>MetaMathQA [204]</td><td>Math</td><td>98,750</td></tr><tr><td>Advanced (non-chat) subset of Daring Anteater [189]</td><td>Various</td><td>17,082</td></tr><tr><td colspan="3">Preference Tuning (DPO [138])</td></tr><tr><td>UltraFeedback [38] binarized and filtered for TruthfulQA [99] contamination</td><td>Various</td><td>60,800</td></tr></table>

Table 3: Adaptation training data for OLMOE-1B-7B. Links to our data are in Appendix A.

activated for each processed input token x (also see Figure 2):

$$
\text { MoE   module } (x) = \sum_ {i \in \text { Top } - k (r (x))} \text { softmax } (r (x)) _ {i} E _ {i} (x) \tag {1}
$$

where r, called the router, is a learned linear layer mapping from the input logits to the chosen k experts. A softmax is applied to the router outputs to compute routing probabilities for all $N _ { E }$ experts. Each selected expert $E _ { i }$ processes the input x, the output of which is then multiplied with its respective routing probability. The results are then summed across all chosen Top-k experts to constitute the output of the MoE module for a single layer of the model out of its $\bar { N _ { L } }$ total layers. Key decisions in designing an MoE model include determining the number of activated and total parameters, the design of the experts (e.g., granularity, whether or not to include shared experts), and the choice of the routing algorithm. Moreover, training an MoE model can involve initializing from a dense model (sparse upcycling) and changing the training objective, such as including auxiliary load balancing and router z-losses. Experiments related to these design choices are in §4.1; Table 1 shows our final decisions.

In summary, we use 1.3B active parameters out of a total of 6.9B, with 8 activated experts out of 64 per layer. We use dropless token choice routing [58]: For each input token, the learned router network determines 8 experts to process it. We train OLMOE-1B-7B from scratch with two auxiliary losses: load balancing loss $( \mathcal { L } _ { L B } )$ [154] and router z-loss $( \mathcal { L } _ { R Z } )$ [221], which we define and experiment with in §4.1.6 and §4.1.7, respectively. We multiply them with respective loss weights, α and $\beta ,$ and sum them linearly with the cross entropy loss $( \mathcal { L } _ { C E } )$ to arrive at our final training loss:

$$
\mathcal {L} = \mathcal {L} _ {C E} + \alpha \mathcal {L} _ {L B} + \beta \mathcal {L} _ {R Z} \tag {2}
$$

Our full pretraining configuration for OLMOE-1B-7B is in Appendix B.

Pretraining data We mix data from DCLM [90] and Dolma 1.7 [163], which includes: (1) a quality-filtered subset of Common Crawl, referred to as DCLM-Baseline, (2) StarCoder, Algebraic Stack and arXiv, used in both DCLM and Dolma 1.7, and (3) peS2o and Wikipedia from Dolma 1.7. We refer to our pretraining dataset as OLMOE-MIX.

To all sources above, we apply a filter that removes all documents with a sequence of 32 or more repeated n-grams, where an n-gram is any span of 1 to 13 tokens. For the StarCoder subset, we also remove any document from a repository with fewer than 2 stars on GitHub, whose most frequent word constitutes over 30% of the document, or whose top-2 most frequent words constitute over 50% of the document.

We shuffle all samples randomly at the beginning of each epoch and train for a total of 5.133T tokens (1.3 epochs following Muennighoff et al. [121]). During our annealing phase (final 100B tokens) we first reshuffle the entire dataset and then linearly decay the learning rate to 0, following prior work [65, 90]. Our pretraining data statistics are in Table 2.

Adaptation We create OLMOE-1B-7B-INSTRUCT by following a standard adaptation recipe split into instruction tuning [118, 190, 149, 156, 206] followed by preference tuning [31, 15, 138, 54] building on prior open models [184, 76, 188]. In our instruction tuning dataset, we add more code and math data to boost performance on downstream coding and math applications. Other models, such as GPT-4 [128] and Llama 3 [50] similarly include samples from math datasets like GSM8k [35] or MATH [71] during pretraining. We also include No Robots and a subset of Daring Anteater as they are of high quality and add diversity, two key factors for successful adaptation [188, 216, 104, 120]. We describe our adaptation datasets in Table 3 and hyperparameters in Appendix B.

# 3 Results

Our evaluation procedure consists of three parts: During pretraining, After pretraining, and After adaptation. We detail the setup for each in Appendix C.

![](images/f0d6922194d45092018a209583eb923576b38eba7dee7a3f6258e8ea2e98d77e.jpg)

<details>
<summary>line</summary>

| Dataset       | OLMoE-1B-7B | OLMo-1B (0724) | OLMo-7B (0724) |
| ------------- | ----------- | -------------- | -------------- |
| HellaSwag     | ~75%        | ~65%           | ~70%           |
| MMLU          | ~50%        | ~45%           | ~50%           |
| ARC-Challenge | ~45%        | ~40%           | ~45%           |
| PIQA          | ~80%        | ~75%           | ~80%           |
| COPA          | ~85%        | ~80%           | ~85%           |
| WinoGrande    | ~70%        | ~65%           | ~70%           |
</details>

Figure 3: Evaluation of OLMOE-1B-7B and the current best OLMo models during pretraining. OLMOE-1B-7B differs from the OLMo models in its MoE architecture, several training hyperparameters, and its training dataset, see $\ S 2 . \mathrm { ~ \bf ~ A ~ }$ version of this plot with tokens as the x-axis and markers where annealing starts is in Appendix E. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/ reports/Plot-OLMoE-1B-7B-vs-OLMo-7B-vs-OLMo-1B--Vmlldzo4OTcyMjEz

During pretraining In Figure 3 we benchmark the performance of OLMOE-1B-7B during pretraining with the current best OLMo models [65] on commonly used downstream tasks. We find that across all tasks OLMOE-1B-7B reaches better performance with less compute (FLOPs) than the dense OLMo models. OLMOE-1B-7B matches or outperforms OLMo-7B at the end of training despite OLMOE-1B-7B having used less than half as many FLOPs for training and using only 1B active parameters. This is likely a result of the dataset and modeling changes we make to the OLMo setup including MoE-related changes, stability, and performance improvements, outlined in Appendix B. Appendix E contains training and validation loss plots showing very smooth loss curves without major loss spikes during the 5T tokens of our pretraining.

<table><tr><td></td><td>Active params</td><td>Open Data</td><td>MMLU</td><td>Hella-Swag</td><td>ARC-Chall.</td><td>ARC-Easy</td><td>PIQA</td><td>Wino-Grande</td></tr><tr><td colspan="9">LMs with ~7-9B active parameters</td></tr><tr><td>Llama2-7B [183]</td><td>6.7B</td><td>X</td><td>46.2</td><td>78.9</td><td>54.2</td><td>84.0</td><td>77.5</td><td>71.7</td></tr><tr><td>OLMo-7B (0724) [65]</td><td>6.9B</td><td>√</td><td>54.9</td><td>80.5</td><td>68.0</td><td>85.7</td><td>79.3</td><td>73.2</td></tr><tr><td>Mistral-7B [78]</td><td>7.3B</td><td>X</td><td>64.0</td><td>83.0</td><td>78.6</td><td>90.8</td><td>82.8</td><td>77.9</td></tr><tr><td>DCLM-7B [90]</td><td>6.9B</td><td>√</td><td>64.4</td><td>82.3</td><td>79.8</td><td>92.3</td><td>80.1</td><td>77.3</td></tr><tr><td>Llama3.1-8B [50]</td><td>8.0B</td><td>X</td><td>66.9</td><td>81.6</td><td>79.5</td><td>91.7</td><td>81.1</td><td>76.6</td></tr><tr><td>Gemma2-9B [177]</td><td>9.2B</td><td>X</td><td>70.6</td><td>87.3</td><td>89.5</td><td>95.5</td><td>86.1</td><td>78.8</td></tr><tr><td colspan="9">LMs with ~2-3B active parameters</td></tr><tr><td>OpenMoE-3B-9B [199]</td><td>2.6B</td><td>√</td><td>27.4</td><td>44.4</td><td>29.3</td><td>50.6</td><td>63.3</td><td>51.9</td></tr><tr><td>StableLM-2B [16]</td><td>1.6B</td><td>X</td><td>40.4</td><td>70.3</td><td>50.6</td><td>75.3</td><td>75.6</td><td>65.8</td></tr><tr><td>DeepSeek-3B-16B [39]</td><td>2.9B</td><td>X</td><td>45.5</td><td>80.4</td><td>53.4</td><td>82.7</td><td>80.1</td><td>73.2</td></tr><tr><td>JetMoE-2B-9B [158]</td><td>2.2B</td><td>X</td><td>49.1</td><td>81.7</td><td>61.4</td><td>81.9</td><td>80.3</td><td>70.7</td></tr><tr><td>Gemma2-3B [177]</td><td>2.6B</td><td>X</td><td>53.3</td><td>74.6</td><td>67.5</td><td>84.3</td><td>78.5</td><td>71.8</td></tr><tr><td>Qwen1.5-3B-14B [180]</td><td>2.7B</td><td>X</td><td>62.4</td><td>80.0</td><td>77.4</td><td>91.6</td><td>81.0</td><td>72.3</td></tr><tr><td colspan="9">LMs with ~1B active parameters</td></tr><tr><td>Pythia-1B [18]</td><td>1.1B</td><td>√</td><td>31.1</td><td>48.0</td><td>31.4</td><td>63.4</td><td>68.9</td><td>52.7</td></tr><tr><td>OLMo-1B (0724) [65]</td><td>1.3B</td><td>√</td><td>32.1</td><td>67.5</td><td>36.4</td><td>53.5</td><td>74.0</td><td>62.9</td></tr><tr><td>TinyLlama-1B [210]</td><td>1.1B</td><td>√</td><td>33.6</td><td>60.8</td><td>38.1</td><td>69.5</td><td>71.7</td><td>60.1</td></tr><tr><td>Llama3.2-1B [50]</td><td>1.2B</td><td>X</td><td>38.2</td><td>67.3</td><td>43.5</td><td>71.6</td><td>73.7</td><td>62.5</td></tr><tr><td>DCLM-1B [90]</td><td>1.4B</td><td>√</td><td>48.5</td><td>75.1</td><td>57.6</td><td>79.5</td><td>76.6</td><td>68.1</td></tr><tr><td>OLMoE-1B-7B</td><td>1.3B</td><td>√</td><td>54.1</td><td>80.0</td><td>62.1</td><td>84.2</td><td>79.8</td><td>70.2</td></tr></table>

Table 4: OLMOE-1B-7B after pretraining versus larger MoEs and dense LMs. We compare with dense LMs close to OLMOE-1B-7B either in active parameters (1B, approximates speed and cost) or total parameters (7B, approximates memory requirements). Model names contain rounded parameter counts: model-active-total for MoEs and model-total for dense LMs (this leads to some differences to official names, e.g., while called “Gemma2-2B” it actually has 2.6B active and total parameters [177]). Chall. = Challenge. We run all evaluations ourselves with 5 few-shots, see Appendix C for details.

After pretraining In Table 4 we benchmark OLMOE-1B-7B on common downstream tasks. We find that OLMOE-1B-7B performs best among models that use less than 2B active parameters, making it the most economical option for many use cases of LMs. For larger budgets, Qwen1.5- 3B-14B has stronger performance but has more than double the active and total parameters than OLMOE-1B-7B. We find that despite requiring ∼6–7× less compute per forward pass, OLMOE-1B-7B outperforms some dense LMs with 7B parameters such as Llama2-7B [183], but falls short of others like Llama3.1-8B [50]. Figure 1 compares MMLU performance with active parameters, a proxy for the value of a model given its cost, of OLMOE-1B-7B and other LMs. OLMOE-1B-7B is the state of the art in its cost regime.

After adaptation In Table 5, we benchmark our instruction (SFT) and preference (DPO) tuning of OLMOE-1B-7B. SFT improves our model on all tasks measured. We observe a >10× gain on GSM8k, likely due to our inclusion of additional math data to account for the relatively small amounts of math data during pretraining (§2). DPO helps on most tasks, especially AlpacaEval which aligns with findings from prior work [188, 76, 122]. Our DPO model, which we refer to as OLMOE-1B-7B-INSTRUCT, has the highest average among all models benchmarked. We find it to outperform the chat version of Qwen1.5-3B-14B despite Qwen having >2× more parameters and its pretrained model outperforming OLMOE-1B-7B in Table 4. The 84% score on AlpacaEval also outperforms much larger dense models on the leaderboard,3 such as Llama2-13B-Chat [183].

<table><tr><td>Task (→)</td><td>MMLU</td><td>GSM8k</td><td>BBH</td><td>Human-Eval</td><td>Alpaca-Eval 1.0</td><td>XSTest</td><td>IFEval</td><td>Avg</td></tr><tr><td>Setup (→)</td><td>0-shot</td><td>8-shot CoT</td><td>3-shot</td><td>0-shot</td><td>0-shot</td><td>0-shot</td><td>0-shot</td><td></td></tr><tr><td>Metric (→)</td><td>EM</td><td>EM</td><td>EM</td><td>Pass@10</td><td>%win</td><td>F1</td><td>Loose Acc</td><td></td></tr><tr><td>OLMo-1B (0724)</td><td>25.0</td><td>7.0</td><td>22.5</td><td>16.0</td><td>-</td><td>67.6</td><td>20.5</td><td>-</td></tr><tr><td>+SFT</td><td>36.0</td><td>12.5</td><td>27.2</td><td>21.2</td><td>41.5</td><td>81.9</td><td>26.1</td><td>35.9</td></tr><tr><td>+DPO</td><td>36.7</td><td>12.5</td><td>30.6</td><td>22.0</td><td>50.9</td><td>79.8</td><td>24.2</td><td>37.4</td></tr><tr><td>OLMo-7B (0724)</td><td>50.8</td><td>32.5</td><td>36.9</td><td>32.3</td><td>-</td><td>80.8</td><td>19.6</td><td>-</td></tr><tr><td>+SFT</td><td>54.2</td><td>25.0</td><td>35.7</td><td>38.5</td><td>70.9</td><td>86.1</td><td>39.7</td><td>49.3</td></tr><tr><td>+DPO</td><td>52.8</td><td>9.0</td><td>16.6</td><td>35.0</td><td>83.5</td><td>87.5</td><td>37.9</td><td>49.1</td></tr><tr><td>JetMoE-2B-9B</td><td>45.6</td><td>43.0</td><td>37.2</td><td>54.6</td><td>-</td><td>68.2</td><td>20.0</td><td>-</td></tr><tr><td>+SFT</td><td>46.1</td><td>53.5</td><td>35.6</td><td>64.8</td><td>69.3</td><td>55.6</td><td>30.5</td><td>50.4</td></tr><tr><td>DeepSeek-3B-16B</td><td>37.7</td><td>18.5</td><td>39.4</td><td>48.3</td><td>-</td><td>65.9</td><td>13.5</td><td>-</td></tr><tr><td>+Chat</td><td>48.5</td><td>46.5</td><td>40.8</td><td>70.1</td><td>74.8</td><td>85.6</td><td>32.3</td><td>57.0</td></tr><tr><td>Qwen1.5-3B-14B</td><td>60.4</td><td>13.5</td><td>27.2</td><td>60.2</td><td>-</td><td>73.4</td><td>20.9</td><td>-</td></tr><tr><td>+Chat</td><td>58.9</td><td>55.5</td><td>21.3</td><td>59.7</td><td>83.9</td><td>85.6</td><td>36.2</td><td>57.3</td></tr><tr><td>OLMoE-1B-7B</td><td>49.8</td><td>3.0</td><td>33.6</td><td>22.4</td><td>-</td><td>59.7</td><td>16.6</td><td>-</td></tr><tr><td>+SFT</td><td>51.4</td><td>40.5</td><td>38.0</td><td>51.6</td><td>69.2</td><td>84.1</td><td>43.3</td><td>54.0</td></tr><tr><td>+DPO</td><td>51.9</td><td>45.5</td><td>37.0</td><td>54.8</td><td>84.0</td><td>82.6</td><td>48.1</td><td>57.7</td></tr></table>

Table 5: OLMOE-1B-7B after adaptation versus other models. We find the JetMoE chat model (https://hf.co/jetmoe/jetmoe-8b-chat) has random scores thus we exclude it. Model names contain rounded parameter counts: model-active-total for MoEs and model-total for dense LMs. We run all evaluations ourselves (Appendix C). Models use different mixes for adaptation, e.g., OLMOE is trained on an improved version of the pipeline used for OLMo models.

# 4 Experimenting with Alternative Design Choices

In this section, we present pretraining and adaptation experiments that have led to OLMOE-1B-7B. We group them into experiments on settings specific to Mixture-of-Experts (§4.1), experiments on settings applicable to both dense LMs and MoEs (§4.2), and adaptation experiments (§4.3). In pretraining experiments, we often use MMLU Var, a version of MMLU [70] with varying few-shots and a different format that provides signal earlier during training. We describe our full evaluation setup in Appendix C and provide additional experiments in Appendix F. Each experiment links to a Weights & Biases report with more validation and downstream results, and the full configurations of the runs. To isolate the impact of changes and minimize confounders, we vary only one hyperparameter for each experiment. Nevertheless, due to the large number of hyperparameters, some results may change under different configurations and we cannot guarantee the correctness of each of our hyperparameter choices. Models are not comparable across different experiments, as we vary the base model to incorporate successful findings.

# 4.1 MoE-specific Pretraining Settings

# 4.1.1 Mixture-of-Experts vs. Dense

Prior work reports various speed-ups of MoEs over dense models: Artetxe et al. [10] report that MoEs require 2–4× less compute to match dense models, MoMa [100] exhibits 2.6× FLOP savings for language tasks, Arctic [161] yields 4× FLOP savings but for very different dense and MoE configurations, and Switch Transformers [56] train 2-7× faster with MoEs but for encoder-decoder models while the other works study decoder-only LMs [137].

![](images/6e72cf0cf2e9ce771d3464e49e9546837505ed88d1660a6b609cb661e01ae3c0.jpg)

<details>
<summary>line</summary>

| Tokens (B) | Training loss (Line 1) | Training loss (Line 2) |
| ---------- | ---------------------- | ---------------------- |
| 10         | 3.2                    | 3.2                    |
| 40         | 2.8                    | 2.7                    |
| 70         | 2.6                    | 2.5                    |
| 100        | 2.5                    | 2.4                    |
| 130        | 2.4                    | 2.3                    |
</details>

![](images/2e931553f61c9de430aeac2545aade61bffba8d8f03e932c24a640c6c99caef6.jpg)

<details>
<summary>line</summary>

| Tokens (B) | Validation loss (C4) |
| ---------- | -------------------- |
| 10         | 3.8                  |
| 40         | 3.1                  |
| 70         | 2.9                  |
| 100        | 2.8                  |
| 130        | 2.7                  |
</details>

![](images/a32124bff732cb6fa9df5afbc9bace8d55f1cb27302a2f71ae2242ae1b00fb8f.jpg)

<details>
<summary>line</summary>

| Tokens (B) | HellaSwag (pink line) | ~3x less FLOPs or tokens (blue line) |
| ---------- | --------------------- | ------------------------------------ |
| 10         | ~30                   | ~30                                  |
| 40         | ~60                   | ~50                                  |
| 70         | ~65                   | ~55                                  |
| 100        | ~68                   | ~57                                  |
| 130        | ~70                   | ~58                                  |
</details>

![](images/519bed482a2a0c2d03c93fc18829fa40051212ecf675f121e6c35e230a4d25f5.jpg)

<details>
<summary>line</summary>

| Training time (h) | Tokens (B) |
| ----------------- | ---------- |
| 1                 | 3.2        |
| 2                 | 2.8        |
| 3                 | 2.6        |
| 4                 | 2.5        |
| 5                 | 2.45       |
| 6                 | 2.4        |
| 7                 | 2.35       |
</details>

![](images/371d57632ee2d753c920abd00b44c21a4996cec586bf463cc2979b532907895e.jpg)

<details>
<summary>line</summary>

| Training time (h) | Tokens (B) - Line 1 | Tokens (B) - Line 2 |
| ----------------- | --------------------- | --------------------- |
| 1                 | 3.8                   | 3.7                   |
| 2                 | 3.2                   | 3.1                   |
| 3                 | 3.0                   | 2.9                   |
| 4                 | 2.9                   | 2.8                   |
| 5                 | 2.85                  | 2.75                  |
| 6                 | 2.8                   | 2.7                   |
| 7                 | 2.75                  | 2.65                  |
</details>

![](images/7148cd409ad2380a5de3dfad504dc30e0d949eab1f9f586c1996eb2da6bd00ac.jpg)

<details>
<summary>line</summary>

| Training time (h) | MoE  | Dense |
| ----------------- | ---- | ----- |
| 0                 | 25   | 25    |
| 1                 | 35   | 35    |
| 2                 | 45   | 45    |
| 3                 | 50   | 50    |
| 4                 | 55   | 55    |
| 5                 | 58   | 57    |
| 6                 | 60   | 58    |
| 7                 | 62   | 59    |
</details>

Figure 4: MoE vs. Dense. We train a 1.3B parameter dense model and a 1.3B active, 6.9B total parameter MoE model, each on 128 H100 GPUs. Apart from MoE-related changes, we train both with the same configuration for 130B tokens. The MoE contains 64 experts out of which 8 are activated with an FFN dimension of 1,024, while the dense model has an FFN dimension of 8,192. Thus both have the same number of active parameters. Top: The MoE reaches the final dense performance with ∼3× fewer tokens (or FLOPs, as both have the same active parameters ignoring the trivial router parameters). Bottom: Due to some memory overhead, this equates to ∼2× faster training. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/ Plot-MoE-vs-Dense--Vmlldzo4OTM0Mjkx

In Figure 4, we compare MoEs and dense models in a controlled setup. We find that our MoE reaches the performance of the dense model with ∼3× fewer tokens equivalent to ∼3× less compute measured in FLOPs. However, due to the additional memory overhead of training the MoE with its 7B total parameters, it processes fewer tokens per second than the dense model (23,600 tokens per second per GPU for the MoE vs. 37,500 for dense). Thus, in terms of training time, it reaches the performance of the dense model only ∼2× faster. There are likely optimizations possible that would bring the speed-up closer to the 3× token speed-up, which we leave to future work. Based on these results, we select an MoE configuration with 6.9B total and 1.3B active parameters matching OLMo-7B in total and OLMo-1B in active parameter count, respectively.

# 4.1.2 Expert Granularity

Dai et al. [39] propose to use small fine-grained experts to allow more combinations of experts and thus make the model more flexible. For example, the Mixtral model [79] uses the common configuration of 8 experts per layer, 2 of which are activated. This allows for ${ \binom { 8 } { 2 } } = 2 8$ combinations per layer. By halving the size of each expert and therefore doubling the number of experts to maintain the same compute and parameter budget, we can increase the possible combinations to $\binom { 1 6 } { 4 } = 1 , 8 2 0$ . Krajewski et al. [86] investigate compute-optimal granularity configurations finding that higher compute budgets warrant more granular experts.

In Figure 5, we observe that more granular experts improve training loss, validation loss, and downstream performance. The 8-expert configuration uses 1 active expert, which yields ${ \binom { 8 } { 1 } } = 8$ combinations. By quartering the size of each expert but increasing the number to 32 with 4 active $( { \binom { 3 2 } { 4 } } = 3 5 , 9 6 0$

![](images/0b07d16a5a8343d965d69e63efd08fe8d0ab612de64bad9b64db0ebe3a12116e.jpg)

<details>
<summary>line</summary>

| Epoch | Performance |
|-------|-------------|
| 10    | 3.0         |
| 40    | 2.6         |
| 70    | 2.5         |
| 100   | 2.45        |
| 130   | 2.4         |
</details>

![](images/a8cab879c922aef3f79f5c998b993ee1d8b0c6acd5fecdb2aae8db3426017f10.jpg)

<details>
<summary>line</summary>

| Epoch | Validation Loss (C4) |
|-------|----------------------|
| 10    | 3.5                  |
| 40    | 3.0                  |
| 70    | 2.85                 |
| 100   | 2.8                  |
| 130   | 2.75                 |
</details>

![](images/9a68e31308f49a4bd442b7418e2259f23e7379d0e3484a1383eb493fabeb1ae4.jpg)

<details>
<summary>line</summary>

| # experts | Line 1 | Line 2 | Line 3 |
| --------- | ------ | ------ | ------ |
| 64        | 64     | 32     | 8      |
</details>

![](images/d0540b7bdd4fac6afc68741027c5bb52d19c4adab306a2196f680c48b77d016d.jpg)

<details>
<summary>line</summary>

| x  | Line 1 | Line 2 | Line 3 |
|----|--------|--------|--------|
| 10 | 28.0   | 28.5   | 27.5   |
| 40 | 33.0   | 32.5   | 31.0   |
| 70 | 35.0   | 34.5   | 33.0   |
| 100| 36.0   | 35.5   | 34.0   |
| 130| 37.0   | 36.5   | 35.0   |
</details>

Tokens (B)   
Figure 5: Expert granularity. We vary the number of experts in tandem with the FFN dimension to ensure that active and total parameters and thus compute cost remain the same. For example, for 64 experts, the FFN dimension is 1,024 and 8 experts are activated, while for 32 experts it is 2,048 with 4 activated experts. More results, logs, and configurations: https://wandb.ai/ai2-llm/ olmoe/reports/Plot-Granularity--Vmlldzo4OTIxOTE4

and MMLU at around 130 billion tokens. However, we find that there are diminishing returns to granularity. The additional increase to 64 experts with 8 active ones $( { \binom { 6 4 } { 8 } } = 4 , 4 2 6 , 1 6 { \bar { 5 } } , 3 6 8$ combinations) improves downstream metrics by a smaller amount of 1–2%. For our OLMOE-1B-7B compute budget4 of $\mathrm { 3 \times 1 0 ^ { 2 2 } }$ , Krajewski et al. [86] predict an optimal number of experts of 256 (G = 32 in their paper). However, their predictions are for compute-optimal models [72, 32], while we train for 5T tokens, which is orders of magnitude beyond what would be conventionally considered optimal for our model size. Thus, their predictions may not extend to our setup, and we stick with 64 experts for OLMOE-1B-7B also due to the diminishing returns in Figure 5.

# 4.1.3 Shared Experts

![](images/5fbe7318f617dfe1c48c0d1e60b31eb564e62cb06684552b741e9eae3822ab1d.jpg)

<details>
<summary>line</summary>

| Step | Performance |
| ---- | ----------- |
| 10   | 3.0         |
| 40   | 2.6         |
| 70   | 2.45        |
| 100  | 2.4         |
| 130  | 2.35        |
</details>

![](images/e237954ef1f21f313a38ccd0f4d4ecbfd594f7dffa411fb3f11226ccee42f6f8.jpg)

<details>
<summary>line</summary>

| x   | Validation loss (C4) |
| --- | -------------------- |
| 10  | 3.50                 |
| 40  | 3.00                 |
| 70  | 2.80                 |
| 100 | 2.75                 |
| 130 | 2.70                 |
</details>

![](images/995decc4e77160c6a7eb2a9f811873ebc4c949ae301e6e0ba667a793aaf1b284.jpg)

<details>
<summary>line</summary>

| x  | # experts | 32 routed | 31 routed, 1 shared |
|----|-----------|-----------|----------------------|
| 10 | 30        | 30        | 30                   |
| 40 | 55        | 55        | 55                   |
| 70 | 60        | 60        | 60                   |
| 100| 65        | 65        | 65                   |
| 130| 68        | 68        | 68                   |
</details>

![](images/d24760699fec9235119848841d5de04a32517c6b1f9c539b495e5eec880e3312.jpg)

<details>
<summary>line</summary>

| x  | y    |
|----|------|
| 10 | 28.0 |
| 40 | 32.0 |
| 70 | 34.0 |
| 100| 35.5 |
| 130| 36.0 |
</details>

Tokens (B)   
Figure 6: Shared experts. Both setups have the same number of active and total parameters and use the same number of FLOPs. 4 of the 32 routed experts are activated, while it is 3 for the 31 routed experts of the other model, as it has 1 always-active shared expert. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/ Plot-Expert-sharing--Vmlldzo4OTIyMjQz

Dai et al. [39] propose training with a shared/fixed expert that is always used in addition to the routed experts. The intuition is to encourage the shared expert to learn common information and allow the other routed experts to learn more specialized knowledge. This should reduce redundancy among experts and thus lead to a better model as it can store more total information.

In Figure 6, we benchmark having a single shared and a single routed expert versus two routed experts. While both settings lead to similar performance, sharing an expert performs slightly worse. Sharing an expert removes flexibility from the model and thus goes against the findings in §4.1.2 suggesting that allowing for more expert combinations improves performance. Specifically, the two models in Figure 6 have ${ \binom { 3 2 } { 4 } } = 3 5 , 9 \bar { 6 } 0$ and (31) ${ \binom { 3 1 } { 3 } } = 4$ , 495 possible combinations per layer. Thus, removing one of the routed experts and turning it into a shared one eliminates almost 90% of possible combinations. This likely acts as a counterforce to the potential benefits of isolating common knowledge in a shared expert. Based on these results, we do not use shared experts in OLMOE-1B-7B but we do think that there is merit to the idea of experts that are activated more often or even always. However, rather than enforcing this behavior via a shared expert, we believe that it should be learned by the model. This is difficult with current setups due to the necessity of a load balancing loss (§4.1.6) penalizing the model if tokens are not distributed equally among experts. Potential future work can explore removing the load balancing loss to allow for more flexible usage of experts.

# 4.1.4 Expert Choice vs. Token Choice

![](images/a634fc3bf33ae4abee84b7f0d13578e9f399c1acf43e1f3e7aa8e5ae8fd59b9d.jpg)

<details>
<summary>line</summary>

| Step | Performance (Line 1) | Performance (Line 2) |
| ---- | --------------------- | --------------------- |
| 10   | 3.5                   | 3.5                   |
| 50   | 2.8                   | 2.7                   |
| 100  | 2.6                   | 2.5                   |
| 150  | 2.5                   | 2.4                   |
| 200  | 2.4                   | 2.3                   |
</details>

![](images/cc16d858c7491f12d9b0297e9f7acc07ead42255feaea7aa6a79151cf66645ee.jpg)

<details>
<summary>line</summary>

| Step | Validation loss (C4) |
| ---- | -------------------- |
| 10   | 3.5                  |
| 50   | 3.2                  |
| 100  | 3.0                  |
| 150  | 2.9                  |
| 200  | 2.8                  |
</details>

![](images/522837fec53aece18e92a036b362ec6274f0eb63a4afad11c34fb3e6b8aedc5d.jpg)

<details>
<summary>line</summary>

| Step | TC  | EC  |
| ---- | --- | --- |
| 10   | 25  | 25  |
| 50   | 45  | 40  |
| 100  | 55  | 50  |
| 150  | 58  | 53  |
| 200  | 60  | 55  |
</details>

![](images/99f65aa785385e06c79c5791d4a0d919259094154775ec27ef20ae11aba94667.jpg)

<details>
<summary>line</summary>

| x  | y    |
|----|------|
| 10 | 25.0 |
| 50 | 27.5 |
| 100| 29.0 |
| 150| 30.5 |
| 200| 31.0 |
</details>

Tokens (B)   
Figure 7: Expert choice (EC) vs. token choice (TC). Both models have an 8-expert MoE in every 2nd layer. For TC, 2 experts are activated per token, while for EC the capacity factor is 2. Thus, both models use the same number of active parameters. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/Plot-EC-vs-TC--Vmlldzo4MzkzMDM3

The MoE router determines which experts process each input token (§2). There are two common types [102]: expert choice (EC) [219] and token choice (TC) [154]. For EC, each expert selects a fixed number of tokens from the incoming sequence. By design, this leads to each expert processing the same number of tokens. This is the main benefit of EC as it ensures perfect load balance, which improves training throughput and removes the need for a load balancing loss. The main downside of EC is that it is not easily usable for autoregressive generation where a single token is processed at each step rather than the entire sequence in one [143]. Another potential downside is that EC can lead to token dropping, where some tokens are not selected by any expert, which can hurt performance [58]. At the same time, it can lead to some tokens being processed by multiple experts, which could also be beneficial as it allows the model to allocate more compute to some tokens [219]. For TC, each token selects a fixed number of experts. This can lead to many tokens choosing the same expert, hurting training efficiency. Therefore it is common to use TC with a load balancing loss [154] to encourage equal distribution.

In Figure 7, we benchmark EC and TC. We find that TC outperforms EC for the same token budget for all tasks depicted as well as other tasks like PIQA, SciQ, etc. which we report at https: //wandb.ai/ai2-llm/olmoe/reports/Plot-EC-vs-TC--Vmlldzo4MzkzMDM3. While Zhou et al. [219] find EC to be better, our configuration slightly differs in that we use dropless MoEs [58] with a load balancing loss. Thus, our TC variant is expected to perform better than the TC variant in Zhou et al. [219]. We confirm findings that EC runs around 20% faster at 29,400 tokens per second per device versus 24,400 for TC [219]. EC may be more beneficial in a multimodal setup [100] as dropping noisy image tokens is likely less harmful than text tokens. Thus, while we stick with TC for this release of OLMOE , we may revisit EC for future multimodal models.

# 4.1.5 Sparse Upcycling

Komatsuzaki et al. [85] propose turning a dense model into a Mixture-of-Experts model via sparse upcycling: (1) The dense MLP is cloned for each desired expert to constitute MoE layers. (2) A newly initialized router is added in front of each MoE layer. (3) Pretraining continues with the new model so that the cloned MLPs can gradually specialize in different things and the router can be learned. They find that the upcycling approach maintains a performance advantage over a language model trained from scratch for up to 120% of the compute budget of the original dense checkpoint that the sparse model was upcycled from. For example, if sparsely upcycling a 1.3B parameter model at 2 trillion tokens then only at 2.4 trillion tokens should an MoE trained from scratch catch up with the upcycled model. That is, the sparsely upcycled model would have been trained for another 400 billion tokens, thereby saving the equivalent of up to 2T tokens of compute. Other works such as MiniCPM [74], Qwen2 [201] and reportedly Mixtral [25, 79] have adopted sparse upcycling but only share limited information about their configuration.

![](images/d57e7ecb5764c7a5354740ce28a8b494cdfdcdaa21c3dfee445bc89a0f4a4fff.jpg)

<details>
<summary>line</summary>

| Step | Performance |
| ---- | ----------- |
| 0    | 10.0        |
| 50   | 2.5         |
| 100  | 5.0         |
| 150  | 7.5         |
| 200  | 10.0        |
| 250  | 10.0        |
| 300  | 7.5         |
| 350  | 5.0         |
| 400  | 7.5         |
| 450  | 8.0         |
| 500  | 7.5         |
| 550  | 5.0         |
| 600  | 7.5         |
| 650  | 10.0        |
</details>

![](images/e891dde28b1bba5ad86414e459cfdf6ad397fba82cce04c8fbbd6d4dced3527c.jpg)

<details>
<summary>line</summary>

| Step | Validation Loss |
| ---- | --------------- |
| 50   | 4.0             |
| 250  | 2.5             |
| 450  | 2.5             |
| 650  | 2.5             |
</details>

![](images/d3292f369c2bc2d3ff79483c3d147f8b751a96b428404b8c12932af344f0388f.jpg)

<details>
<summary>line</summary>

| Step | Scratch | Upcycle |
| ---- | ------- | ------- |
| 50   | 30      | 60      |
| 250  | 60      | 60      |
| 450  | 60      | 60      |
| 650  | 60      | 60      |
</details>

![](images/50912f54fed0ad29533331b12328c717e257ad5c577f1c7fa968f142b8f99878.jpg)

<details>
<summary>line</summary>

| x    | Line 1 | Line 2 |
| ---- | ------ | ------ |
| 50   | 25.0   | 30.0   |
| 250  | 30.0   | 32.0   |
| 450  | 32.0   | 33.0   |
| 650  | 33.0   | 34.0   |
</details>

Tokens (B)   
Figure 8: Sparse upcycling. We upcycle OLMo-1B (0724) at 2T tokens into an MoE with 8 total experts of which 2 are activated and train it for an additional 610 billion tokens. We compare it to a model trained from scratch for 610 billion tokens. Except for this difference, both models use the same config, which includes some suboptimal settings that contribute to the instability, such as no QK-Norm (§4.2.5) and no truncated normal init (§4.2.2). More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/ Plot-Scratch-vs-Upcycle--Vmlldzo4NDIyOTc4

In Figure 8, we compare sparse upcycling OLMo-1B (0724) [65] with training an MoE from scratch. We find that after 500B tokens, an otherwise equivalent MoE trained from scratch already catches up with the upcycled model, both on the metrics in Figure 8 and our additional metrics at https:// wandb.ai/ai2-llm/olmoe/reports/Plot-Scratch-vs-Upcycle--Vmlldzo4NDIyOTc4. At around 600B tokens, the MoE from scratch starts outperforming the upcycled MoE. Thus, it only requires 25% of the compute budget of the original dense model to catch up as opposed to the 120% reported in Komatsuzaki et al. [85]. However, they use expert choice routing and study encoderdecoder models [139]. Meanwhile, we use token choice routing (§4.1.4) and decoder-only models (§2). Further, we upcycle a model that has already been significantly overtrained [57], i.e., a 1B model trained for 2T tokens. Its parameters are likely already in a very optimal range for a dense model, which may limit the amount of additional exploration possible after upcycling. This motivates us to experiment with adding noise to the upcycled weights outlined in Appendix F, but we do not find it to lead to better performance. A large disadvantage of upcycling is that the upcycled MoE is constrained by some hyperparameters of the dense model. Specifically, OLMo-1B (0724) was trained without QK-Norm and normal initialization, both of which hurt stability in our experiments (§4.2.5, §4.2.2). While it may be possible to simply add new QK-Norms and train them from scratch similar to the new router layer trained from scratch, it is impossible to change the initialization of the original dense model when upcycling it. Thus, as we want to change these hyperparameters and also train OLMOE-1B-7B for around 250% of the compute budget of the dense model (5T vs. 2T tokens), we do not use upcycling.

# 4.1.6 Load Balancing Loss

Shazeer et al. [154] propose the load balancing loss to penalize the model if it is unbalanced, i.e., if it routes all tokens to only a few experts. This is based on the observation that without such penalty, models tend to update only a select few experts in each layer [52, 17]. To compute the load balancing loss $( \mathcal { L } _ { L B } )$ we multiply the fraction of tokens $f _ { i }$ routed to one expert $E _ { i }$ with the total routing probability $P _ { i }$ allocated to $E _ { i }$ for one batch and sum it across the number of experts $N _ { E } { \mathrm { i } }$

$$
\mathcal {L} _ {L B} = N _ {E} \cdot \sum_ {i = 1} ^ {N _ {E}} f _ {i} \cdot P _ {i} \tag {3}
$$

The loss is further scaled by $N _ { E }$ and a loss weight α (see Equation 2), which is an optional weight to determine the magnitude of the loss commonly set to 0.01 [221, 199]. We do not experiment with changing the weight of 0.01.

![](images/d2e1673abdc6399eeee6d5a9aa5df475ffa6d0b26dbc70568c20c595017d3291.jpg)

Figure 9: Impact of applying a load balancing loss (LBL). The training loss plot excludes the load balancing loss for both models. More results, logs, and configurations: https://wandb.ai/ ai2-llm/olmoe/reports/Plot-LBL-vs-No-LBL--Vmlldzo4OTkyNDg4   
![](images/a08b7328621d887ffb9b262dd8d9d5c88115d9c9df61a1857b4d40773af6e755.jpg)

<details>
<summary>line</summary>

| Tokens (B) | % of tokens in batch assigned to expert (Line 1) | % of tokens in batch assigned to expert (Line 2) | % of tokens in batch assigned to expert (Line 3) |
| ---------- | ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| 0          | 100                                             | 0                                               | 0                                               |
| 1          | 100                                             | 50                                              | 0                                               |
| 5          | 75                                              | 75                                              | 0                                               |
| 10         | 75                                              | 75                                              | 0                                               |
</details>

![](images/35d638335af70e98c2974000aa951eb6a6c79b54a6c05ee606b348c7a4f1bec0.jpg)

<details>
<summary>line</summary>

| Tokens (B) | Expert 0 | Expert 1 | Expert 2 | Expert 3 | Expert 4 | Expert 5 | Expert 6 | Expert 7 |
| ---------- | -------- | -------- | -------- | -------- | -------- | -------- | -------- | -------- |
| 1          | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      |
| 5          | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      |
| 10         | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      | 0.0      |
</details>

Figure 10: Expert assignment during training when using or not using a load balancing loss for the first MoE layer. More results, logs, and configurations: https://wandb.ai/ai2-llm/ olmoe/reports/Plot-LBL-vs-No-LBL--Vmlldzo4OTkyNDg4

In Figure 9 we investigate the performance impact of using the auxiliary load balancing loss. We find that across training loss and validation losses, using the load balancing loss leads to better performance even after only a few billion tokens. We still measure the load balancing loss even when it is not used (“No LBL”) and find that while it spikes initially, it slowly decreases over the next few billion tokens. This behavior is also visible in Figure 10 (left), where initially all tokens in the first layer are assigned to the 6th expert (pink). Eventually, the model also starts assigning some tokens to the 1st expert (yellow). However, all other experts remain largely flat and are thus “dead weights” that take up GPU memory but are not used. Given these results, we use the auxiliary load balancing loss with a weight of 0.01 following prior work [154, 158]. However, getting rid of the load balancing loss is an important direction for future research as it constrains the flexibility of the model by forcing it to use all experts approximately equally. This could prevent the experts from specializing in certain data domains and may be a reason prior work has failed to find strong evidence of expert specialization [79, 221].

# 4.1.7 Router Z-loss

Zoph et al. [221] propose the router z-loss to improve both the stability and quality of MoE models. This auxiliary loss penalizes large logits coming into the gating network. Such large logits can lead to numeric overflows in the large matrix multiplications happening in the MoE layer. It is computed by exponentiating the logits $x _ { j }$ right before the router layer summed across the number of experts $N _ { E }$ and averaged across the batch B, thereby making larger logits lead to a larger loss:

$$
\mathcal {L} _ {R Z} (x) = \frac {1}{B} \cdot \sum_ {i = 1} ^ {B} \left(\log \sum_ {j = 1} ^ {N _ {E}} \exp \left(x _ {j} ^ {(i)}\right)\right) ^ {2} \tag {4}
$$

The loss is further multiplied with an optional loss weight, β (see Equation 2), to determine the magnitude of the loss commonly set to 0.001 [221, 158]. We do not experiment with changing the weight of 0.001.

![](images/9a9cfb352716c3c92d9b8e4320aca237e76ab0b930b5bb87142997f5552069bb.jpg)  
Figure 11: Router z-loss. We compare adding router z-loss with a loss weight of 0.001 versus no additional z-loss. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/ reports/Plot-Zloss-vs-none--Vmlldzo4NDM4NjUz

In Figure 11, we confirm that across training loss, validation loss, and downstream performance adding the router z-loss improves stability (less spikes) and quality (lower loss and higher downstream performance). Thus, despite it reducing throughput by ∼2% we use the router z-loss for OLMOE-1B-7B with a weight of 0.001 as in Zoph et al. [221].

# 4.2 General Pretraining Settings

# 4.2.1 Dataset Experiments

![](images/281519709c270823853b520419daa14d30fb246822cf85e5f08c1217416546ac.jpg)  
Figure 12: OLM E-M vs. Dolma 1.7. We compare our data mix described in §2 with Dolma 1.7 used to train prior OLMo models. Lower training loss does not mean that one dataset is better, but rather suggests which dataset is easier for the model to learn. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/ Plot-Dolma-1-7-vs-Dolma-OLMoE--Vmlldzo4OTIxNTg5

Li et al. [90] release the DCLM-Baseline dataset and establish that it leads to better language models than Dolma 1.7 and other datasets as measured on common benchmarks like MMLU [70]. This motivates us to mix their DCLM dataset with some components from Dolma 1.7 that we deem to be high-quality; see §2. In Figure 12, we compare our mix, OLMOE-MIX, with Dolma 1.7 in a controlled setup. We find that OLMOE-MIX leads to clear gains on all three downstream metrics, especially MMLU. DCLM-Baseline has been created through a series of dataset ablations targeting MMLU and other downstream metrics, which explains these results. We also compare adding Reddit and FLAN to our mix as detailed in Appendix F, but do not find consistent performance gains. We do not have a strong intuition for why adding these datasets does not help and a more automatic approach to dataset mixing may be desirable for future iterations [101, 4].

We pretrain using our mix of DCLM-Baseline and Dolma 1.7 dubbed OLMOE-MIX.

# 4.2.2 Initialization

Few prior works on Mixture-of-Experts share their initialization strategy. Even the most open MoEs prior to this work, JetMoE [158] and OpenMoE [199], do not mention their initialization scheme. For DeepSeekMoE [39] and DeepSeekV2 [43], the authors share that they use a normal initialization with a standard deviation (std) of 0.006. For dense language models, a normal initialization with an std of 0.02 has been commonly used as popularized by Shoeybi et al. [159].

![](images/27c0c2ade4a882a3525c1576eb1dbdb6a80197f77f7ead6b3c2409143be5a487.jpg)

Figure 13: Initialization. We compare a normal initialization with a standard deviation (std) of 0.02 with a truncated normal initialization with a maximum (minimum) cut-off of 0.06 (–0.06) corresponding to three stds (3×0.02). More results, logs, and configurations: https://wandb.ai/ ai2-llm/olmoe/reports/Plot-Init--Vmlldzo4NDIzMzM5   
![](images/c614f0603d50fb53f2812c213ea49297d95a6e2d866edb190543e52951cab296.jpg)  
Figure 14: Non-parametric layer normalization vs. RMSNorm. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/Plot-LN--Vmlldzo4NDQyMTAz

In Figure 13, we find a truncated normal initialization leads to more stable training and better performance than a regular normal initialization. The difference between the two initializations only becomes clear at around 450 billion tokens, where the model with the normal initialization starts to diverge. This is despite both models using the same configuration except for the difference in weight initialization. Having to train for hundreds of billions of tokens until an experiment provides a clear signal is one of the key challenges of pretraining ablations.

We use the truncated normal initialization for OLMOE-1B-7B.

# 4.2.3 RMSNorm

OLMo [65] uses non-parametric layer normalization [12], mainly as it is significantly faster than the commonly used RM-SNorm [208, 113]. This is an unusual choice as most LMs use RMSNorm, such as the Llama [182, 183, 50], Gemma [176, 177], and Qwen [13, 201] model families.

In Figure 14, we observe that replacing the non-parametric layer normalization in OLMo with a parametric RMSNorm leads to better performance. This is likely because the non-parametric layer normalization leads to a large number of spikes in the gradients as seen in Figure 16. We clip gradients at 1.0, which prevents these spikes from leading to very large and potentially disruptive parameter updates. However, the clipped gradients may still harm the performance of the model as they are no longer the true gradients. Thus, despite RMSNorm lowering our training throughput by 15%, we train our final model with RMSNorm. We include the RMSNorm parameters in weight decay as we find that it performs slightly better (Figure 15) even though it is common practice to exclude them.5

![](images/1391213f0f83c54bc70b606b5b943e2700ed2ce75d160ed20f9a675bb7601ce8.jpg)

<details>
<summary>line</summary>

| Tokens (B) | RMS  | Non-parametric |
| ---------- | ---- | -------------- |
| 0          | 0.0  | 3.0            |
| 10         | 0.0  | 1.0            |
| 20         | 0.0  | 0.5            |
| 30         | 0.0  | 0.3            |
| 40         | 0.0  | 0.2            |
| 50         | 0.0  | 0.1            |
| 60         | 0.0  | 0.0            |
| 70         | 0.0  | 0.0            |
| 80         | 0.0  | 0.0            |
| 90         | 0.0  | 0.0            |
| 100        | 0.0  | 0.0            |
</details>

Figure 16: Total norm of the gradients when training with RMS or non-parametric normalization. We increase the logging interval of the RMS run at 75B tokens, hence its change in thickness.

![](images/4c9357f3eec7a4ee2313d655f2b5200d531fe971b67fb54a0b70e623a9c95aef.jpg)

Figure 15: Decaying the RMSNorm parameters. More results, logs, and configurations: https: //wandb.ai/ai2-llm/olmoe/reports/Plot-Decay-LN--Vmlldzo4NDQ1NDYy   
![](images/5f657d22e82b715bc2fdd17f4ec06837a58bb8cdb24a1188a06e1bd307f0dc81.jpg)

<details>
<summary>line</summary>

| Metrics          | 5B   | 60B   |
| ---------------- | ---- | ----- |
| Training loss    | 3.0  | 2.8   |
| Validation loss (C4) | 3.4  | 2.8   |
| HellaSwag        | 3.4  | 29    |
| MMLU Var         | 29   | 30    |
</details>

Figure 17: Decaying the embedding parameters. More results, logs, and configurations: https: //api.wandb.ai/links/ai2-llm/3h22onp5

# 4.2.4 Decaying Embedding Parameters

Similar to the RMSNorm parameters (§4.2.3), embedding parameters are commonly excluded from weight decay.6 In Figure 17 we find that whether or not they are decayed has only a minor impact on performance, with decaying being slightly better. Thus for simplicity, we weight decay all parameters in OLMOE-1B-7B including embedding and RMSNorm.

# 4.2.5 QK-Norm

Some works have reported stability improvements from adding layer normalization after the query and key projections (“QK-Norm”) [173, 113, 44]. QK-Norm can prevent the subsequent attention operation from leading to very large logits that may lead to numeric overflows and destabilize the network, especially when training in low precision. Like layer normalization at other places in the model, the QK-Norm could be non-parametric or use the parametric RMSNorm (§4.2.3).

In Figure 18, we compare using QK-Norm with no normalization after the query and key projections. We find that QK-Norm leads to some stability and performance improvements. We perform this experiment with non-parametric layer normalization as used in OLMo [65], while we used parametric RMS layer normalization [208] for OLMOE-1B-7B (§4.2.3). To ensure the benefit of QK-Norm is not an artifact of comparing with non-parametric layer normalization, we run another experiment with RMS layer normalization and still find QK-Norm to lead to slightly better training loss and to prevent a large grad norm spike.7 Thus, we use QK-Norm for OLMOE-1B-7B despite it reducing throughput by almost 10%.

![](images/9db59c732ebbb35e48e68f5e660954a45d027a1e983ea8f72671fca9c165f48b.jpg)  
Figure 18: Query-Key layer normalization (QK-Norm). Both models use non-parametric layer normalization. QK-Norm corresponds to additional layer normalization of the query and key projections. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/ Plot-QKNorm-vs-none--Vmlldzo4NDIzMzE2

# 4.2.6 AdamW Epsilon

![](images/d4145e051b37f20d107c72650b7186670ba0a89873ca4e40a26a17ca14534d8e.jpg)  
Figure 19: AdamW epsilon. More results, logs, and configurations: https://wandb.ai/ ai2-llm/olmoe/reports/Plot-AdamW-eps--Vmlldzo4NDc5MDg0

Groeneveld et al. [65] use an epsilon (“eps”) value of 1E-05 in the AdamW optimizer for training OLMo. A larger eps value leads to smaller steps of the optimizer but can be more stable [83].

In Figure 19, we find that decreasing eps to the recommended default of 1E-08 [83] significantly improves performance while the run remains stable. Thus, we set eps to 1E-08 for our final run.

# 4.3 Adaptation Settings

We experiment with small design choices for adaptation using our evaluation setup described in Appendix C. (1) Auxiliary losses: Zoph et al. [221] find that using the auxiliary load balancing loss (§4.1.6) during regular finetuning leads to small performance gains. For instruction tuning, however, Shen et al. [156] do not find conclusive evidence in favor of using the load balancing or router z-loss with only small differences in performance, both in support of and against the auxiliary losses. In Table 7 we display experiments with the load balancing loss during adaptation and find that not using it leads to better performance (54.0 vs. 52.8 after instruction tuning (SFT) and 57.7 vs.

<table><tr><td rowspan="2">Data (↓)</td><td colspan="2">OLMoE-1B-7B</td></tr><tr><td>After pretraining</td><td>After SFT</td></tr><tr><td>SFT data</td><td>12.22</td><td>12.16</td></tr><tr><td>Github</td><td>13.85</td><td>14.85</td></tr><tr><td>Wikipedia</td><td>14.48</td><td>14.24</td></tr><tr><td>C4</td><td>9.09</td><td>9.13</td></tr></table>

Table 6: Load balancing loss (Equation 3) over a subset of the respective corpora prior to scaling with the load balancing loss weight α. While we use load balancing loss during pretraining, we do not use it during SFT.

57.1 after preference tuning (DPO)). One potential problem of deactivating the load balancing loss is that it may harm balance among experts and turn some into dead weights as observed during pretraining in §4.1.6. However, when measuring the load balancing loss in Table 6 on our SFT data (§2), we find that the loss actually decreases slightly during SFT (12.16 vs. 12.22). This is likely because which experts certain tokens get routed to is determined early during pretraining, as we find later in the analysis section (§5.1). We also visualize the activation patterns of experts of the model after pretraining, and the models after SFT and DPO trained without load balancing in Appendix G (Figure 33) finding that the distribution remains around the same. Thus, as our models adapted without load balancing perform better and we find it not to impact routing substantially, we do not use load balancing during adaptation . (2) Annealing checkpoint: We also experiment with using the checkpoint pre-annealing (§2) for adaptation and find the checkpoint post-annealing leads to better performance (53.8 vs. 54.0 after SFT and 56.3 vs 57.7 after DPO), thus we use the post-annealing checkpoint. (3) Preference algorithm: Since the release of DPO (Direct Preference Optimization) [138], a variety of preference algorithms have been proposed [54, 73, 114]. We experiment with KTO [54] and find that it matches DPO in Table 7 for our setup (Appendix B). While we release both models, we use DPO for our final OLMOE-1B-7B-INSTRUCT model, as it scores higher on AlpacaEval, which has a smaller chance of data contamination than our other benchmarks [198].

<table><tr><td>Task (→)</td><td>MMLU</td><td>GSM8k</td><td>BBH</td><td>Human-Eval</td><td>Alpaca-Eval 1.0</td><td>XSTest</td><td>IFEval</td><td>Avg</td></tr><tr><td>Setup (→)</td><td>0-shot</td><td>8-shot CoT</td><td>0-shot</td><td>0-shot</td><td>0-shot</td><td>0-shot</td><td>0-shot</td><td>0-shot</td></tr><tr><td>Metric (→)</td><td>EM</td><td>EM</td><td>EM</td><td>Pass@10</td><td>%win</td><td>F1</td><td>Loose Acc</td><td></td></tr><tr><td>OLMoE-1B-7B</td><td>49.0</td><td>2.0</td><td>31.5</td><td>18.9</td><td>-</td><td>62.1</td><td>18.5</td><td>-</td></tr><tr><td>w/o annealing</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr><tr><td>+SFT</td><td>50.2</td><td>43.0</td><td>35.6</td><td>55.5</td><td>68.9</td><td>83.8</td><td>39.7</td><td>53.8</td></tr><tr><td>+DPO</td><td>50.9</td><td>36.0</td><td>35.8</td><td>58.8</td><td>81.7</td><td>83.2</td><td>47.9</td><td>56.3</td></tr><tr><td>OLMoE-1B-7B</td><td>49.8</td><td>3.0</td><td>33.6</td><td>22.4</td><td>-</td><td>59.7</td><td>16.6</td><td>-</td></tr><tr><td>+SFT</td><td>51.4</td><td>40.5</td><td>38.0</td><td>51.6</td><td>69.2</td><td>84.1</td><td>43.3</td><td>54.0</td></tr><tr><td>+DPO</td><td>51.9</td><td>45.5</td><td>37.0</td><td>54.8</td><td>84.0</td><td>82.6</td><td>48.1</td><td>57.7</td></tr><tr><td>+KTO</td><td>51.2</td><td>45.5</td><td>34.1</td><td>57.1</td><td>81.6</td><td>86.6</td><td>47.5</td><td>57.7</td></tr><tr><td>+SFT(load balancing)</td><td>50.9</td><td>36.5</td><td>35.7</td><td>52.4</td><td>66.9</td><td>84.8</td><td>42.3</td><td>52.8</td></tr><tr><td>+DPO(load balancing)</td><td>51.1</td><td>42.5</td><td>39.3</td><td>55.6</td><td>82.9</td><td>82.1</td><td>46.0</td><td>57.1</td></tr></table>

Table 7: Adaptation experiments of OLMOE-1B-7B. We compare using the pretrained checkpoint prior to annealing for adaptation, using the checkpoint after the additional 100B tokens of annealing, and using the checkpoint after the additional 100B tokens of annealing and with load balancing loss (§4.1.6) during adaptation. We apply DPO/KTO to the respective SFT model.

# 5 MoE Analysis

By advancing open and cost-efficient models (§1), OLMOE-1B-7B enables new research into LMs and MoEs. Making use of our released intermediate checkpoints, data, and code, we define and analyze four properties specific to MoEs: Router saturation (§5.1), Expert co-activation (§5.2), Domain specialization (§5.3), and Vocabulary specialization (§5.4).

# 5.1 Router Saturation

We define router saturation as the proportion of expert activations at some intermediary checkpoint at time t that matches the expert IDs activated at some final checkpoint over the same dataset:

$$
\text { Router   Saturation } (t) = \frac {1}{N} \sum_ {i = 1} ^ {N} \frac {\left| \mathcal {E} _ {i} ^ {(t)} \cap \mathcal {E} _ {i} ^ {(T)} \right|}{k}, \tag {5}
$$

where:

• N : The total number of tokens in the dataset.

![](images/dccb11cc90a9efcc57203e4ae852513b169f0d3b70abab35e63f27c06aae0c9f.jpg)

<details>
<summary>line</summary>

| Pretraining s | Router saturation (%) |
| ------------- | --------------------- |
| 1             | 10                    |
| 10            | 20                    |
| 20            | 40                    |
| 40            | 65                    |
</details>

![](images/609cf1d22e0d32facbb807a644e1f32edba64bd3ce8f746f51381916a12c9ff0.jpg)

<details>
<summary>line</summary>

| Stage (%) | Layer ID 0 | Layer ID 1 | Layer ID 2 | Layer ID 3 | Layer ID 4 | Layer ID 5 | Layer ID 6 | Layer ID 7 | Layer ID 8 | Layer ID 9 | Layer ID 10 | Layer ID 11 | Layer ID 12 | Layer ID 13 | Layer ID 14 | Layer ID 15 |
| --------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ---------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| 1         | 0.5        | 0.7        | 0.8        | 0.9        | 1.0        | 1.1        | 1.2        | 1.3        | 1.4        | 1.5        | 1.6         | 1.7         | 1.8         | 1.9         | 2.0         | 2.1         |
| 10        | 1.0        | 1.2        | 1.3        | 1.4        | 1.5        | 1.6        | 1.7        | 1.8        | 1.9        | 2.0        | 2.1         | 2.2         | 2.3         | 2.4         | 2.5         | 2.6         |
| 20        | 1.5        | 1.7        | 1.8        | 1.9        | 2.0        | 2.1        | 2.2        | 2.3        | 2.4        | 2.5        | 2.6         | 2.7         | 2.8         | 2.9         | 3.0         | 3.1         |
| 40        | 2.0        | 2.2        | 2.3        | 2.4        | 2.5        | 2.6        | 2.7        | 2.8        | 2.9        | 3.0        | 3.1         | 3.2         | 3.3         | 3.4         | 3.5         | 3.6         |
</details>

Figure 20: Router saturation during pretraining measured on a random 0.5% of the C4 validation data. We compute saturation by comparing the routing to the top-k experts at four intermediate checkpoints (1, 10, 20, and 40% of pretraining) to the final pretraining checkpoint (Equation 5).

• k: The number of top-k experts activated per input token. While we train with $k = 8 ( \ S 2 )$ , we also analyze $k = 1$ by only looking at the expert with the highest routing probability.   
E (t)i : The set of k experts activated for the ith token at the tth checkpoint. $\mathcal { E } _ { i } ^ { ( t ) }$ E   
$\mathcal { E } _ { i } ^ { ( T ) }$   
• ∣E (t)i ∩ E (T )i ∣: The number of common experts activated for the ith token between the tth $| \mathcal { E } _ { i } ^ { ( t ) } \cap \mathcal { E } _ { i } ^ { ( T ) } |$ and final checkpoints.

Router saturation thus corresponds to whether the router weights are still learning which expert will process certain data. A value of 100% indicates that the router at the intermediate checkpoint will route to the same experts as the final checkpoint router. However, even at 100% saturation the router weight can still change and adapt the exact router probability for each expert. These probabilities are used to scale the output of the respective expert in the model. For OLMOE-1B-7B with its 64 experts, random routing equals a saturation of $1 \dot { / } 6 4 = 1 . 6 \%$ for k = 1 and 8/64 = 12.5% for $k = 8 .$

In Figure 20 we find that after 1% of pretraining (5000 steps or 20B tokens), up to ∼60% of routing to the top-8 activated experts has already saturated (right). Thus the model already uses the same 8 experts for given input data as it will at the end of pretraining. This early saturation aligns with prior work [199]. At 40% of pretraining, saturation reaches up to ∼80%. However, which top-1 expert has the highest routing probability saturates slower (left). We find that routing in later layers saturates earlier during pretraining. Layer 0 is an outlier saturating significantly more slowly than other layers. Dai et al. [39] do not use an MoE in the first layer as they find that load balancing converges more slowly for the first layer. This is likely linked to our findings on saturation. Because routing in the first layer saturates slower, the experts that certain input data get routed to frequently change. These changes may lead to one expert suddenly getting significantly more data than others thereby impairing load balancing. We are excited about future work further investigating what happens in the first layer by building on our open release.

# 5.2 Expert Co-activation

We define expert co-activation as the proportion of times two specific experts, $E _ { i }$ and $E _ { j } .$ , are simultaneously activated out of the total number of activations of one of those experts:

$$
\text { Expert   co - activation } (E _ {i}, E _ {j}) = \frac {N _ {E _ {i} , E _ {j}}}{N _ {E _ {i}}}, \tag {6}
$$

where:

• $E _ { i } \colon$ The first expert.   
• $E _ { j } \colon$ The second expert.   
• $N _ { E _ { i } , E _ { j } }$ : The number of times experts $E _ { i }$ and $E _ { j }$ are activated together.

![](images/64cab10378e53b8bc8d40777cf5fec45722437ea26fe62a64188cbc87a9d6107.jpg)

<details>
<summary>heatmap</summary>

| | Layer 0 | Layer 7 | Layer 15 |
|---|---|---|---|
| 0 | 40 | 23 | 10 |
| 0 | 20 | 48 | 13 |
| 0 | 43 | 56 | 46 |
| 0 | 7 | 5 | 60 |
| 0 | 53 | 46 | 21 |
| 0 | 5 | 19 | 7 |
| 0 | 41 | 49 | 62 |
| 0 | 18 | 31 | 43 |
| 0 | 31 | 26 | 29 |
| 0 | 56 | 45 | 0 |
| 0 | 26 | 39 | 31 |
| 0 | 4 | 42 | 47 |
| 0 | 8 | 59 | 2 |
| 0 | 46 | 18 | 0 |
| 0 | 50 | 18 | 0 |
| 0 | 9 | 18 | 0 |
| 7 | 40 | 23 | 10 |
| 7 | 20 | 48 | 13 |
| 7 | 43 | 56 | 46 |
| 7 | 7 | 5 | 60 |
| 7 | 53 | 46 | 21 |
| 7 | 5 | 19 | 7 |
| 7 | 41 | 49 | 62 |
| 7 | 18 | 31 | 43 |
| 7 | 31 | 26 | 29 |
| 7 | 56 | 45 | 0 |
| 7 | 26 | 39 | 31 |
| 7 | 4 | 42 | 47 |
| 7 | 8 | 59 | 2 |
| 7 | 46 | 18 | 0 |
| 7 | 50 | 18 | 0 |
| 7 | 9 | 18 | 0 |
| 15 | 40 | 23 | 10 |
| 15 | 20 | 48 | 13 |
| 15 | 43 | 56 | 46 |
| 15 | 7 | 5 | 60 |
| 15 | 53 | 46 | 21 |
| 15 | 5 | 19 | 7 |
| 15 | 41 | 49 | 62 |
| 15 | 18 | 31 | 43 |
| 15 | 31 | 26 | 29 |
| 15 | 56 | 45 | 0 |
| 15 | 26 | 39 | 31 |
| 15 | 4 | 42 | 47 |
| 15 | 8 | 59 | 2 |
| 15 | 46 | 18 | 0 |
| 15 | 50 | 18 | 0 |
| 15 | 9 | 18 | 0 |
</details>

Figure 21: Co-activation among experts of OLMOE-1B-7B on a random 0.5% of the C4 validation data. We display the 32 experts with the highest maximum co-activation score via their expert IDs on the x- and y-axis.

• $N _ { E _ { i } }$ : The total number of times expert $E _ { i }$ is activated.

A co-activation of 100% indicates that if $E _ { i }$ is activated, $E _ { j }$ is also always activated. A value of 0% indicates that the experts never co-occur. If multiple expert pairs have high co-activation, it may suggest that these experts could be merged, benefiting less from keeping them separate. In a distributed setup, we could place highly co-activated experts on the same device to reduce communication costs during model inference.

In Figure 21, we find that there is no strong co-activation among experts in one layer, with only few exceptions. This may indicate that there is little redundancy across different experts. Overall, layers 7 and 15 show similar co-activation patterns with several groups of 3 or 2 experts that tend to get activated together. We investigate tokens that activate these experts in §5.4. Further, in Appendix G (Figure 35), we investigate whether experts across layers, rather than within one layer, tend to process tokens together.

# 5.3 Domain Specialization

We define domain specialization as the proportion of tokens from a particular domain D that get routed to a particular expert $E _ { i }$ :

$$
\text { Domain   specialization } (E _ {i}, D) = \frac {N _ {E _ {i} , D} ^ {(k)}}{N _ {D}}, \tag {7}
$$

where:

• $E _ { i }$ The ith expert in the model.   
• D: The domain from which the data originates.   
• k: The number of experts considered $( \mathbf { e . g . , } k = 8$ means considering the top 8 experts with the highest routing probabilities).   
• N (k) $N _ { E _ { i } , D } ^ { ( k ) } \colon$ The number of tokens from domain D for which $E _ { i }$ is among the top-k selected experts.   
• $N _ { D } \mathrm { : }$ : The total number of tokens from domain D processed by the MoE.

Domain specialization thus refers to the specialization of expert $E _ { i }$ to domain D. A value of 100% indicates that all data from that domain is routed to $E _ { i } ,$ , whereas 0% indicates the expert is never used for that domain and can be removed from the model without affecting performance in that domain.

In Figure 22 (top) we find many examples of experts that are activated significantly above or below random chance for specific domains. $\mathrm { E . g . }$ , for arXiv, which has a very specific distribution with lots of scientific text, the first expert in layer 0 is nearly 100% specialized. This suggests that there is little redundancy in the knowledge of the experts in OLMOE-1B-7B, as they specialize in different kinds of data. GitHub and arXiv are often activated together in layer 7, which we explore further

![](images/4a4b3f5b52a93fc95e615bf0673dc9bf6f50d4f08c99ee924589bd96237b7342.jpg)

![](images/95b786ce384ef5c2caec16b94a310700eb5d34255073f65550a1dbeeb6a83f22.jpg)

<details>
<summary>bar</summary>

| Expert ID | Layer 0 | Layer 7 | Layer 15 |
| --------- | ------- | ------- | -------- |
| 0         | 0       | 0       | 0        |
| 2         | 0       | 0       | 0        |
| 4         | 0       | 0       | 0        |
| 6         | 0       | 0       | 0        |
</details>

Figure 22: Domain specialization of OLMOE-1B-7B (top) vs. Mixtral-8x7B (bottom). We visualize how often tokens from different domains get routed to the 64 (OLMOE) or 8 (Mixtral) experts at the end of pretraining. We consider tokens routed to any of the $k = 8 \ : ( \mathbf { O L M O E } )$ or k = 2 (Mixtral) active experts (Equation 7). Horizontal gray lines correspond to random chance or uniform routing (8/64=12.5% per expert for OLMOE-1B-7B with 8 active out of 64 total experts per layer and 2/8=25% for Mixtral with 2 active out of 8 total experts per layer). See Figure 34 for k = 1 results.

in §5.4. For generic domains, such as C4 [139], which is a web crawl containing various kinds of data, expert activations in OLMOE-1B-7B are much more balanced. This highlights that the load balancing (§4.1.6) works as intended and the model makes proper use of all experts for generic data. Mixtral-8x7B [79] in Figure 22 (bottom), however, exhibits little domain specialization across both unique and generic domains. Experts are activated close to the uniform routing baseline for all layers and domains. Thus, there may be more redundancy across experts in Mixtral, as they likely contain similar knowledge. We hypothesize that this is due to Mixtral being upcycled from Mistral [25]. The initialization from a dense model may limit the amount of possible specialization in the experts as they all start from the same local optimum. This is likely why training from scratch eventually outperforms upcycling in our pretraining experiments (§4.1.5).

# 5.4 Vocabulary Specialization

![](images/26c3b87a73c24cccd11d0d091e2b3a7dc2195a9673d019b8fcd42c41cef1d244.jpg)  
Figure 23: Vocabulary specialization of OLMOE-1B-7B across layers and experts. To compute vocabulary specialization per layer (left) we average the specialization of each expert in that layer. Dashed lines (right) correspond to the average of layer 7 as depicted left. We display the first 32 experts out of 64. This plot is for k = 1 (Equation 8) and we provide $k = 8$ and a comparison with Mixtral-8x7B in Appendix G.

We define vocabulary specialization as the proportion of tokens with a token ID x (also called vocabulary element) that are routed to one particular expert $E _ { i }$ out of all experts in that layer:

$$
\text { Vocabulary   specialization } (E _ {i}, x) = \frac {N _ {x , E _ {i}} ^ {(k)}}{N _ {x}}, \tag {8}
$$

where:

• $E _ { i }$ The ith expert in the model.   
• x: The token ID being analyzed.   
• k: The number of experts considered $( \mathbf { e . g . , } k = 8$ means considering the top 8 experts with the highest routing probabilities).   
• $N _ { x , E _ { i } ; }$ : The number of times input data is routed to $E _ { i }$ for x.   
• $N _ { x } { \mathrm { : } }$ The total number of times input data is routed across all experts for x.

Vocabulary specialization thus refers to how specialized a particular expert is on some vocabulary item. We distinguish input and output variants of this specialization, where x is either the input token ID or the next output token ID (either the ground-truth next token ID or the token ID predicted by the model). A value of 100% indicates that for all occurrences of that vocabulary element, input data is routed to $E _ { i } .$ , whereas 0% indicates an expert that is fully irrelevant for that vocabulary element and can be effectively removed from the model without affecting performance whenever the token ID appears.

In Figure 23 we find that vocabulary specialization is higher in later layers, similar to how later layers saturate earlier (§5.1). Later layers also specialize more on predicted output token IDs rather than input token IDs, i.e., the routing is decided more by the token the model is about to predict rather than the original input token. This is intuitive as in earlier layers there is more uncertainty about which token the model will predict. At ∼90%, expert 27 specializes the most, which we find in Table 8 to activate for many non-alphabetic tokens, such as Cyrillic and Devanagari letters.

<table><tr><td>Expert ID</td><td colspan="5">Input token IDs</td><td colspan="5">Predicted output token IDs</td></tr><tr><td rowspan="3">27</td><td> (100%)</td><td>$ (100%)</td><td>$ ^{3} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td></tr><tr><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td></tr><tr><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td><td>$ ^{1} $ (100%)</td></tr><tr><td rowspan="3">58</td><td>(“ (100%)</td><td>(“ (100%)</td><td>(“ (94%)</td><td>(“ (92%)</td><td>such (100%)</td><td>486 (100%)</td><td>see (95%)</td><td>(95%)</td><td>(95%)</td><td>(95%)</td></tr><tr><td>(“ (92%)</td><td>(“ (92%)</td><td>(“ (90%)</td><td>(“ (89%)</td><td>which (91%)</td><td>driving (91%)</td><td>UK (90%)</td><td>(90%)</td><td>(90%)</td><td>(90%)</td></tr><tr><td>(88%)</td><td>(87%)</td><td>[ (87%)</td><td>£ (86%)</td><td>who (88%)</td><td>including (88%)</td><td>normal (88%)</td><td>(88%)</td><td>(88%)</td><td>(88%)</td></tr><tr><td rowspan="4">7</td><td>Him (100%)</td><td>inde (100%)</td><td>Jesus (98%)</td><td>rella (100%)</td><td>him (94%)</td><td>sin (90%)</td><td>(90%)</td><td>(90%)</td><td>(90%)</td><td>(90%)</td></tr><tr><td>God (90%)</td><td>pray (81%)</td><td>Holy (80%)</td><td>prince (80%)</td><td>glory (72%)</td><td>Jesus (69%)</td><td>(69%)</td><td>(69%)</td><td>(69%)</td><td>(69%)</td></tr><tr><td>Quran (80%)</td><td>God (77%)</td><td>Lord (76%)</td><td>Lord (68%)</td><td>Christ (65%)</td><td>Spirit (55%)</td><td>(55%)</td><td>(55%)</td><td>(55%)</td><td>(55%)</td></tr><tr><td>glory (75%)</td><td>Spirit (66%)</td><td>Christ (65%)</td><td>Holy (53%)</td><td>God (50%)</td><td>Prayer (50%)</td><td>(50%)</td><td>(50%)</td><td>(50%)</td><td>(50%)</td></tr><tr><td rowspan="4">37</td><td>Sunday (100%)</td><td>Tuesday (100%)</td><td>(100%)</td><td>days (91%)</td><td>anniversary (90%)</td><td>month (90%)</td><td>(90%)</td><td>(90%)</td><td>(90%)</td><td>(90%)</td></tr><tr><td>Thursday (100%)</td><td>Olympic (100%)</td><td>(100%)</td><td>(88%)</td><td>week (84%)</td><td>mpi (83%)</td><td>semester (83%)</td><td>semester (83%)</td><td>semester (83%)</td><td>semester (83%)</td></tr><tr><td>Christmas (100%)</td><td>rugby (100%)</td><td>(100%)</td><td>(81%)</td><td>mand (80%)</td><td>Olympics (78%)</td><td>cent (78%)</td><td>cent (78%)</td><td>cent (78%)</td><td>cent (78%)</td></tr><tr><td>Championship (100%)</td><td>weekends (100%)</td><td>(100%)</td><td>(76%)</td><td>season (76%)</td><td>perm (75%)</td><td>(75%)</td><td>(75%)</td><td>(75%)</td><td>(75%)</td></tr><tr><td rowspan="5">43</td><td>Armenian (100%)</td><td>ijan (100%)</td><td>enia (96%)</td><td>enia (90%)</td><td>invasion (80%)</td><td>Arabia (76%)</td><td>(76%)</td><td>(76%)</td><td>(76%)</td><td>(76%)</td></tr><tr><td>Iraq (95%)</td><td>Iranian (92%)</td><td>Iran (92%)</td><td>irregular (66%)</td><td>regions (64%)</td><td>border (64%)</td><td>(64%)</td><td>(64%)</td><td>(64%)</td><td>(64%)</td></tr><tr><td>Saudi (90%)</td><td>northern (90%)</td><td>Lebanon (63%)</td><td>Kong (61%)</td><td>ians (61%)</td><td>bases (61%)</td><td>(61%)</td><td>(61%)</td><td>(61%)</td><td>(61%)</td></tr><tr><td>(90%)</td><td>Singapore (88%)</td><td>Turkey (88%)</td><td>Republic (59%)</td><td>Ireland (58%)</td><td>(58%)</td><td>(58%)</td><td>(58%)</td><td>(58%)</td><td>(58%)</td></tr><tr><td>Asia (87%)</td><td>Egypt (86%)</td><td>western (86%)</td><td>Korea (58%)</td><td>War (55%)</td><td>Carolina (52%)</td><td>(52%)</td><td>(52%)</td><td>(52%)</td><td>(52%)</td></tr><tr><td rowspan="5">4</td><td>sq (89%)</td><td>Main (70%)</td><td>reversal (69%)</td><td>YR (90%)</td><td>Character (88%)</td><td>sq (77%)</td><td>(77%)</td><td>(77%)</td><td>(77%)</td><td>(77%)</td></tr><tr><td>YR (63%)</td><td>GC (56%)</td><td>Overall (50%)</td><td>79 Os (76%)</td><td>GHz (71%)</td><td>fluence (60%)</td><td>(60%)</td><td>(60%)</td><td>(60%)</td><td>(60%)</td></tr><tr><td>(50%)</td><td>main (50%)</td><td>RE (46%)</td><td>PCR (46%)</td><td>amycin (60%)</td><td>pixels (56%)</td><td>(56%)</td><td>(56%)</td><td>(56%)</td><td>(56%)</td></tr><tr><td>tomb (45%)</td><td>normal (43%)</td><td>intensity (52%)</td><td>Story (52%)</td><td>(52%)</td><td>anth (50%)</td><td>(50%)</td><td>(50%)</td><td>(50%)</td><td>(50%)</td></tr><tr><td>(41%)</td><td>Overall (41%)</td><td>median (41%)</td><td>GHz (50%)</td><td>cm (46%)</td><td>(46%)</td><td>(46%)</td><td>(46%)</td><td>(46%)</td><td>(46%)</td></tr><tr><td rowspan="5">0</td><td>ESM (100%)</td><td>icillin (100%)</td><td>agra (98%)</td><td>*, (100%)</td><td>sil (96%)</td><td>pills (91%)</td><td>vi (91%)</td><td>vi (91%)</td><td>vi (91%)</td><td>vi (91%)</td></tr><tr><td>aust (96%)</td><td>asa (93%)</td><td>pills (92%)</td><td>(90%)</td><td>xen (87%)</td><td>pharmacy (87%)</td><td>(87%)</td><td>(87%)</td><td>(87%)</td><td>(87%)</td></tr><tr><td>(85%)</td><td>uk (82%)</td><td>login (82%)</td><td>(85%)</td><td>aust (82%)</td><td>mg (75%)</td><td>(75%)</td><td>(75%)</td><td>(75%)</td><td>(75%)</td></tr><tr><td>generic (81%)</td><td>cd (81%)</td><td>Essay (81%)</td><td>(75%)</td><td>uk (73%)</td><td>THAT (73%)</td><td>dispens (73%)</td><td>dispens (73%)</td><td>dispens (73%)</td><td>dispens (73%)</td></tr><tr><td>password (81%)</td><td>Content (80%)</td><td>(68%)</td><td>icillin (68%)</td><td>generic (66%)</td><td>(66%)</td><td>(66%)</td><td>(66%)</td><td>(66%)</td><td>(66%)</td></tr><tr><td rowspan="4">3</td><td>grandmother (92%)</td><td>brother (91%)</td><td>Daisy (90%)</td><td>hood (36%)</td><td>mother (35%)</td><td>inde (31%)</td><td>(31%)</td><td>(31%)</td><td>(31%)</td><td>(31%)</td></tr><tr><td>(83%)</td><td>daughter (78%)</td><td>mum (75%)</td><td>boy (29%)</td><td>girl (28%)</td><td>married (27%)</td><td>(27%)</td><td>(27%)</td><td>(27%)</td><td>(27%)</td></tr><tr><td>father (72%)</td><td>wife (70%)</td><td>husband (70%)</td><td>tri (21%)</td><td>Gab (20%)</td><td>died (18%)</td><td>(18%)</td><td>(18%)</td><td>(18%)</td><td>(18%)</td></tr><tr><td>lady (63%)</td><td>dad (62%)</td><td>boy (61%)</td><td>taught (14%)</td><td>lived (13%)</td><td>knew (10%)</td><td>(10%)</td><td>(10%)</td><td>(10%)</td><td>(10%)</td></tr><tr><td rowspan="2">48</td><td>compared (42%)</td><td>(41%)</td><td>Then (41%)</td><td>(41%)</td><td>except (60%)</td><td>tennis (41%)</td><td>Marks (40%)</td><td>(40%)</td><td>(40%)</td><td>(40%)</td></tr><tr><td>(40%)</td><td>(35%)</td><td>(35%)</td><td>instead (33%)</td><td>Dunn (33%)</td><td>tears (30%)</td><td>Arizona (30%)</td><td>(30%)</td><td>(30%)</td><td>(30%)</td></tr><tr><td rowspan="3">23</td><td>..... (58%)</td><td>Therefore (55%)</td><td>So (46%)</td><td>!!!</td><td>(53%)</td><td>Republican (50%)</td><td>Jack (50%)</td><td>Jack (50%)</td><td>Jack (50%)</td><td>Jack (50%)</td></tr><tr><td>(46%)</td><td>And (44%)</td><td>According (41%)</td><td>(47%)</td><td>THIS (40%)</td><td>Democratic (40%)</td><td>(40%)</td><td>(40%)</td><td>(40%)</td><td>(40%)</td></tr><tr><td>(41%)</td><td>(40%)</td><td>(38%)</td><td>But (38%)</td><td>according (39%)</td><td>So (38%)</td><td>Step (33%)</td><td>Step (33%)</td><td>Step (33%)</td><td>Step (33%)</td></tr></table>

Table 8: Vocabulary specialization in the 7th layer of OLMOE-1B-7B. We use k = 1 (Equation 8) and a random 0.5% of the C4 validation data excluding token IDs with <10 appearances.

Expert 43 shows specialization on geographic terms in both input and output tokens. Experts 48 and 23 both focus on connector words, such as Then and Therefore This is likely because they commonly process tokens together with a high co-activation of 60% in Figure 21 (middle). Based on our findings in §5.3 that for GitHub and arXiv often the same experts in layer 7 activate, we display one such expert (expert ID 4) in Table 8. It seems to specialize in measurements, such as sq , YR (year), and GHz . These are common terms in scientific papers corresponding to the arXiv domain and likely also in GitHub code for computations related to measurements. They are less likely to appear in books, which explains the low activation of expert ID 4 in layer 7 for book data in Figure 22. Expert 3 is among the three most active experts of layer 7 for book data in Figure 22 (fourth yellow bar for layer 7). This resonates when looking at its specialization on family terms in Table 8, which are far more common in books than scientific papers or code. Overall, domain specialization and vocabulary specialization are closely linked to one another, as domains are usually characterized by their distinct word distribution. In Appendix G (Figure 32), we link them more closely by comparing the extent of vocabulary specialization across domains and expert IDs. In Appendix G (Figure 30, Figure 31) we also find that OLMOE-1B-7B exhibits stronger vocabulary specialization than Mixtral-8x7B.

# 6 Related Work

Advances in MoEs Current LMs still largely follow the transformer architecture [185] with only few architectural changes that have been widely adopted, such as decoder-only training [137], SwiGLU activations [153, 41], RoPE [166], MQA/GQA [152, 3] and RMSNorm [208]. Model sparsity via Mixture-of-Experts is one modification still under active exploration with some early adoption but most LMs, including Llama 3 [50], still rely on a dense architecture. There has been a lot of progress in improving the sparsely-gated MoE layer since its introduction [154]: New routing techniques [89, 146, 222, 66, 77, 49, 215, 195, 124], fine-grained expert segmentation [39, 69], stability [221] and efficiency [88, 141, 48, 218, 91, 168, 129, 145] improvements. In this work, we perform many experiments to provide insights into training Mixture-of-Experts LMs. Subsequently, we train OLMOE-1B-7B for 5T tokens. No prior MoE has been overtrained [57] to this extent to our knowledge making OLMOE-1B-7B the best testbed to research performance saturation of MoEs vs. dense models. With OLMOE we hope to facilitate such and other research to help the field uncover whether MoEs should make it into all future LMs and with what precise configuration.

Open LMs A variety of model families have been proposed under varying degrees of openness commonly categorized based on whether model weights are available. Closed-weight models include GPT [24, 128], Gemini [174, 175], PaLM [30, 9], Reka [181], and open-weight ones include Llama [182, 183, 50], Mistral [78, 79], Gemma [176, 177], Falcon [8, 132], MPT [179], Qwen [13, 201], GLM [61], Yi [2], DeepSeek [42, 43, 39], Nemotron [130, 126], Zamba [62], InternLM [26], Baichuan [200], Phi [68, 94, 1], StableLM [16], OPT [212]. However, besides model weights, training data and code are key to enabling scientific research of these models [105, 106] and distributing their benefits broadly [23]. There have been few releases also including data and code in addition to model weights which we refer to as “fully open-source”: BLOOM [193, 151, 123, 203], GPT-NeoX [21, 22, 186], StarCoder [92, 109, 5, 120, 220], Pythia [18], OLMo [65], LLM360 [103], Cerebras-GPT [46], DCLM [90], MAP-Neo [209], RWKV [133, 134], and SmolLM [6]. For Mixture-of-Experts only OpenMoE [199] aims to be fully open-source, however, its poor performance limits its usefulness. We release OLMOE-1B-7B as the first state-of-the-art Mixture-of-Experts LM that is fully open-source: model weights, data, code, and logs.

# 7 Conclusion

We open-source OLMOE-1B-7B and OLMOE-1B-7B-INSTRUCT including model, data, code, and logs. At 1B active and 7B total parameters, our models yield state-of-the-art performance among models with a similar amount of active parameters even outperforming larger models including DeepSeekMoE-16B and Llama2-13B-Chat. We share various training experiments and define and analyze router saturation, expert co-activation, domain and vocabulary specialization of our model. Through our fully open release, we seek to help the field build better MoEs. We are excited about more iterations of OLMOE to close the gap between frontier models and fully open models.

# Author Contributions

Niklas Muennighoff proposed and led the project. He ran the pretraining experiments, pretrained the model, helped run adaptation and analysis, and wrote most of the paper.

Luca Soldaini created the pretraining dataset and advised on pretraining.

Dirk Groeneveld advised on pretraining, especially stability and throughput improvements.

Kyle Lo helped with pretraining dataset creation, analyzed data experiments, and advised on data and framing, and helped edit the paper.

Jacob Morrison co-created the adaptation dataset, ran most adaptation experiments, and helped edit the paper.

Sewon Min analyzed router saturation, expert correlation, and vocabulary specialization, and helped frame and edit the paper.

Weijia Shi analyzed domain and vocabulary specialization, advised at various project stages, and helped edit the paper.

Pete Walsh advised on pretraining, especially stability and throughput improvements.

Oyvind Tafjord ran OLMES evaluations.

Nathan Lambert co-created the adaptation dataset, advised on adaptation, and helped edit the paper.

Yuling Gu ran OLMES evaluations and helped edit the paper.

Shane Arora uploaded the models, helped with code review and framework integration.

Akshita Bhagia supported stability investigations and helped with DCLM evaluations.

Dustin Schwenk supported stability investigations.

David Wadden ran DCLM evaluations and helped with Weights & Biases reports.

Alexander Wettig advised on pretraining, analyzed load balancing, routing, and domain specialization, and helped edit the paper.

Binyuan Hui advised on pretraining and helped with plotting and framework integration.

Tim Dettmers advised on analysis and inference experiments.

Douwe Kiela advised on framing.

Ali Farhadi advised on pretraining and framing.

Noah A. Smith advised on pretraining, and helped frame and edit the paper.

Pang Wei Koh advised on analysis, and helped frame and edit the paper.

Amanpreet Singh advised on pretraining, framing and helped edit the paper.

Hannaneh Hajishirzi was responsible for direction and advising of the overall effort and helped frame and edit the paper.

# Acknowledgements

OLMOE would not be possible without the support of many individuals and institutions. We thank our teammates at the Allen Institute for AI, Contextual AI, and the University of Washington for their support, especially Aditya Kusupati, Ananya Harsh Jha, Caitlin Wittlif, Carissa Schoenick, Costa Huang, Crystal Nam, David Atkinson, Emma Strubell, Faeze Brahman, Hamish Ivison, Karel D’Oosterlinck, Matt Latzke, Ian Magnusson, Jack Merullo, Jay Chen, Jennifer Dumas, Jiacheng Liu, Johann Dahm, Luke Zettlemoyer, Michael Schmitz, Michael Wilson, Pradeep Dasigi, Sahil Verma, Sam Skjonsberg, Sophie Lebrecht, Stas Bekman, Taira Anderson, Valentina Pyatkin, Yanai Elazar, Yizhong Wang, and Yoganand Chandrasekhar. We also thank Armen Aghajanyan, Akshat Shrivastava, Colin Raffel, Haokun Liu, Ludwig Schmidt, Mengzhou Xia, Shayne Longpre, Sheng Shen, and Zexuan Zhong. PWK is supported by the Singapore National Research Foundation and the National AI Group in the Singapore Ministry of Digital Development and Innovation under the AI Visiting Professorship Programme (award number AIVP-2024-001).

# References

[1] Marah Abdin, Sam Ade Jacobs, Ammar Ahmad Awan, Jyoti Aneja, Ahmed Awadallah, Hany Awadalla, Nguyen Bach, Amit Bahree, Arash Bakhtiari, Jianmin Bao, Harkirat Behl, Alon Benhaim, Misha Bilenko, Johan Bjorck, Sebastien Bubeck, Qin Cai, Martin Cai,´ Caio Cesar Teodoro Mendes, Weizhu Chen, Vishrav Chaudhary, Dong Chen, Dongdong ´ Chen, Yen-Chun Chen, Yi-Ling Chen, Parul Chopra, Xiyang Dai, Allie Del Giorno, Gustavo de Rosa, Matthew Dixon, Ronen Eldan, Victor Fragoso, Dan Iter, Mei Gao, Min Gao, Jianfeng Gao, Amit Garg, Abhishek Goswami, Suriya Gunasekar, Emman Haider, Junheng Hao, Russell J. Hewett, Jamie Huynh, Mojan Javaheripi, Xin Jin, Piero Kauffmann, Nikos Karampatziakis, Dongwoo Kim, Mahoud Khademi, Lev Kurilenko, James R. Lee, Yin Tat Lee, Yuanzhi Li, Yunsheng Li, Chen Liang, Lars Liden, Ce Liu, Mengchen Liu, Weishung Liu, Eric Lin, Zeqi Lin, Chong Luo, Piyush Madan, Matt Mazzola, Arindam Mitra, Hardik Modi, Anh Nguyen, Brandon Norick, Barun Patra, Daniel Perez-Becker, Thomas Portet, Reid Pryzant, Heyang Qin, Marko Radmilac, Corby Rosset, Sambudha Roy, Olatunji Ruwase, Olli Saarikivi, Amin Saied, Adil Salim, Michael Santacroce, Shital Shah, Ning Shang, Hiteshi Sharma, Swadheen Shukla, Xia Song, Masahiro Tanaka, Andrea Tupini, Xin Wang, Lijuan Wang, Chunyu Wang, Yu Wang, Rachel Ward, Guanhua Wang, Philipp Witte, Haiping Wu, Michael Wyatt, Bin Xiao, Can Xu, Jiahang Xu, Weijian Xu, Sonali Yadav, Fan Yang, Jianwei Yang, Ziyi Yang, Yifan Yang, Donghan Yu, Lu Yuan, Chengruidong Zhang, Cyril Zhang, Jianwen Zhang, Li Lyna Zhang, Yi Zhang, Yue Zhang, Yunan Zhang, and Xiren Zhou. 2024. Phi-3 Technical Report: A Highly Capable Language Model Locally on Your Phone.   
[2] 01. AI, :, Alex Young, Bei Chen, Chao Li, Chengen Huang, Ge Zhang, Guanwei Zhang, Heng Li, Jiangcheng Zhu, Jianqun Chen, Jing Chang, Kaidong Yu, Peng Liu, Qiang Liu, Shawn Yue, Senbin Yang, Shiming Yang, Tao Yu, Wen Xie, Wenhao Huang, Xiaohui Hu, Xiaoyi Ren, Xinyao Niu, Pengcheng Nie, Yuchi Xu, Yudong Liu, Yue Wang, Yuxuan Cai, Zhenyu Gu, Zhiyuan Liu, and Zonghong Dai. 2024. Yi: Open Foundation Models by 01.AI.   
[3] Joshua Ainslie, James Lee-Thorp, Michiel de Jong, Yury Zemlyanskiy, Federico Lebron, and´ Sumit Sanghai. 2023. GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints.   
[4] Alon Albalak, Yanai Elazar, Sang Michael Xie, Shayne Longpre, Nathan Lambert, Xinyi Wang, Niklas Muennighoff, Bairu Hou, Liangming Pan, Haewon Jeong, Colin Raffel, Shiyu Chang, Tatsunori Hashimoto, and William Yang Wang. 2024. A Survey on Data Selection for Language Models.   
[5] Loubna Ben Allal, Raymond Li, Denis Kocetkov, Chenghao Mou, Christopher Akiki, Carlos Munoz Ferrandis, Niklas Muennighoff, Mayank Mishra, Alex Gu, Manan Dey, et al. 2023. SantaCoder: don’t reach for the stars!   
[6] Loubna Ben Allal, Anton Lozhkov, Elie Bakouch, Leandro von Werra, and Thomas Wolf. 2024. SmolLM - blazingly fast and remarkably powerful.   
[7] Zeyuan Allen-Zhu and Yuanzhi Li. 2024. Physics of Language Models: Part 3.3, Knowledge Capacity Scaling Laws.   
[8] Ebtesam Almazrouei, Hamza Alobeidli, Abdulaziz Alshamsi, Alessandro Cappelli, Ruxandra Cojocaru, Merouane Debbah,´ Etienne Goffinet, Daniel Hesslow, Julien Launay, Quentin´ Malartic, Daniele Mazzotta, Badreddine Noune, Baptiste Pannier, and Guilherme Penedo. 2023. The Falcon Series of Open Language Models.   
[9] Rohan Anil, Andrew M. Dai, Orhan Firat, Melvin Johnson, Dmitry Lepikhin, Alexandre Passos, Siamak Shakeri, Emanuel Taropa, Paige Bailey, Zhifeng Chen, Eric Chu, Jonathan H. Clark, Laurent El Shafey, Yanping Huang, Kathy Meier-Hellstern, Gaurav Mishra, Erica Moreira, Mark Omernick, Kevin Robinson, Sebastian Ruder, Yi Tay, Kefan Xiao, Yuanzhong Xu, Yujing Zhang, Gustavo Hernandez Abrego, Junwhan Ahn, Jacob Austin, Paul Barham, Jan Botha, James Bradbury, Siddhartha Brahma, Kevin Brooks, Michele Catasta, Yong Cheng, Colin Cherry, Christopher A. Choquette-Choo, Aakanksha Chowdhery, Clement´ Crepy, Shachi Dave, Mostafa Dehghani, Sunipa Dev, Jacob Devlin, Mark D´ıaz, Nan Du, Ethan Dyer, Vlad Feinberg, Fangxiaoyu Feng, Vlad Fienber, Markus Freitag, Xavier Garcia,

Sebastian Gehrmann, Lucas Gonzalez, Guy Gur-Ari, Steven Hand, Hadi Hashemi, Le Hou, Joshua Howland, Andrea Hu, Jeffrey Hui, Jeremy Hurwitz, Michael Isard, Abe Ittycheriah, Matthew Jagielski, Wenhao Jia, Kathleen Kenealy, Maxim Krikun, Sneha Kudugunta, Chang Lan, Katherine Lee, Benjamin Lee, Eric Li, Music Li, Wei Li, YaGuang Li, Jian Li, Hyeontaek Lim, Hanzhao Lin, Zhongtao Liu, Frederick Liu, Marcello Maggioni, Aroma Mahendru, Joshua Maynez, Vedant Misra, Maysam Moussalem, Zachary Nado, John Nham, Eric Ni, Andrew Nystrom, Alicia Parrish, Marie Pellat, Martin Polacek, Alex Polozov, Reiner Pope, Siyuan Qiao, Emily Reif, Bryan Richter, Parker Riley, Alex Castro Ros, Aurko Roy, Brennan Saeta, Rajkumar Samuel, Renee Shelby, Ambrose Slone, Daniel Smilkov, David R. So, Daniel Sohn, Simon Tokumine, Dasha Valter, Vijay Vasudevan, Kiran Vodrahalli, Xuezhi Wang, Pidong Wang, Zirui Wang, Tao Wang, John Wieting, Yuhuai Wu, Kelvin Xu, Yunhan Xu, Linting Xue, Pengcheng Yin, Jiahui Yu, Qiao Zhang, Steven Zheng, Ce Zheng, Weikang Zhou, Denny Zhou, Slav Petrov, and Yonghui Wu. 2023. PaLM 2 Technical Report.   
[10] Mikel Artetxe, Shruti Bhosale, Naman Goyal, Todor Mihaylov, Myle Ott, Sam Shleifer, Xi Victoria Lin, Jingfei Du, Srinivasan Iyer, Ramakanth Pasunuru, Giri Anantharaman, Xian Li, Shuohui Chen, Halil Akin, Mandeep Baines, Louis Martin, Xing Zhou, Punit Singh Koura, Brian O’Horo, Jeff Wang, Luke Zettlemoyer, Mona Diab, Zornitsa Kozareva, and Ves Stoyanov. 2022. Efficient Large Scale Language Modeling with Mixtures of Experts.   
[11] Zhangir Azerbayev, Hailey Schoelkopf, Keiran Paster, Marco Dos Santos, Stephen McAleer, Albert Q. Jiang, Jia Deng, Stella Biderman, and Sean Welleck. 2023. Llemma: An Open Language Model For Mathematics.   
[12] Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E. Hinton. 2016. Layer Normalization.   
[13] Jinze Bai, Shuai Bai, Yunfei Chu, Zeyu Cui, Kai Dang, Xiaodong Deng, Yang Fan, Wenbin Ge, Yu Han, Fei Huang, Binyuan Hui, Luo Ji, Mei Li, Junyang Lin, Runji Lin, Dayiheng Liu, Gao Liu, Chengqiang Lu, Keming Lu, Jianxin Ma, Rui Men, Xingzhang Ren, Xuancheng Ren, Chuanqi Tan, Sinan Tan, Jianhong Tu, Peng Wang, Shijie Wang, Wei Wang, Shengguang Wu, Benfeng Xu, Jin Xu, An Yang, Hao Yang, Jian Yang, Shusheng Yang, Yang Yao, Bowen Yu, Hongyi Yuan, Zheng Yuan, Jianwei Zhang, Xingxuan Zhang, Yichang Zhang, Zhenru Zhang, Chang Zhou, Jingren Zhou, Xiaohuan Zhou, and Tianhang Zhu. 2023. Qwen Technical Report.   
[14] Jinze Bai, Shuai Bai, Shusheng Yang, Shijie Wang, Sinan Tan, Peng Wang, Junyang Lin, Chang Zhou, and Jingren Zhou. 2023. Qwen-VL: A Versatile Vision-Language Model for Understanding, Localization, Text Reading, and Beyond.   
[15] Yuntao Bai, Saurav Kadavath, Sandipan Kundu, Amanda Askell, Jackson Kernion, Andy Jones, Anna Chen, Anna Goldie, Azalia Mirhoseini, Cameron McKinnon, Carol Chen, Catherine Olsson, Christopher Olah, Danny Hernandez, Dawn Drain, Deep Ganguli, Dustin Li, Eli Tran-Johnson, Ethan Perez, Jamie Kerr, Jared Mueller, Jeffrey Ladish, Joshua Landau, Kamal Ndousse, Kamile Lukosuite, Liane Lovitt, Michael Sellitto, Nelson Elhage, Nicholas Schiefer, Noemi Mercado, Nova DasSarma, Robert Lasenby, Robin Larson, Sam Ringer, Scott Johnston, Shauna Kravec, Sheer El Showk, Stanislav Fort, Tamera Lanham, Timothy Telleen-Lawton, Tom Conerly, Tom Henighan, Tristan Hume, Samuel R. Bowman, Zac Hatfield-Dodds, Ben Mann, Dario Amodei, Nicholas Joseph, Sam McCandlish, Tom Brown, and Jared Kaplan. 2022. Constitutional AI: Harmlessness from AI Feedback.   
[16] Marco Bellagente, Jonathan Tow, Dakota Mahan, Duy Phung, Maksym Zhuravinskyi, Reshinth Adithyan, James Baicoianu, Ben Brooks, Nathan Cooper, Ashish Datta, Meng Lee, Emad Mostaque, Michael Pieler, Nikhil Pinnaparju, Paulo Rocha, Harry Saini, Hannah Teufel, Niccolo Zanichelli, and Carlos Riquelme. 2024. Stable LM 2 1.6B Technical Report.   
[17] Emmanuel Bengio, Pierre-Luc Bacon, Joelle Pineau, and Doina Precup. 2016. Conditional Computation in Neural Networks for faster models.   
[18] Stella Biderman, Hailey Schoelkopf, Quentin Anthony, Herbie Bradley, Kyle O’Brien, Eric Hallahan, Mohammad Aflah Khan, Shivanshu Purohit, USVSN Sai Prashanth, Edward Raff, Aviya Skowron, Lintang Sutawika, and Oskar van der Wal. 2023. Pythia: A Suite for Analyzing Large Language Models Across Training and Scaling.

[19] Stella Biderman, Hailey Schoelkopf, Lintang Sutawika, Leo Gao, Jonathan Tow, Baber Abbasi, Alham Fikri Aji, Pawan Sasanka Ammanamanchi, Sidney Black, Jordan Clive, Anthony DiPofi, Julen Etxaniz, Benjamin Fattori, Jessica Zosa Forde, Charles Foster, Jeffrey Hsu, Mimansa Jaiswal, Wilson Y. Lee, Haonan Li, Charles Lovering, Niklas Muennighoff, Ellie Pavlick, Jason Phang, Aviya Skowron, Samson Tan, Xiangru Tang, Kevin A. Wang, Genta Indra Winata, Franc¸ois Yvon, and Andy Zou. 2024. Lessons from the Trenches on Reproducible Evaluation of Language Models.   
[20] Yonatan Bisk, Rowan Zellers, Ronan Le Bras, Jianfeng Gao, and Yejin Choi. 2019. PIQA: Reasoning about Physical Commonsense in Natural Language.   
[21] Sid Black, Stella Biderman, Eric Hallahan, Quentin Anthony, Leo Gao, Laurence Golding, Horace He, Connor Leahy, Kyle McDonell, Jason Phang, Michael Pieler, USVSN Sai Prashanth, Shivanshu Purohit, Laria Reynolds, Jonathan Tow, Ben Wang, and Samuel Weinbach. 2022. GPT-NeoX-20B: An Open-Source Autoregressive Language Model.   
[22] Sid Black, Leo Gao, Phil Wang, Connor Leahy, and Stella Biderman. 2021. GPT-Neo: Large Scale Autoregressive Language Modeling with Mesh-Tensorflow.   
[23] Rishi Bommasani, Kevin Klyman, Shayne Longpre, Sayash Kapoor, Nestor Maslej, Betty Xiong, Daniel Zhang, and Percy Liang. 2023. The Foundation Model Transparency Index.   
[24] Tom B. Brown, Benjamin Mann, Nick Ryder, Melanie Subbiah, Jared Kaplan, Prafulla Dhariwal, Arvind Neelakantan, Pranav Shyam, Girish Sastry, Amanda Askell, et al. 2020. Language Models are Few-Shot Learners.   
[25] Tianle Cai. 2023. Mixtral from Mistral.   
[26] Zheng Cai, Maosong Cao, Haojiong Chen, Kai Chen, Keyu Chen, Xin Chen, Xun Chen, Zehui Chen, Zhi Chen, Pei Chu, Xiaoyi Dong, Haodong Duan, Qi Fan, Zhaoye Fei, Yang Gao, Jiaye Ge, Chenya Gu, Yuzhe Gu, Tao Gui, Aijia Guo, Qipeng Guo, Conghui He, Yingfan Hu, Ting Huang, Tao Jiang, Penglong Jiao, Zhenjiang Jin, Zhikai Lei, Jiaxing Li, Jingwen Li, Linyang Li, Shuaibin Li, Wei Li, Yining Li, Hongwei Liu, Jiangning Liu, Jiawei Hong, Kaiwen Liu, Kuikun Liu, Xiaoran Liu, Chengqi Lv, Haijun Lv, Kai Lv, Li Ma, Runyuan Ma, Zerun Ma, Wenchang Ning, Linke Ouyang, Jiantao Qiu, Yuan Qu, Fukai Shang, Yunfan Shao, Demin Song, Zifan Song, Zhihao Sui, Peng Sun, Yu Sun, Huanze Tang, Bin Wang, Guoteng Wang, Jiaqi Wang, Jiayu Wang, Rui Wang, Yudong Wang, Ziyi Wang, Xingjian Wei, Qizhen Weng, Fan Wu, Yingtong Xiong, Chao Xu, Ruiliang Xu, Hang Yan, Yirong Yan, Xiaogui Yang, Haochen Ye, Huaiyuan Ying, Jia Yu, Jing Yu, Yuhang Zang, Chuyu Zhang, Li Zhang, Pan Zhang, Peng Zhang, Ruijie Zhang, Shuo Zhang, Songyang Zhang, Wenjian Zhang, Wenwei Zhang, Xingcheng Zhang, Xinyue Zhang, Hui Zhao, Qian Zhao, Xiaomeng Zhao, Fengzhe Zhou, Zaida Zhou, Jingming Zhuo, Yicheng Zou, Xipeng Qiu, Yu Qiao, and Dahua Lin. 2024. InternLM2 Technical Report.   
[27] Mark Chen, Alec Radford, Rewon Child, Jeffrey Wu, Heewoo Jun, David Luan, and Ilya Sutskever. 2020. Generative pretraining from pixels.   
[28] Mark Chen, Jerry Tworek, Heewoo Jun, Qiming Yuan, Henrique Ponde de Oliveira Pinto, Jared Kaplan, Harri Edwards, Yuri Burda, Nicholas Joseph, Greg Brockman, Alex Ray, Raul Puri, Gretchen Krueger, Michael Petrov, Heidy Khlaaf, Girish Sastry, Pamela Mishkin, Brooke Chan, Scott Gray, Nick Ryder, Mikhail Pavlov, Alethea Power, Lukasz Kaiser, Mohammad Bavarian, Clemens Winter, Philippe Tillet, Felipe Petroski Such, Dave Cummings, Matthias Plappert, Fotios Chantzis, Elizabeth Barnes, Ariel Herbert-Voss, William Hebgen Guss, Alex Nichol, Alex Paino, Nikolas Tezak, Jie Tang, Igor Babuschkin, Suchir Balaji, Shantanu Jain, William Saunders, Christopher Hesse, Andrew N. Carr, Jan Leike, Josh Achiam, Vedant Misra, Evan Morikawa, Alec Radford, Matthew Knight, Miles Brundage, Mira Murati, Katie Mayer, Peter Welinder, Bob McGrew, Dario Amodei, Sam McCandlish, Ilya Sutskever, and Wojciech Zaremba. 2021. Evaluating Large Language Models Trained on Code.   
[29] Soumith Chintala. 2024. GPT-4 MoE.

[30] Aakanksha Chowdhery, Sharan Narang, Jacob Devlin, Maarten Bosma, Gaurav Mishra, Adam Roberts, Paul Barham, Hyung Won Chung, Charles Sutton, Sebastian Gehrmann, et al. 2022. PaLM: Scaling Language Modeling with Pathways.   
[31] Paul Christiano, Jan Leike, Tom B. Brown, Miljan Martic, Shane Legg, and Dario Amodei. 2023. Deep reinforcement learning from human preferences.   
[32] Aidan Clark, Diego de las Casas, Aurelia Guy, Arthur Mensch, Michela Paganini, Jordan Hoffmann, Bogdan Damoc, Blake Hechtman, Trevor Cai, Sebastian Borgeaud, George van den Driessche, Eliza Rutherford, Tom Hennigan, Matthew Johnson, Katie Millican, Albin Cassirer, Chris Jones, Elena Buchatskaya, David Budden, Laurent Sifre, Simon Osindero, Oriol Vinyals, Jack Rae, Erich Elsen, Koray Kavukcuoglu, and Karen Simonyan. 2022. Unified Scaling Laws for Routed Language Models.   
[33] Christopher Clark, Kenton Lee, Ming-Wei Chang, Tom Kwiatkowski, Michael Collins, and Kristina Toutanova. 2019. BoolQ: Exploring the Surprising Difficulty of Natural Yes/No Questions.   
[34] Peter Clark, Isaac Cowhey, Oren Etzioni, Tushar Khot, Ashish Sabharwal, Carissa Schoenick, and Oyvind Tafjord. 2018. Think you have Solved Question Answering? Try ARC, the AI2 Reasoning Challenge.   
[35] Karl Cobbe, Vineet Kosaraju, Mohammad Bavarian, Mark Chen, Heewoo Jun, Lukasz Kaiser, Matthias Plappert, Jerry Tworek, Jacob Hilton, Reiichiro Nakano, Christopher Hesse, and John Schulman. 2021. Training Verifiers to Solve Math Word Problems.   
[36] Together Computer. 2023. RedPajama: An Open Source Recipe to Reproduce LLaMA training dataset.   
[37] Robert Csord´ as, Kazuki Irie, J´ urgen Schmidhuber, Christopher Potts, and Christopher D.¨ Manning. 2024. MoEUT: Mixture-of-Experts Universal Transformers.   
[38] Ganqu Cui, Lifan Yuan, Ning Ding, Guanming Yao, Wei Zhu, Yuan Ni, Guotong Xie, Zhiyuan Liu, and Maosong Sun. 2023. UltraFeedback: Boosting Language Models with High-quality Feedback.   
[39] Damai Dai, Chengqi Deng, Chenggang Zhao, R. X. Xu, Huazuo Gao, Deli Chen, Jiashi Li, Wangding Zeng, Xingkai Yu, Y. Wu, Zhenda Xie, Y. K. Li, Panpan Huang, Fuli Luo, Chong Ruan, Zhifang Sui, and Wenfeng Liang. 2024. DeepSeekMoE: Towards Ultimate Expert Specialization in Mixture-of-Experts Language Models.   
[40] Databricks. 2024. DBRX.   
[41] Yann N. Dauphin, Angela Fan, Michael Auli, and David Grangier. 2017. Language Modeling with Gated Convolutional Networks.   
[42] DeepSeek-AI, :, Xiao Bi, Deli Chen, Guanting Chen, Shanhuang Chen, Damai Dai, Chengqi Deng, Honghui Ding, Kai Dong, Qiushi Du, Zhe Fu, Huazuo Gao, Kaige Gao, Wenjun Gao, Ruiqi Ge, Kang Guan, Daya Guo, Jianzhong Guo, Guangbo Hao, Zhewen Hao, Ying He, Wenjie Hu, Panpan Huang, Erhang Li, Guowei Li, Jiashi Li, Yao Li, Y. K. Li, Wenfeng Liang, Fangyun Lin, A. X. Liu, Bo Liu, Wen Liu, Xiaodong Liu, Xin Liu, Yiyuan Liu, Haoyu Lu, Shanghao Lu, Fuli Luo, Shirong Ma, Xiaotao Nie, Tian Pei, Yishi Piao, Junjie Qiu, Hui Qu, Tongzheng Ren, Zehui Ren, Chong Ruan, Zhangli Sha, Zhihong Shao, Junxiao Song, Xuecheng Su, Jingxiang Sun, Yaofeng Sun, Minghui Tang, Bingxuan Wang, Peiyi Wang, Shiyu Wang, Yaohui Wang, Yongji Wang, Tong Wu, Y. Wu, Xin Xie, Zhenda Xie, Ziwei Xie, Yiliang Xiong, Hanwei Xu, R. X. Xu, Yanhong Xu, Dejian Yang, Yuxiang You, Shuiping Yu, Xingkai Yu, B. Zhang, Haowei Zhang, Lecong Zhang, Liyue Zhang, Mingchuan Zhang, Minghua Zhang, Wentao Zhang, Yichao Zhang, Chenggang Zhao, Yao Zhao, Shangyan Zhou, Shunfeng Zhou, Qihao Zhu, and Yuheng Zou. 2024. DeepSeek LLM: Scaling Open-Source Language Models with Longtermism.

[43] DeepSeek-AI, Aixin Liu, Bei Feng, Bin Wang, Bingxuan Wang, Bo Liu, Chenggang Zhao, Chengqi Dengr, Chong Ruan, Damai Dai, Daya Guo, Dejian Yang, Deli Chen, Dongjie Ji, Erhang Li, Fangyun Lin, Fuli Luo, Guangbo Hao, Guanting Chen, Guowei Li, H. Zhang, Hanwei Xu, Hao Yang, Haowei Zhang, Honghui Ding, Huajian Xin, Huazuo Gao, Hui Li, Hui Qu, J. L. Cai, Jian Liang, Jianzhong Guo, Jiaqi Ni, Jiashi Li, Jin Chen, Jingyang Yuan, Junjie Qiu, Junxiao Song, Kai Dong, Kaige Gao, Kang Guan, Lean Wang, Lecong Zhang, Lei Xu, Leyi Xia, Liang Zhao, Liyue Zhang, Meng Li, Miaojun Wang, Mingchuan Zhang, Minghua Zhang, Minghui Tang, Mingming Li, Ning Tian, Panpan Huang, Peiyi Wang, Peng Zhang, Qihao Zhu, Qinyu Chen, Qiushi Du, R. J. Chen, R. L. Jin, Ruiqi Ge, Ruizhe Pan, Runxin Xu, Ruyi Chen, S. S. Li, Shanghao Lu, Shangyan Zhou, Shanhuang Chen, Shaoqing Wu, Shengfeng Ye, Shirong Ma, Shiyu Wang, Shuang Zhou, Shuiping Yu, Shunfeng Zhou, Size Zheng, T. Wang, Tian Pei, Tian Yuan, Tianyu Sun, W. L. Xiao, Wangding Zeng, Wei An, Wen Liu, Wenfeng Liang, Wenjun Gao, Wentao Zhang, X. Q. Li, Xiangyue Jin, Xianzu Wang, Xiao Bi, Xiaodong Liu, Xiaohan Wang, Xiaojin Shen, Xiaokang Chen, Xiaosha Chen, Xiaotao Nie, Xiaowen Sun, Xiaoxiang Wang, Xin Liu, Xin Xie, Xingkai Yu, Xinnan Song, Xinyi Zhou, Xinyu Yang, Xuan Lu, Xuecheng Su, Y. Wu, Y. K. Li, Y. X. Wei, Y. X. Zhu, Yanhong Xu, Yanping Huang, Yao Li, Yao Zhao, Yaofeng Sun, Yaohui Li, Yaohui Wang, Yi Zheng, Yichao Zhang, Yiliang Xiong, Yilong Zhao, Ying He, Ying Tang, Yishi Piao, Yixin Dong, Yixuan Tan, Yiyuan Liu, Yongji Wang, Yongqiang Guo, Yuchen Zhu, Yuduan Wang, Yuheng Zou, Yukun Zha, Yunxian Ma, Yuting Yan, Yuxiang You, Yuxuan Liu, Z. Z. Ren, Zehui Ren, Zhangli Sha, Zhe Fu, Zhen Huang, Zhen Zhang, Zhenda Xie, Zhewen Hao, Zhihong Shao, Zhiniu Wen, Zhipeng Xu, Zhongyu Zhang, Zhuoshu Li, Zihan Wang, Zihui Gu, Zilin Li, and Ziwei Xie. 2024. DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model.   
[44] Mostafa Dehghani, Josip Djolonga, Basil Mustafa, Piotr Padlewski, Jonathan Heek, Justin Gilmer, Andreas Steiner, Mathilde Caron, Robert Geirhos, Ibrahim Alabdulmohsin, Rodolphe Jenatton, Lucas Beyer, Michael Tschannen, Anurag Arnab, Xiao Wang, Carlos Riquelme, Matthias Minderer, Joan Puigcerver, Utku Evci, Manoj Kumar, Sjoerd van Steenkiste, Gamaleldin F. Elsayed, Aravindh Mahendran, Fisher Yu, Avital Oliver, Fantine Huot, Jasmijn Bastings, Mark Patrick Collier, Alexey Gritsenko, Vighnesh Birodkar, Cristina Vasconcelos, Yi Tay, Thomas Mensink, Alexander Kolesnikov, Filip Pavetic, Dustin Tran,´ Thomas Kipf, Mario Luciˇ c, Xiaohua Zhai, Daniel Keysers, Jeremiah Harmsen, and Neil´ Houlsby. 2023. Scaling Vision Transformers to 22 Billion Parameters.   
[45] Mostafa Dehghani, Stephan Gouws, Oriol Vinyals, Jakob Uszkoreit, and Łukasz Kaiser. 2019. Universal Transformers.   
[46] Nolan Dey, Gurpreet Gosal, Zhiming, Chen, Hemant Khachane, William Marshall, Ribhu Pathria, Marvin Tom, and Joel Hestness. 2023. Cerebras-GPT: Open Compute-Optimal Language Models Trained on the Cerebras Wafer-Scale Cluster.   
[47] Danny Driess, Fei Xia, Mehdi S. M. Sajjadi, Corey Lynch, Aakanksha Chowdhery, Brian Ichter, Ayzaan Wahid, Jonathan Tompson, Quan Vuong, Tianhe Yu, Wenlong Huang, Yevgen Chebotar, Pierre Sermanet, Daniel Duckworth, Sergey Levine, Vincent Vanhoucke, Karol Hausman, Marc Toussaint, Klaus Greff, Andy Zeng, Igor Mordatch, and Pete Florence. 2023. PaLM-E: An Embodied Multimodal Language Model.   
[48] Nan Du, Yanping Huang, Andrew M. Dai, Simon Tong, Dmitry Lepikhin, Yuanzhong Xu, Maxim Krikun, Yanqi Zhou, Adams Wei Yu, Orhan Firat, Barret Zoph, Liam Fedus, Maarten Bosma, Zongwei Zhou, Tao Wang, Yu Emma Wang, Kellie Webster, Marie Pellat, Kevin Robinson, Kathleen Meier-Hellstern, Toju Duke, Lucas Dixon, Kun Zhang, Quoc V Le, Yonghui Wu, Zhifeng Chen, and Claire Cui. 2022. GLaM: Efficient Scaling of Language Models with Mixture-of-Experts.   
[49] Dheeru Dua, Shruti Bhosale, Vedanuj Goswami, James Cross, Mike Lewis, and Angela Fan. 2021. Tricks for Training Sparse Translation Models.   
[50] Abhimanyu Dubey, Abhinav Jauhri, Abhinav Pandey, Abhishek Kadian, Ahmad Al-Dahle, Aiesha Letman, Akhil Mathur, Alan Schelten, Amy Yang, Angela Fan, Anirudh Goyal, Anthony Hartshorn, Aobo Yang, Archi Mitra, Archie Sravankumar, Artem Korenev, Arthur

Hinsvark, Arun Rao, Aston Zhang, Aurelien Rodriguez, Austen Gregerson, et al. 2024. The Llama 3 Herd of Models.   
[51] Yann Dubois, Balazs Galambosi, Percy Liang, and Tatsunori B. Hashimoto. 2024.´ Length-Controlled AlpacaEval: A Simple Way to Debias Automatic Evaluators.   
[52] David Eigen, Marc’Aurelio Ranzato, and Ilya Sutskever. 2014. Learning Factored Representations in a Deep Mixture of Experts.   
[53] Kenneth Enevoldsen, Marton Kardos, Niklas Muennighoff, and Kristoffer Laigaard Nielbo.´ 2024. The Scandinavian Embedding Benchmarks: Comprehensive Assessment of Multilingual and Monolingual Text Embedding.   
[54] Kawin Ethayarajh, Winnie Xu, Niklas Muennighoff, Dan Jurafsky, and Douwe Kiela. 2024. KTO: Model Alignment as Prospect Theoretic Optimization.   
[55] Manuel Faysse, Patrick Fernandes, Nuno M. Guerreiro, Antonio Loison, Duarte M. Alves,´ Caio Corro, Nicolas Boizard, Joao Alves, Ricardo Rei, Pedro H. Martins, Antoni Bigata˜ Casademunt, Franc¸ois Yvon, Andre F. T. Martins, Gautier Viaud, C´ eline Hudelot, and Pierre´ Colombo. 2024. CroissantLLM: A Truly Bilingual French-English Language Model.   
[56] William Fedus, Barret Zoph, and Noam Shazeer. 2022. Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity.   
[57] Samir Yitzhak Gadre, Georgios Smyrnis, Vaishaal Shankar, Suchin Gururangan, Mitchell Wortsman, Rulin Shao, Jean Mercat, Alex Fang, Jeffrey Li, Sedrick Keh, Rui Xin, Marianna Nezhurina, Igor Vasiljevic, Jenia Jitsev, Luca Soldaini, Alexandros G. Dimakis, Gabriel Ilharco, Pang Wei Koh, Shuran Song, Thomas Kollar, Yair Carmon, Achal Dave, Reinhard Heckel, Niklas Muennighoff, and Ludwig Schmidt. 2024. Language models scale reliably with over-training and on downstream tasks.   
[58] Trevor Gale, Deepak Narayanan, Cliff Young, and Matei Zaharia. 2022. MegaBlocks: Efficient Sparse Training with Mixture-of-Experts.   
[59] Leo Gao, Stella Biderman, Sid Black, Laurence Golding, Travis Hoppe, Charles Foster, Jason Phang, Horace He, Anish Thite, Noa Nabeshima, Shawn Presser, and Connor Leahy. 2020. The Pile: An 800GB Dataset of Diverse Text for Language Modeling.   
[60] Leo Gao, Jonathan Tow, Stella Biderman, Sid Black, Anthony DiPofi, Charles Foster, Laurence Golding, Jeffrey Hsu, Kyle McDonell, Niklas Muennighoff, Jason Phang, Laria Reynolds, Eric Tang, Anish Thite, Ben Wang, Kevin Wang, and Andy Zou. 2021. A framework for few-shot language model evaluation.   
[61] Team GLM, Aohan Zeng, Bin Xu, Bowen Wang, Chenhui Zhang, Da Yin, Diego Rojas, Guanyu Feng, Hanlin Zhao, Hanyu Lai, Hao Yu, Hongning Wang, Jiadai Sun, Jiajie Zhang, Jiale Cheng, Jiayi Gui, Jie Tang, Jing Zhang, Juanzi Li, Lei Zhao, Lindong Wu, Lucen Zhong, Mingdao Liu, Minlie Huang, Peng Zhang, Qinkai Zheng, Rui Lu, Shuaiqi Duan, Shudan Zhang, Shulin Cao, Shuxun Yang, Weng Lam Tam, Wenyi Zhao, Xiao Liu, Xiao Xia, Xiaohan Zhang, Xiaotao Gu, Xin Lv, Xinghan Liu, Xinyi Liu, Xinyue Yang, Xixuan Song, Xunkai Zhang, Yifan An, Yifan Xu, Yilin Niu, Yuantao Yang, Yueyan Li, Yushi Bai, Yuxiao Dong, Zehan Qi, Zhaoyu Wang, Zhen Yang, Zhengxiao Du, Zhenyu Hou, and Zihan Wang. 2024. ChatGLM: A Family of Large Language Models from GLM-130B to GLM-4 All Tools.   
[62] Paolo Glorioso, Quentin Anthony, Yury Tokpanov, James Whittington, Jonathan Pilault, Adam Ibrahim, and Beren Millidge. 2024. Zamba: A Compact 7B SSM Hybrid Model.   
[63] Andrew Gordon, Zornitsa Kozareva, and Melissa Roemmele. 2012. SemEval-2012 Task 7: Choice of Plausible Alternatives: An Evaluation of Commonsense Causal Reasoning.   
[64] Dirk Groeneveld, Anas Awadalla, Iz Beltagy, Akshita Bhagia, Ian Magnusson, Hao Peng, Oyvind Tafjord, Pete Walsh, Kyle Richardson, and Jesse Dodge. 2023. Catwalk: A Unified Language Model Evaluation Framework for Many Datasets.

[65] Dirk Groeneveld, Iz Beltagy, Pete Walsh, Akshita Bhagia, Rodney Kinney, Oyvind Tafjord, Ananya Harsh Jha, Hamish Ivison, Ian Magnusson, Yizhong Wang, Shane Arora, David Atkinson, Russell Authur, Khyathi Raghavi Chandu, Arman Cohan, Jennifer Dumas, Yanai Elazar, Yuling Gu, Jack Hessel, Tushar Khot, William Merrill, Jacob Morrison, Niklas Muennighoff, Aakanksha Naik, Crystal Nam, Matthew E. Peters, Valentina Pyatkin, Abhilasha Ravichander, Dustin Schwenk, Saurabh Shah, Will Smith, Emma Strubell, Nishant Subramani, Mitchell Wortsman, Pradeep Dasigi, Nathan Lambert, Kyle Richardson, Luke Zettlemoyer, Jesse Dodge, Kyle Lo, Luca Soldaini, Noah A. Smith, and Hannaneh Hajishirzi. 2024. OLMo: Accelerating the Science of Language Models.   
[66] Sam Gross, Marc’Aurelio Ranzato, and Arthur Szlam. 2017. Hard Mixtures of Experts for Large Scale Weakly Supervised Vision.   
[67] Yuling Gu, Oyvind Tafjord, Bailey Kuehl, Dany Haddad, Jesse Dodge, and Hannaneh Hajishirzi. 2024. OLMES: A Standard for Language Model Evaluations.   
[68] Suriya Gunasekar, Yi Zhang, Jyoti Aneja, Caio Cesar Teodoro Mendes, Allie Del Giorno,´ Sivakanth Gopi, Mojan Javaheripi, Piero Kauffmann, Gustavo de Rosa, Olli Saarikivi, Adil Salim, Shital Shah, Harkirat Singh Behl, Xin Wang, Sebastien Bubeck, Ronen Eldan, ´ Adam Tauman Kalai, Yin Tat Lee, and Yuanzhi Li. 2023. Textbooks Are All You Need.   
[69] Xu Owen He. 2024. Mixture of A Million Experts.   
[70] Dan Hendrycks, Collin Burns, Steven Basart, Andy Zou, Mantas Mazeika, Dawn Song, and Jacob Steinhardt. 2021. Measuring Massive Multitask Language Understanding.   
[71] Dan Hendrycks, Collin Burns, Saurav Kadavath, Akul Arora, Steven Basart, Eric Tang, Dawn Song, and Jacob Steinhardt. 2021. Measuring Mathematical Problem Solving With the MATH Dataset.   
[72] Jordan Hoffmann, Sebastian Borgeaud, Arthur Mensch, Elena Buchatskaya, Trevor Cai, Eliza Rutherford, Diego de Las Casas, Lisa Anne Hendricks, Johannes Welbl, Aidan Clark, Tom Hennigan, Eric Noland, Katie Millican, George van den Driessche, Bogdan Damoc, Aurelia Guy, Simon Osindero, Karen Simonyan, Erich Elsen, Jack W. Rae, Oriol Vinyals, and Laurent Sifre. 2022. Training Compute-Optimal Large Language Models.   
[73] Jiwoo Hong, Noah Lee, and James Thorne. 2024. ORPO: Monolithic Preference Optimization without Reference Model.   
[74] Shengding Hu, Yuge Tu, Xu Han, Chaoqun He, Ganqu Cui, Xiang Long, Zhi Zheng, Yewei Fang, Yuxiang Huang, Weilin Zhao, Xinrong Zhang, Zheng Leng Thai, Kaihuo Zhang, Chongyi Wang, Yuan Yao, Chenyang Zhao, Jie Zhou, Jie Cai, Zhongwu Zhai, Ning Ding, Chao Jia, Guoyang Zeng, Dahai Li, Zhiyuan Liu, and Maosong Sun. 2024. MiniCPM: Unveiling the Potential of Small Language Models with Scalable Training Strategies.   
[75] Cheng-Zhi Anna Huang, Ashish Vaswani, Jakob Uszkoreit, Noam Shazeer, Ian Simon, Curtis Hawthorne, Andrew M. Dai, Matthew D. Hoffman, Monica Dinculescu, and Douglas Eck. 2018. Music Transformer.   
[76] Hamish Ivison, Yizhong Wang, Valentina Pyatkin, Nathan Lambert, Matthew Peters, Pradeep Dasigi, Joel Jang, David Wadden, Noah A. Smith, Iz Beltagy, and Hannaneh Hajishirzi. 2023. Camels in a Changing Climate: Enhancing LM Adaptation with Tulu 2.   
[77] Sebastian Jaszczur, Aakanksha Chowdhery, Afroz Mohiuddin, Łukasz Kaiser, Wojciech Gajewski, Henryk Michalewski, and Jonni Kanerva. 2021. Sparse is Enough in Scaling Transformers.   
[78] Albert Q. Jiang, Alexandre Sablayrolles, Arthur Mensch, Chris Bamford, Devendra Singh Chaplot, Diego de las Casas, Florian Bressand, Gianna Lengyel, Guillaume Lample, Lucile Saulnier, Lelio Renard Lavaud, Marie-Anne Lachaux, Pierre Stock, Teven Le Scao, Thibaut´ Lavril, Thomas Wang, Timothee Lacroix, and William El Sayed. 2023. ´ Mistral 7B.

[79] Albert Q. Jiang, Alexandre Sablayrolles, Antoine Roux, Arthur Mensch, Blanche Savary, Chris Bamford, Devendra Singh Chaplot, Diego de las Casas, Emma Bou Hanna, Florian Bressand, Gianna Lengyel, Guillaume Bour, Guillaume Lample, Lelio Renard Lavaud, Lu-´ cile Saulnier, Marie-Anne Lachaux, Pierre Stock, Sandeep Subramanian, Sophia Yang, Szymon Antoniak, Teven Le Scao, Theophile Gervet, Thibaut Lavril, Thomas Wang, Timoth´ ee´ Lacroix, and William El Sayed. 2024. Mixtral of Experts.   
[80] Jared Kaplan, Sam McCandlish, Tom Henighan, Tom B. Brown, Benjamin Chess, Rewon Child, Scott Gray, Alec Radford, Jeffrey Wu, and Dario Amodei. 2020. Scaling Laws for Neural Language Models.   
[81] Andrej Karpathy. 2024. LLM model size competition is intensifying. . . backwards!   
[82] Douwe Kiela, Hamed Firooz, Aravind Mohan, Vedanuj Goswami, Amanpreet Singh, Casey A Fitzpatrick, Peter Bull, Greg Lipstein, Tony Nelli, Ron Zhu, et al. 2021. The hateful memes challenge: Competition report.   
[83] Diederik P. Kingma and Jimmy Ba. 2017. Adam: A Method for Stochastic Optimization.   
[84] Denis Kocetkov, Raymond Li, Loubna Ben Allal, Jia Li, Chenghao Mou, Carlos Munoz Fer-˜ randis, Yacine Jernite, Margaret Mitchell, Sean Hughes, Thomas Wolf, Dzmitry Bahdanau, Leandro von Werra, and Harm de Vries. 2022. The Stack: 3 TB of permissively licensed source code.   
[85] Aran Komatsuzaki, Joan Puigcerver, James Lee-Thorp, Carlos Riquelme Ruiz, Basil Mustafa, Joshua Ainslie, Yi Tay, Mostafa Dehghani, and Neil Houlsby. 2023. Sparse Upcycling: Train ing Mixture-of-Experts from Dense Checkpoints.   
[86] Jakub Krajewski, Jan Ludziejewski, Kamil Adamczewski, Maciej Pioro, Michał Krutul, Szy-´ mon Antoniak, Kamil Ciebiera, Krystian Krol, Tomasz Odrzyg´ o´zd´ z, Piotr Sankowski, Marek´ Cygan, and Sebastian Jaszczur. 2024. Scaling Laws for Fine-Grained Mixture of Experts.   
[87] Nathan Lambert, Jacob Morrison, Valentina Pyatkin, Shengyi Huang, Hamish Ivison, Faeze Brahman, Lester James V. Miranda, Alisa Liu, Nouha Dziri, Shane Lyu, Yuling Gu, Saumya Malik, Victoria Graf, Jena D. Hwang, Jiangjiang Yang, Ronan Le Bras, Oyvind Tafjord, Chris Wilhelm, Luca Soldaini, Noah A. Smith, Yizhong Wang, Pradeep Dasigi, and Hannaneh Hajishirzi. 2025. Tulu 3: Pushing Frontiers in Open Language Model Post-Training.   
[88] Dmitry Lepikhin, HyoukJoong Lee, Yuanzhong Xu, Dehao Chen, Orhan Firat, Yanping Huang, Maxim Krikun, Noam Shazeer, and Zhifeng Chen. 2020. GShard: Scaling Giant Models with Conditional Computation and Automatic Sharding.   
[89] Mike Lewis, Shruti Bhosale, Tim Dettmers, Naman Goyal, and Luke Zettlemoyer. 2021. BASE Layers: Simplifying Training of Large, Sparse Models.   
[90] Jeffrey Li, Alex Fang, Georgios Smyrnis, Maor Ivgi, Matt Jordan, Samir Gadre, Hritik Bansal, Etash Guha, Sedrick Keh, Kushal Arora, Saurabh Garg, Rui Xin, Niklas Muennighoff, Reinhard Heckel, Jean Mercat, Mayee Chen, Suchin Gururangan, Mitchell Wortsman, Alon Albalak, Yonatan Bitton, Marianna Nezhurina, Amro Abbas, Cheng-Yu Hsieh, Dhruba Ghosh, Josh Gardner, Maciej Kilian, Hanlin Zhang, Rulin Shao, Sarah Pratt, Sunny Sanyal, Gabriel Ilharco, Giannis Daras, Kalyani Marathe, Aaron Gokaslan, Jieyu Zhang, Khyathi Chandu, Thao Nguyen, Igor Vasiljevic, Sham Kakade, Shuran Song, Sujay Sanghavi, Fartash Faghri, Sewoong Oh, Luke Zettlemoyer, Kyle Lo, Alaaeldin El-Nouby, Hadi Pouransari, Alexander Toshev, Stephanie Wang, Dirk Groeneveld, Luca Soldaini, Pang Wei Koh, Jenia Jitsev, Thomas Kollar, Alexandros G. Dimakis, Yair Carmon, Achal Dave, Ludwig Schmidt, and Vaishaal Shankar. 2024. DataComp-LM: In search of the next generation of training sets for language models.   
[91] Margaret Li, Suchin Gururangan, Tim Dettmers, Mike Lewis, Tim Althoff, Noah A. Smith, and Luke Zettlemoyer. 2022. Branch-Train-Merge: Embarrassingly Parallel Training of Expert Language Models.

[92] Raymond Li, Loubna Ben Allal, Yangtian Zi, Niklas Muennighoff, Denis Kocetkov, Chenghao Mou, Marc Marone, Christopher Akiki, Jia Li, Jenny Chim, et al. 2023. StarCoder: may the source be with you!   
[93] Xuechen Li, Tianyi Zhang, Yann Dubois, Rohan Taori, Ishaan Gulrajani, Carlos Guestrin, Percy Liang, and Tatsunori B. Hashimoto. 2023. AlpacaEval: An Automatic Evaluator of Instruction-following Models.   
[94] Yuanzhi Li, Sebastien Bubeck, Ronen Eldan, Allie Del Giorno, Suriya Gunasekar, and Yin Tat´ Lee. 2023. Textbooks Are All You Need II: phi-1.5 technical report.   
[95] Yunxin Li, Shenyuan Jiang, Baotian Hu, Longyue Wang, Wanqi Zhong, Wenhan Luo, Lin Ma, and Min Zhang. 2024. Uni-MoE: Scaling Unified Multimodal LLMs with Mixture of Experts.   
[96] Percy Liang, Rishi Bommasani, Tony Lee, Dimitris Tsipras, Dilara Soylu, Michihiro Yasunaga, Yian Zhang, Deepak Narayanan, Yuhuai Wu, Ananya Kumar, Benjamin Newman, Binhang Yuan, Bobby Yan, Ce Zhang, Christian Cosgrove, Christopher D. Manning, Christopher Re, Diana Acosta-Navas, Drew A. Hudson, Eric Zelikman, Esin Durmus, Faisal Lad-´ hak, Frieda Rong, Hongyu Ren, Huaxiu Yao, Jue Wang, Keshav Santhanam, Laurel Orr, Lucia Zheng, Mert Yuksekgonul, Mirac Suzgun, Nathan Kim, Neel Guha, Niladri Chatterji, Omar Khattab, Peter Henderson, Qian Huang, Ryan Chi, Sang Michael Xie, Shibani Santurkar, Surya Ganguli, Tatsunori Hashimoto, Thomas Icard, Tianyi Zhang, Vishrav Chaudhary, William Wang, Xuechen Li, Yifan Mai, Yuhui Zhang, and Yuta Koreeda. 2023. Holistic Evaluation of Language Models.   
[97] Opher Lieber, Barak Lenz, Hofit Bata, Gal Cohen, Jhonathan Osin, Itay Dalmedigos, Erez Safahi, Shaked Meirom, Yonatan Belinkov, Shai Shalev-Shwartz, Omri Abend, Raz Alon, Tomer Asida, Amir Bergman, Roman Glozman, Michael Gokhman, Avashalom Manevich, Nir Ratner, Noam Rozen, Erez Shwartz, Mor Zusman, and Yoav Shoham. 2024. Jamba: A Hybrid Transformer-Mamba Language Model.   
[98] Bin Lin, Zhenyu Tang, Yang Ye, Jiaxi Cui, Bin Zhu, Peng Jin, Jinfa Huang, Junwu Zhang, Yatian Pang, Munan Ning, and Li Yuan. 2024. MoE-LLaVA: Mixture of Experts for Large Vision-Language Models.   
[99] Stephanie Lin, Jacob Hilton, and Owain Evans. 2022. TruthfulQA: Measuring How Models Mimic Human Falsehoods.   
[100] Xi Victoria Lin, Akshat Shrivastava, Liang Luo, Srinivasan Iyer, Mike Lewis, Gargi Gosh, Luke Zettlemoyer, and Armen Aghajanyan. 2024. MoMa: Efficient Early-Fusion Pre-training with Mixture of Modality-Aware Experts.   
[101] Qian Liu, Xiaosen Zheng, Niklas Muennighoff, Guangtao Zeng, Longxu Dou, Tianyu Pang, Jing Jiang, and Min Lin. 2024. RegMix: Data Mixture as Regression for Language Model Pre-training.   
[102] Tianlin Liu, Mathieu Blondel, Carlos Riquelme, and Joan Puigcerver. 2024. Routers in Vision Mixture of Experts: An Empirical Study.   
[103] Zhengzhong Liu, Aurick Qiao, Willie Neiswanger, Hongyi Wang, Bowen Tan, Tianhua Tao, Junbo Li, Yuqi Wang, Suqi Sun, Omkar Pangarkar, Richard Fan, Yi Gu, Victor Miller, Yonghao Zhuang, Guowei He, Haonan Li, Fajri Koto, Liping Tang, Nikhil Ranjan, Zhiqiang Shen, Xuguang Ren, Roberto Iriondo, Cun Mu, Zhiting Hu, Mark Schulze, Preslav Nakov, Tim Baldwin, and Eric P. Xing. 2023. LLM360: Towards Fully Transparent Open-Source LLMs.   
[104] Shayne Longpre, Le Hou, Tu Vu, Albert Webson, Hyung Won Chung, Yi Tay, Denny Zhou, Quoc V. Le, Barret Zoph, Jason Wei, and Adam Roberts. 2023. The Flan Collection: Designing Data and Methods for Effective Instruction Tuning.   
[105] Shayne Longpre, Robert Mahari, Anthony Chen, Naana Obeng-Marnu, Damien Sileo, William Brannon, Niklas Muennighoff, Nathan Khazam, Jad Kabbara, Kartik Perisetla, Xinyi Wu, Enrico Shippole, Kurt Bollacker, Tongshuang Wu, Luis Villa, Sandy Pentland, and Sara

Hooker. 2023. The Data Provenance Initiative: A Large Scale Audit of Dataset Licensing & Attribution in AI.   
[106] Shayne Longpre, Robert Mahari, Ariel Lee, Campbell Lund, Hamidah Oderinwale, William Brannon, Nayan Saxena, Naana Obeng-Marnu, Tobin South, Cole Hunter, Kevin Klyman, Christopher Klamm, Hailey Schoelkopf, Nikhil Singh, Manuel Cherep, Ahmad Anis, An Dinh, Caroline Chitongo, Da Yin, Damien Sileo, Deividas Mataciunas, Diganta Misra, Emad Alghamdi, Enrico Shippole, Jianguo Zhang, Joanna Materzynska, Kun Qian, Kush Tiwary, Lester Miranda, Manan Dey, Minnie Liang, Mohammed Hamdy, Niklas Muennighoff, Seonghyeon Ye, Seungone Kim, Shrestha Mohanty, Vipul Gupta, Vivek Sharma, Vu Minh Chien, Xuhui Zhou, Yizhi Li, Caiming Xiong, Luis Villa, Stella Biderman, Hanlin Li, Daphne Ippolito, Sara Hooker, Jad Kabbara, and Sandy Pentland. 2024. Consent in Crisis: The Rapid Decline of the AI Data Commons.   
[107] Ilya Loshchilov and Frank Hutter. 2019. Decoupled Weight Decay Regularization.   
[108] Holy Lovenia, Rahmad Mahendra, Salsabil Maulana Akbar, Lester James V. Miranda, Jennifer Santoso, Elyanah Aco, Akhdan Fadhilah, Jonibek Mansurov, Joseph Marvin Imperial, Onno P. Kampman, Joel Ruben Antony Moniz, Muhammad Ravi Shulthan Habibi, Frederikus Hudi, Railey Montalan, Ryan Ignatius, Joanito Agili Lopo, William Nixon, Borje F. Karlsson, ¨ James Jaya, Ryandito Diandaru, Yuze Gao, Patrick Amadeus, Bin Wang, Jan Christian Blaise Cruz, Chenxi Whitehouse, Ivan Halim Parmonangan, Maria Khelli, Wenyu Zhang, Lucky Susanto, Reynard Adha Ryanda, Sonny Lazuardi Hermawan, Dan John Velasco, Muhammad Dehan Al Kautsar, Willy Fitra Hendria, Yasmin Moslem, Noah Flynn, Muhammad Farid Adilazuarda, Haochen Li, Johanes Lee, R. Damanhuri, Shuo Sun, Muhammad Reza Qorib, Amirbek Djanibekov, Wei Qi Leong, Quyet V. Do, Niklas Muennighoff, Tanrada Pansuwan, Ilham Firdausi Putra, Yan Xu, Ngee Chia Tai, Ayu Purwarianti, Sebastian Ruder, William Tjhi, Peerat Limkonchotiwat, Alham Fikri Aji, Sedrick Keh, Genta Indra Winata, Ruochen Zhang, Fajri Koto, Zheng-Xin Yong, and Samuel Cahyawijaya. 2024. SEACrowd: A Multilingual Multimodal Data Hub and Benchmark Suite for Southeast Asian Languages.   
[109] Anton Lozhkov, Raymond Li, Loubna Ben Allal, Federico Cassano, Joel Lamy-Poirier, Nouamane Tazi, Ao Tang, Dmytro Pykhtar, Jiawei Liu, Yuxiang Wei, Tianyang Liu, Max Tian, Denis Kocetkov, Arthur Zucker, Younes Belkada, Zijian Wang, Qian Liu, Dmitry Abulkhanov, Indraneil Paul, Zhuang Li, Wen-Ding Li, Megan Risdal, Jia Li, Jian Zhu, Terry Yue Zhuo, Evgenii Zheltonozhskii, Nii Osae Osae Dade, Wenhao Yu, Lucas Krauß, Naman Jain, Yixuan Su, Xuanli He, Manan Dey, Edoardo Abati, Yekun Chai, Niklas Muennighoff, Xiangru Tang, Muhtasham Oblokulov, Christopher Akiki, Marc Marone, Chenghao Mou, Mayank Mishra, Alex Gu, Binyuan Hui, Tri Dao, Armel Zebaze, Olivier Dehaene, Nicolas Patry, Canwen Xu, Julian McAuley, Han Hu, Torsten Scholak, Sebastien Paquet, Jennifer Robinson, Carolyn Jane Anderson, Nicolas Chapados, Mostofa Patwary, Nima Tajbakhsh, Yacine Jernite, Carlos Munoz Ferrandis, Lingming Zhang, Sean Hughes, Thomas Wolf, Arjun Guha,˜ Leandro von Werra, and Harm de Vries. 2024. StarCoder 2 and The Stack v2: The Next Generation.   
[110] Risto Luukkonen, Ville Komulainen, Jouni Luoma, Anni Eskelinen, Jenna Kanerva, Hanna-Mari Kupari, Filip Ginter, Veronika Laippala, Niklas Muennighoff, Aleksandra Piktus, Thomas Wang, Nouamane Tazi, Teven Le Scao, Thomas Wolf, Osma Suominen, Samuli Sairanen, Mikko Merioksa, Jyrki Heinonen, Aija Vahtola, Samuel Antao, and Sampo Pyysalo. 2023. FinGPT: Large Generative Models for a Small Language.   
[111] Ian Magnusson, Akshita Bhagia, Valentin Hofmann, Luca Soldaini, Ananya Harsh Jha, Oyvind Tafjord, Dustin Schwenk, Evan Pete Walsh, Yanai Elazar, Kyle Lo, Dirk Groeneveld, Iz Beltagy, Hannaneh Hajishirzi, Noah A. Smith, Kyle Richardson, and Jesse Dodge. 2023. Paloma: A Benchmark for Evaluating Language Model Fit.   
[112] Brandon McKinzie, Zhe Gan, Jean-Philippe Fauconnier, Sam Dodge, Bowen Zhang, Philipp Dufter, Dhruti Shah, Xianzhi Du, Futang Peng, Floris Weers, Anton Belyi, Haotian Zhang, Karanjeet Singh, Doug Kang, Ankur Jain, Hongyu He, Max Schwarzer, Tom Gunter, Xiang\` Kong, Aonan Zhang, Jianyu Wang, Chong Wang, Nan Du, Tao Lei, Sam Wiseman, Guoli Yin, Mark Lee, Zirui Wang, Ruoming Pang, Peter Grasch, Alexander Toshev, and Yinfei Yang. 2024. MM1: Methods, Analysis & Insights from Multimodal LLM Pre-training.

[113] Sachin Mehta, Mohammad Hossein Sekhavat, Qingqing Cao, Maxwell Horton, Yanzi Jin, Chenfan Sun, Iman Mirzadeh, Mahyar Najibi, Dmitry Belenko, Peter Zatloukal, and Mohammad Rastegari. 2024. OpenELM: An Efficient Language Model Family with Open Training and Inference Framework.   
[114] Yu Meng, Mengzhou Xia, and Danqi Chen. 2024. SimPO: Simple Preference Optimization with a Reference-Free Reward.   
[115] Stephen Merity, Caiming Xiong, James Bradbury, and Richard Socher. 2016. Pointer Sentinel Mixture Models.   
[116] Paulius Micikevicius, Sharan Narang, Jonah Alben, Gregory Diamos, Erich Elsen, David Garcia, Boris Ginsburg, Michael Houston, Oleksii Kuchaiev, Ganesh Venkatesh, and Hao Wu. 2018. Mixed Precision Training.   
[117] Todor Mihaylov, Peter Clark, Tushar Khot, and Ashish Sabharwal. 2018. Can a Suit of Armor Conduct Electricity? A New Dataset for Open Book Question Answering.   
[118] Swaroop Mishra, Daniel Khashabi, Chitta Baral, and Hannaneh Hajishirzi. 2022. Cross-Task Generalization via Natural Language Crowdsourcing Instructions.   
[119] Niklas Muennighoff. 2020. Vilio: State-of-the-art Visio-Linguistic Models applied to Hateful Memes.   
[120] Niklas Muennighoff, Qian Liu, Armel Zebaze, Qinkai Zheng, Binyuan Hui, Terry Yue Zhuo, Swayam Singh, Xiangru Tang, Leandro von Werra, and Shayne Longpre. 2023. OctoPack: Instruction Tuning Code Large Language Models.   
[121] Niklas Muennighoff, Alexander M. Rush, Boaz Barak, Teven Le Scao, Aleksandra Piktus, Nouamane Tazi, Sampo Pyysalo, Thomas Wolf, and Colin Raffel. 2023. Scaling Data-Constrained Language Models.   
[122] Niklas Muennighoff, Hongjin Su, Liang Wang, Nan Yang, Furu Wei, Tao Yu, Amanpreet Singh, and Douwe Kiela. 2024. Generative Representational Instruction Tuning.   
[123] Niklas Muennighoff, Thomas Wang, Lintang Sutawika, Adam Roberts, Stella Biderman, Teven Le Scao, M Saiful Bari, Sheng Shen, Zheng-Xin Yong, Hailey Schoelkopf, Xiangru Tang, Dragomir Radev, Alham Fikri Aji, Khalid Almubarak, Samuel Albanie, Zaid Alyafeai, Albert Webson, Edward Raff, and Colin Raffel. 2023. Crosslingual Generalization through Multitask Finetuning.   
[124] Mohammed Muqeeth, Haokun Liu, and Colin Raffel. 2024. Soft Merging of Experts with Adaptive Routing.   
[125] Basil Mustafa, Carlos Riquelme, Joan Puigcerver, Rodolphe Jenatton, and Neil Houlsby. 2022. Multimodal Contrastive Learning with LIMoE: the Language-Image Mixture of Experts.   
[126] Nvidia, :, Bo Adler, Niket Agarwal, Ashwath Aithal, Dong H. Anh, Pallab Bhattacharya, Annika Brundyn, Jared Casper, Bryan Catanzaro, Sharon Clay, Jonathan Cohen, Sirshak Das, Ayush Dattagupta, Olivier Delalleau, Leon Derczynski, Yi Dong, Daniel Egert, Ellie Evans, Aleksander Ficek, Denys Fridman, Shaona Ghosh, Boris Ginsburg, Igor Gitman, Tomasz Grzegorzek, Robert Hero, Jining Huang, Vibhu Jawa, Joseph Jennings, Aastha Jhunjhunwala, John Kamalu, Sadaf Khan, Oleksii Kuchaiev, Patrick LeGresley, Hui Li, Jiwei Liu, Zihan Liu, Eileen Long, Ameya Sunil Mahabaleshwarkar, Somshubra Majumdar, James Maki, Miguel Martinez, Maer Rodrigues de Melo, Ivan Moshkov, Deepak Narayanan, Sean Narenthiran, Jesus Navarro, Phong Nguyen, Osvald Nitski, Vahid Noroozi, Guruprasad Nutheti, Christopher Parisien, Jupinder Parmar, Mostofa Patwary, Krzysztof Pawelec, Wei Ping, Shrimai Prabhumoye, Rajarshi Roy, Trisha Saar, Vasanth Rao Naik Sabavat, Sanjeev Satheesh, Jane Polak Scowcroft, Jason Sewall, Pavel Shamis, Gerald Shen, Mohammad Shoeybi, Dave Sizer, Misha Smelyanskiy, Felipe Soares, Makesh Narsimhan Sreedhar, Dan Su, Sandeep Subramanian, Shengyang Sun, Shubham Toshniwal, Hao Wang, Zhilin Wang, Jiaxuan You, Jiaqi Zeng, Jimmy Zhang, Jing Zhang, Vivienne Zhang, Yian Zhang, and Chen Zhu. 2024. Nemotron-4 340B Technical Report.

[127] Team OLMo, Pete Walsh, Luca Soldaini, Dirk Groeneveld, Kyle Lo, Shane Arora, Akshita Bhagia, Yuling Gu, Shengyi Huang, Matt Jordan, Nathan Lambert, Dustin Schwenk, Oyvind Tafjord, Taira Anderson, David Atkinson, Faeze Brahman, Christopher Clark, Pradeep Dasigi, Nouha Dziri, Michal Guerquin, Hamish Ivison, Pang Wei Koh, Jiacheng Liu, Saumya Malik, William Merrill, Lester James Validad Miranda, Jacob Daniel Morrison, Tyler C. Murray, Crystal Nam, Valentina Pyatkin, Aman Rangapur, Michael Schmitz, Sam Skjonsberg, David Wadden, Chris Wilhelm, Michael Wilson, Luke S. Zettlemoyer, Ali Farhadi, Noah A. Smith, and Hanna Hajishirzi. 2024. 2 OLMo 2 Furious. arXiv preprint.   
[128] OpenAI, Josh Achiam, Steven Adler, Sandhini Agarwal, Lama Ahmad, Ilge Akkaya, Florencia Leoni Aleman, Diogo Almeida, Janko Altenschmidt, Sam Altman, et al. 2023. GPT-4 Technical Report.   
[129] Bowen Pan, Yikang Shen, Haokun Liu, Mayank Mishra, Gaoyuan Zhang, Aude Oliva, Colin Raffel, and Rameswar Panda. 2024. Dense Training, Sparse Inference: Rethinking Training of Mixture-of-Experts Language Models.   
[130] Jupinder Parmar, Shrimai Prabhumoye, Joseph Jennings, Mostofa Patwary, Sandeep Subramanian, Dan Su, Chen Zhu, Deepak Narayanan, Aastha Jhunjhunwala, Ayush Dattagupta, Vibhu Jawa, Jiwei Liu, Ameya Mahabaleshwarkar, Osvald Nitski, Annika Brundyn, James Maki, Miguel Martinez, Jiaxuan You, John Kamalu, Patrick LeGresley, Denys Fridman, Jared Casper, Ashwath Aithal, Oleksii Kuchaiev, Mohammad Shoeybi, Jonathan Cohen, and Bryan Catanzaro. 2024. Nemotron-4 15B Technical Report.   
[131] Keiran Paster, Marco Dos Santos, Zhangir Azerbayev, and Jimmy Ba. 2023. OpenWebMath: An Open Dataset of High-Quality Mathematical Web Text.   
[132] Guilherme Penedo, Quentin Malartic, Daniel Hesslow, Ruxandra Cojocaru, Alessandro Cappelli, Hamza Alobeidli, Baptiste Pannier, Ebtesam Almazrouei, and Julien Launay. 2023. The RefinedWeb Dataset for Falcon LLM: Outperforming Curated Corpora with Web Data, and Web Data Only.   
[133] Bo Peng, Eric Alcaide, Quentin Anthony, Alon Albalak, Samuel Arcadinho, Stella Biderman, Huanqi Cao, Xin Cheng, Michael Chung, Matteo Grella, Kranthi Kiran GV, Xuzheng He, Haowen Hou, Jiaju Lin, Przemyslaw Kazienko, Jan Kocon, Jiaming Kong, Bartlomiej Koptyra, Hayden Lau, Krishna Sri Ipsit Mantri, Ferdinand Mom, Atsushi Saito, Guangyu Song, Xiangru Tang, Bolun Wang, Johan S. Wind, Stanislaw Wozniak, Ruichong Zhang, Zhenyuan Zhang, Qihang Zhao, Peng Zhou, Qinghua Zhou, Jian Zhu, and Rui-Jie Zhu. 2023. RWKV: Reinventing RNNs for the Transformer Era.   
[134] Bo Peng, Daniel Goldstein, Quentin Anthony, Alon Albalak, Eric Alcaide, Stella Biderman, Eugene Cheah, Xingjian Du, Teddy Ferdinan, Haowen Hou, Przemysław Kazienko, Kranthi Kiran GV, Jan Kocon, Bartłomiej Koptyra, Satyapriya Krishna, Ronald McClelland Jr.´ au2, Niklas Muennighoff, Fares Obeid, Atsushi Saito, Guangyu Song, Haoqin Tu, Stanisław Wozniak, Ruichong Zhang, Bingchen Zhao, Qihang Zhao, Peng Zhou, Jian Zhu, and Rui-Jie´ Zhu. 2024. Eagle and Finch: RWKV with Matrix-Valued States and Dynamic Recurrence.   
[135] Ofir Press and Lior Wolf. 2017. Using the Output Embedding to Improve Language Models.   
[136] Alec Radford, Jong Wook Kim, Tao Xu, Greg Brockman, Christine McLeavey, and Ilya Sutskever. 2022. Robust Speech Recognition via Large-Scale Weak Supervision.   
[137] Alec Radford, Jeffrey Wu, Rewon Child, David Luan, Dario Amodei, Ilya Sutskever, et al. 2019. Language models are unsupervised multitask learners.   
[138] Rafael Rafailov, Archit Sharma, Eric Mitchell, Stefano Ermon, Christopher D. Manning, and Chelsea Finn. 2023. Direct Preference Optimization: Your Language Model is Secretly a Reward Model.   
[139] Colin Raffel, Noam Shazeer, Adam Roberts, Katherine Lee, Sharan Narang, Michael Matena, Yanqi Zhou, Wei Li, and Peter J. Liu. 2023. Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer.

[140] Nazneen Rajani, Lewis Tunstall, Edward Beeching, Nathan Lambert, Alexander M. Rush, and Thomas Wolf. 2023. No Robots.   
[141] Samyam Rajbhandari, Conglong Li, Zhewei Yao, Minjia Zhang, Reza Yazdani Aminabadi, Ammar Ahmad Awan, Jeff Rasley, and Yuxiong He. 2022. DeepSpeed-MoE: Advancing Mixture-of-Experts Inference and Training to Power Next-Generation AI Scale.   
[142] Samyam Rajbhandari, Jeff Rasley, Olatunji Ruwase, and Yuxiong He. 2020. ZeRO: Memory Optimizations Toward Training Trillion Parameter Models.   
[143] David Raposo, Sam Ritter, Blake Richards, Timothy Lillicrap, Peter Conway Humphreys, and Adam Santoro. 2024. Mixture-of-Depths: Dynamically allocating compute in transformerbased language models.   
[144] Machel Reid, Victor Zhong, Suchin Gururangan, and Luke Zettlemoyer. 2022. M2D2: A Massively Multi-domain Language Modeling Dataset.   
[145] Xiaozhe Ren, Pingyi Zhou, Xinfan Meng, Xinjing Huang, Yadao Wang, Weichao Wang, Pengfei Li, Xiaoda Zhang, Alexander Podolskiy, Grigory Arshinov, Andrey Bout, Irina Piontkovskaya, Jiansheng Wei, Xin Jiang, Teng Su, Qun Liu, and Jun Yao. 2023. PanGu-Sigma: Towards Trillion Parameter Language Model with Sparse Heterogeneous Computing.   
[146] Stephen Roller, Sainbayar Sukhbaatar, Arthur Szlam, and Jason Weston. 2021. Hash Layers For Large Sparse Models.   
[147] Paul Rottger, Hannah Rose Kirk, Bertie Vidgen, Giuseppe Attanasio, Federico Bianchi, and¨ Dirk Hovy. 2024. XSTest: A Test Suite for Identifying Exaggerated Safety Behaviours in Large Language Models.   
[148] Keisuke Sakaguchi, Ronan Le Bras, Chandra Bhagavatula, and Yejin Choi. 2019. Wino-Grande: An Adversarial Winograd Schema Challenge at Scale.   
[149] Victor Sanh, Albert Webson, Colin Raffel, Stephen H. Bach, Lintang Sutawika, Zaid Alyafeai, Antoine Chaffin, Arnaud Stiegler, Teven Le Scao, Arun Raja, et al. 2022. Multitask Prompted Training Enables Zero-Shot Task Generalization.   
[150] Maarten Sap, Hannah Rashkin, Derek Chen, Ronan LeBras, and Yejin Choi. 2019. SocialIQA: Commonsense Reasoning about Social Interactions.   
[151] Teven Le Scao, Thomas Wang, Daniel Hesslow, Lucile Saulnier, Stas Bekman, M Saiful Bari, Stella Biderman, Hady Elsahar, Niklas Muennighoff, Jason Phang, Ofir Press, Colin Raffel, Victor Sanh, Sheng Shen, Lintang Sutawika, Jaesung Tae, Zheng Xin Yong, Julien Launay, and Iz Beltagy. 2022. What Language Model to Train if You Have One Million GPU Hours?   
[152] Noam Shazeer. 2019. Fast Transformer Decoding: One Write-Head is All You Need.   
[153] Noam Shazeer. 2020. GLU Variants Improve Transformer.   
[154] Noam Shazeer, Azalia Mirhoseini, Krzysztof Maziarz, Andy Davis, Quoc Le, Geoffrey Hinton, and Jeff Dean. 2017. Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer.   
[155] Noam Shazeer and Mitchell Stern. 2018. Adafactor: Adaptive Learning Rates with Sublinear Memory Cost.   
[156] Sheng Shen, Le Hou, Yanqi Zhou, Nan Du, Shayne Longpre, Jason Wei, Hyung Won Chung, Barret Zoph, William Fedus, Xinyun Chen, Tu Vu, Yuexin Wu, Wuyang Chen, Albert Webson, Yunxuan Li, Vincent Zhao, Hongkun Yu, Kurt Keutzer, Trevor Darrell, and Denny Zhou. 2023. Mixture-of-Experts Meets Instruction Tuning:A Winning Combination for Large Language Models.   
[157] Sheng Shen, Zhewei Yao, Chunyuan Li, Trevor Darrell, Kurt Keutzer, and Yuxiong He. 2023. Scaling Vision-Language Models with Sparse Mixture of Experts.

[158] Yikang Shen, Zhen Guo, Tianle Cai, and Zengyi Qin. 2024. JetMoE: Reaching Llama2 Performance with 0.1M Dollars.   
[159] Mohammad Shoeybi, Mostofa Patwary, Raul Puri, Patrick LeGresley, Jared Casper, and Bryan Catanzaro. 2020. Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism.   
[160] Shivalika Singh, Freddie Vargus, Daniel Dsouza, Borje F. Karlsson, Abinaya Mahendiran,¨ Wei-Yin Ko, Herumb Shandilya, Jay Patel, Deividas Mataciunas, Laura OMahony, Mike Zhang, Ramith Hettiarachchi, Joseph Wilson, Marina Machado, Luisa Souza Moura, Dominik Krzeminski, Hakimeh Fadaei, Irem Erg´ un, Ifeoma Okoh, Aisha Alaagib, Oshan Mu-¨ dannayake, Zaid Alyafeai, Vu Minh Chien, Sebastian Ruder, Surya Guthikonda, Emad A. Alghamdi, Sebastian Gehrmann, Niklas Muennighoff, Max Bartolo, Julia Kreutzer, Ahmet Ust¨ un, Marzieh Fadaee, and Sara Hooker. 2024.¨ Aya Dataset: An Open-Access Collection for Multilingual Instruction Tuning.   
[161] Snowflake. 2024. Snowflake Arctic Cookbook Series: Exploring Mixture of Experts (MoE).   
[162] Snowflake. 2024. Snowflake Arctic: The Best LLM for Enterprise AI — Efficiently Intelligent, Truly Open.   
[163] Luca Soldaini, Rodney Kinney, Akshita Bhagia, Dustin Schwenk, David Atkinson, Russell Authur, Ben Bogin, Khyathi Chandu, Jennifer Dumas, Yanai Elazar, Valentin Hofmann, Ananya Harsh Jha, Sachin Kumar, Li Lucy, Xinxi Lyu, Nathan Lambert, Ian Magnusson, Jacob Morrison, Niklas Muennighoff, Aakanksha Naik, Crystal Nam, Matthew E. Peters, Abhilasha Ravichander, Kyle Richardson, Zejiang Shen, Emma Strubell, Nishant Subramani, Oyvind Tafjord, Pete Walsh, Luke Zettlemoyer, Noah A. Smith, Hannaneh Hajishirzi, Iz Beltagy, Dirk Groeneveld, Jesse Dodge, and Kyle Lo. 2024. Dolma: an Open Corpus of Three Trillion Tokens for Language Model Pretraining Research.   
[164] Luca Soldaini and Kyle Lo. 2023. peS2o (Pretraining Efficiently on S2ORC) Dataset.   
[165] Guijin Son, Hanwool Lee, Sungdong Kim, Seungone Kim, Niklas Muennighoff, Taekyoon Choi, Cheonbok Park, Kang Min Yoo, and Stella Biderman. 2024. KMMLU: Measuring Massive Multitask Language Understanding in Korean.   
[166] Jianlin Su, Yu Lu, Shengfeng Pan, Ahmed Murtadha, Bo Wen, and Yunfeng Liu. 2023. Ro-Former: Enhanced Transformer with Rotary Position Embedding.   
[167] Weijie Su, Xizhou Zhu, Yue Cao, Bin Li, Lewei Lu, Furu Wei, and Jifeng Dai. 2020. VL-BERT: Pre-training of Generic Visual-Linguistic Representations.   
[168] Sainbayar Sukhbaatar, Olga Golovneva, Vasu Sharma, Hu Xu, Xi Victoria Lin, Baptiste Roziere, Jacob Kahn, Daniel Li, Wen tau Yih, Jason Weston, and Xian Li. 2024.\` Branch-Train-MiX: Mixing Expert LLMs into a Mixture-of-Experts LLM.   
[169] Mirac Suzgun, Nathan Scales, Nathanael Scharli, Sebastian Gehrmann, Yi Tay, Hyung Won¨ Chung, Aakanksha Chowdhery, Quoc V. Le, Ed H. Chi, Denny Zhou, and Jason Wei. 2022. Challenging BIG-Bench Tasks and Whether Chain-of-Thought Can Solve Them.   
[170] Alon Talmor, Jonathan Herzig, Nicholas Lourie, and Jonathan Berant. 2019. CommonsenseQA: A Question Answering Challenge Targeting Commonsense Knowledge.   
[171] Shawn Tan, Yikang Shen, Zhenfang Chen, Aaron Courville, and Chuang Gan. 2023. Sparse Universal Transformer.   
[172] Chaofan Tao, Qian Liu, Longxu Dou, Niklas Muennighoff, Zhongwei Wan, Ping Luo, Min Lin, and Ngai Wong. 2024. Scaling Laws with Vocabulary: Larger Models Deserve Larger Vocabularies.   
[173] Chameleon Team. 2024. Chameleon: Mixed-Modal Early-Fusion Foundation Models.   
[174] Gemini Team, Rohan Anil, Sebastian Borgeaud, Yonghui Wu, Jean-Baptiste Alayrac, Jiahui Yu, Radu Soricut, Johan Schalkwyk, Andrew M. Dai, Anja Hauth, et al. 2023. Gemini: A Family of Highly Capable Multimodal Models.

[175] Gemini Team, Petko Georgiev, Ving Ian Lei, Ryan Burnell, Libin Bai, Anmol Gulati, Garrett Tanzer, Damien Vincent, Zhufeng Pan, Shibo Wang, Soroosh Mariooryad, Yifan Ding, Xinyang Geng, Fred Alcober, Roy Frostig, Mark Omernick, Lexi Walker, Cosmin Paduraru, Christina Sorokin, Andrea Tacchetti, Colin Gaffney, Samira Daruki, Olcan Sercinoglu, Zach Gleicher, Juliette Love, Paul Voigtlaender, Rohan Jain, et al. 2024. Gemini 1.5: Unlocking multimodal understanding across millions of tokens of context.   
[176] Gemma Team, Thomas Mesnard, Cassidy Hardin, Robert Dadashi, Surya Bhupatiraju, Shreya Pathak, Laurent Sifre, Morgane Riviere, Mihir Sanjay Kale, Juliette Love, Pouya Tafti, \` Leonard Hussenot, Pier Giuseppe Sessa, Aakanksha Chowdhery, Adam Roberts, Aditya´ Barua, Alex Botev, Alex Castro-Ros, Ambrose Slone, Amelie H´ eliou, Andrea Tacchetti,´ Anna Bulanova, Antonia Paterson, Beth Tsai, Bobak Shahriari, Charline Le Lan, Christopher A. Choquette-Choo, Clement Crepy, Daniel Cer, Daphne Ippolito, David Reid, Elena´ Buchatskaya, Eric Ni, Eric Noland, Geng Yan, George Tucker, George-Christian Muraru, Grigory Rozhdestvenskiy, Henryk Michalewski, Ian Tenney, Ivan Grishchenko, Jacob Austin, James Keeling, Jane Labanowski, Jean-Baptiste Lespiau, Jeff Stanway, Jenny Brennan, Jeremy Chen, Johan Ferret, Justin Chiu, Justin Mao-Jones, Katherine Lee, Kathy Yu, Katie Millican, Lars Lowe Sjoesund, Lisa Lee, Lucas Dixon, Machel Reid, Maciej Mikuła, Mateo Wirth, Michael Sharman, Nikolai Chinaev, Nithum Thain, Olivier Bachem, Oscar Chang, Oscar Wahltinez, Paige Bailey, Paul Michel, Petko Yotov, Rahma Chaabouni, Ramona Comanescu, Reena Jana, Rohan Anil, Ross McIlroy, Ruibo Liu, Ryan Mullins, Samuel L Smith, Sebastian Borgeaud, Sertan Girgin, Sholto Douglas, Shree Pandya, Siamak Shakeri, Soham De, Ted Klimenko, Tom Hennigan, Vlad Feinberg, Wojciech Stokowiec, Yu hui Chen, Zafarali Ahmed, Zhitao Gong, Tris Warkentin, Ludovic Peran, Minh Giang, Clement Farabet,´ Oriol Vinyals, Jeff Dean, Koray Kavukcuoglu, Demis Hassabis, Zoubin Ghahramani, Douglas Eck, Joelle Barral, Fernando Pereira, Eli Collins, Armand Joulin, Noah Fiedel, Evan Senter, Alek Andreev, and Kathleen Kenealy. 2024. Gemma: Open Models Based on Gemini Research and Technology.   
[177] Gemma Team, Morgane Riviere, Shreya Pathak, Pier Giuseppe Sessa, Cassidy Hardin, Surya Bhupatiraju, Leonard Hussenot, Thomas Mesnard, Bobak Shahriari, Alexandre Ram´ e, Johan´ Ferret, Peter Liu, Pouya Tafti, Abe Friesen, et al. 2024. Gemma 2: Improving Open Language Models at a Practical Size.   
[178] Jamba Team, Barak Lenz, Alan Arazi, Amir Bergman, Avshalom Manevich, Barak Peleg, Ben Aviram, Chen Almagor, Clara Fridman, Dan Padnos, Daniel Gissin, Daniel Jannai, Dor Muhlgay, Dor Zimberg, Edden M Gerber, Elad Dolev, Eran Krakovsky, Erez Safahi, Erez Schwartz, Gal Cohen, Gal Shachaf, Haim Rozenblum, Hofit Bata, Ido Blass, Inbal Magar, Itay Dalmedigos, Jhonathan Osin, Julie Fadlon, Maria Rozman, Matan Danos, Michael Gokhman, Mor Zusman, Naama Gidron, Nir Ratner, Noam Gat, Noam Rozen, Oded Fried, Ohad Leshno, Omer Antverg, Omri Abend, Opher Lieber, Or Dagan, Orit Cohavi, Raz Alon, Ro’i Belson, Roi Cohen, Rom Gilad, Roman Glozman, Shahar Lev, Shaked Meirom, Tal Delbari, Tal Ness, Tomer Asida, Tom Ben Gal, Tom Braude, Uriya Pumerantz, Yehoshua Cohen, Yonatan Belinkov, Yuval Globerson, Yuval Peleg Levy, and Yoav Shoham. 2024. Jamba-1.5: Hybrid Transformer-Mamba Models at Scale.   
[179] MosaicML NLP Team. 2023. Introducing MPT-7B: A New Standard for Open-Source, Commercially Usable LLMs.   
[180] Qwen Team. 2024. Qwen1.5-MoE: Matching 7B Model Performance with 1/3 Activated Parameters”.   
[181] Reka Team, Aitor Ormazabal, Che Zheng, Cyprien de Masson d’Autume, Dani Yogatama, Deyu Fu, Donovan Ong, Eric Chen, Eugenie Lamprecht, Hai Pham, Isaac Ong, Kaloyan Aleksiev, Lei Li, Matthew Henderson, Max Bain, Mikel Artetxe, Nishant Relan, Piotr Padlewski, Qi Liu, Ren Chen, Samuel Phua, Yazheng Yang, Yi Tay, Yuqi Wang, Zhongkai Zhu, and Zhihui Xie. 2024. Reka Core, Flash, and Edge: A Series of Powerful Multimodal Language Models.   
[182] Hugo Touvron, Thibaut Lavril, Gautier Izacard, Xavier Martinet, Marie-Anne Lachaux, Timothee Lacroix, Baptiste Rozi´ ere, Naman Goyal, Eric Hambro, Faisal Azhar, Aurelien Ro-\`

driguez, Armand Joulin, Edouard Grave, and Guillaume Lample. 2023. LLaMA: Open and Efficient Foundation Language Models.   
[183] Hugo Touvron, Louis Martin, Kevin Stone, Peter Albert, Amjad Almahairi, Yasmine Babaei, Nikolay Bashlykov, Soumya Batra, Prajjwal Bhargava, Shruti Bhosale, Dan Bikel, Lukas Blecher, Cristian Canton Ferrer, Moya Chen, Guillem Cucurull, David Esiobu, Jude Fernandes, Jeremy Fu, Wenyin Fu, Brian Fuller, Cynthia Gao, Vedanuj Goswami, Naman Goyal, Anthony Hartshorn, Saghar Hosseini, Rui Hou, Hakan Inan, Marcin Kardas, Viktor Kerkez, Madian Khabsa, Isabel Kloumann, Artem Korenev, Punit Singh Koura, Marie-Anne Lachaux, Thibaut Lavril, Jenya Lee, Diana Liskovich, Yinghai Lu, Yuning Mao, Xavier Martinet, Todor Mihaylov, Pushkar Mishra, Igor Molybog, Yixin Nie, Andrew Poulton, Jeremy Reizenstein, Rashi Rungta, Kalyan Saladi, Alan Schelten, Ruan Silva, Eric Michael Smith, Ranjan Subramanian, Xiaoqing Ellen Tan, Binh Tang, Ross Taylor, Adina Williams, Jian Xiang Kuan, Puxin Xu, Zheng Yan, Iliyan Zarov, Yuchen Zhang, Angela Fan, Melanie Kambadur, Sharan Narang, Aurelien Rodriguez, Robert Stojnic, Sergey Edunov, and Thomas Scialom. 2023. Llama 2: Open Foundation and Fine-Tuned Chat Models.   
[184] Lewis Tunstall, Edward Beeching, Nathan Lambert, Nazneen Rajani, Kashif Rasul, Younes Belkada, Shengyi Huang, Leandro von Werra, Clementine Fourrier, Nathan Habib, Nathan´ Sarrazin, Omar Sanseviero, Alexander M. Rush, and Thomas Wolf. 2023. Zephyr: Direct Distillation of LM Alignment.   
[185] Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez, Lukasz Kaiser, and Illia Polosukhin. 2023. Attention Is All You Need.   
[186] Ben Wang and Aran Komatsuzaki. 2021. GPT-J-6B: A 6 Billion Parameter Autoregressive Language Model.   
[187] Xingyao Wang, Boxuan Li, Yufan Song, Frank F. Xu, Xiangru Tang, Mingchen Zhuge, Jiayi Pan, Yueqi Song, Bowen Li, Jaskirat Singh, Hoang H. Tran, Fuqiang Li, Ren Ma, Mingzhang Zheng, Bill Qian, Yanjun Shao, Niklas Muennighoff, Yizhe Zhang, Binyuan Hui, Junyang Lin, Robert Brennan, Hao Peng, Heng Ji, and Graham Neubig. 2024. OpenDevin: An Open Platform for AI Software Developers as Generalist Agents.   
[188] Yizhong Wang, Hamish Ivison, Pradeep Dasigi, Jack Hessel, Tushar Khot, Khyathi Raghavi Chandu, David Wadden, Kelsey MacMillan, Noah A. Smith, Iz Beltagy, and Hannaneh Hajishirzi. 2023. How Far Can Camels Go? Exploring the State of Instruction Tuning on Open Resources.   
[189] Zhilin Wang, Yi Dong, Olivier Delalleau, Jiaqi Zeng, Gerald Shen, Daniel Egert, Jimmy J. Zhang, Makesh Narsimhan Sreedhar, and Oleksii Kuchaiev. 2024. HelpSteer2: Open-source dataset for training top-performing reward models.   
[190] Jason Wei, Maarten Bosma, Vincent Y. Zhao, Kelvin Guu, Adams Wei Yu, Brian Lester, Nan Du, Andrew M. Dai, and Quoc V. Le. 2022. Finetuned Language Models Are Zero-Shot Learners.   
[191] Tianwen Wei, Bo Zhu, Liang Zhao, Cheng Cheng, Biye Li, Weiwei Lu, Peng Cheng, Jianhao¨ Zhang, Xiaoyu Zhang, Liang Zeng, Xiaokun Wang, Yutuan Ma, Rui Hu, Shuicheng Yan, Han Fang, and Yahui Zhou. 2024. Skywork-MoE: A Deep Dive into Training Techniques for Mixture-of-Experts Language Models.   
[192] Johannes Welbl, Nelson F. Liu, and Matt Gardner. 2017. Crowdsourcing Multiple Choice Science Questions.   
[193] BigScience Workshop, Teven Le Scao, Angela Fan, Christopher Akiki, Ellie Pavlick, Suzana Ilic, Daniel Hesslow, Roman Castagn´ e, Alexandra Sasha Luccioni, Franc¸ois Yvon, Matthias´ Galle, Jonathan Tow, Alexander M. Rush, Stella Biderman, Albert Webson, Pawan Sasanka´ Ammanamanchi, Thomas Wang, Benoˆıt Sagot, Niklas Muennighoff, et al. 2023. BLOOM: A 176B-Parameter Open-Access Multilingual Language Model.   
[194] Jialin Wu, Xia Hu, Yaqing Wang, Bo Pang, and Radu Soricut. 2024. Omni-SMoLA: Boosting Generalist Multimodal Models with Soft Mixture of Low-rank Experts.

[195] Shaohua Wu, Jiangang Luo, Xi Chen, Lingjun Li, Xudong Zhao, Tong Yu, Chao Wang, Yue Wang, Fei Wang, Weixu Qiao, Houbo He, Zeru Zhang, Zeyu Sun, Junxiong Mao, and Chong Shen. 2024. Yuan 2.0-M32: Mixture of Experts with Attention Router.   
[196] xAI. 2024. Open Release of Grok-1.   
[197] Shitao Xiao, Zheng Liu, Peitian Zhang, and Niklas Muennighoff. 2023. C-Pack: Packaged Resources To Advance General Chinese Embedding.   
[198] Cheng Xu, Shuhao Guan, Derek Greene, and M-Tahar Kechadi. 2024. Benchmark Data Contamination of Large Language Models: A Survey.   
[199] Fuzhao Xue, Zian Zheng, Yao Fu, Jinjie Ni, Zangwei Zheng, Wangchunshu Zhou, and Yang You. 2024. OpenMoE: An Early Effort on Open Mixture-of-Experts Language Models.   
[200] Aiyuan Yang, Bin Xiao, Bingning Wang, Borong Zhang, Ce Bian, Chao Yin, Chenxu Lv, Da Pan, Dian Wang, Dong Yan, Fan Yang, Fei Deng, Feng Wang, Feng Liu, Guangwei Ai, Guosheng Dong, Haizhou Zhao, Hang Xu, Haoze Sun, Hongda Zhang, Hui Liu, Jiaming Ji, Jian Xie, JunTao Dai, Kun Fang, Lei Su, Liang Song, Lifeng Liu, Liyun Ru, Luyao Ma, Mang Wang, Mickel Liu, MingAn Lin, Nuolan Nie, Peidong Guo, Ruiyang Sun, Tao Zhang, Tianpeng Li, Tianyu Li, Wei Cheng, Weipeng Chen, Xiangrong Zeng, Xiaochuan Wang, Xiaoxi Chen, Xin Men, Xin Yu, Xuehai Pan, Yanjun Shen, Yiding Wang, Yiyu Li, Youxin Jiang, Yuchen Gao, Yupeng Zhang, Zenan Zhou, and Zhiying Wu. 2023. Baichuan 2: Open Large-scale Language Models.   
[201] An Yang, Baosong Yang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Zhou, Chengpeng Li, Chengyuan Li, Dayiheng Liu, Fei Huang, Guanting Dong, Haoran Wei, Huan Lin, Jialong Tang, Jialin Wang, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Ma, Jianxin Yang, Jin Xu, Jingren Zhou, Jinze Bai, Jinzheng He, Junyang Lin, Kai Dang, Keming Lu, Keqin Chen, Kexin Yang, Mei Li, Mingfeng Xue, Na Ni, Pei Zhang, Peng Wang, Ru Peng, Rui Men, Ruize Gao, Runji Lin, Shijie Wang, Shuai Bai, Sinan Tan, Tianhang Zhu, Tianhao Li, Tianyu Liu, Wenbin Ge, Xiaodong Deng, Xiaohuan Zhou, Xingzhang Ren, Xinyu Zhang, Xipin Wei, Xuancheng Ren, Xuejing Liu, Yang Fan, Yang Yao, Yichang Zhang, Yu Wan, Yunfei Chu, Yuqiong Liu, Zeyu Cui, Zhenru Zhang, Zhifang Guo, and Zhihao Fan. 2024. Qwen2 Technical Report.   
[202] John Yang, Carlos E. Jimenez, Alexander Wettig, Kilian Lieret, Shunyu Yao, Karthik Narasimhan, and Ofir Press. 2024. SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering.   
[203] Zheng-Xin Yong, Hailey Schoelkopf, Niklas Muennighoff, Alham Fikri Aji, David Ifeoluwa Adelani, Khalid Almubarak, M Saiful Bari, Lintang Sutawika, Jungo Kasai, Ahmed Baruwa, Genta Indra Winata, Stella Biderman, Edward Raff, Dragomir Radev, and Vassilina Nikoulina. 2023. BLOOM+1: Adding Language Support to BLOOM for Zero-Shot Prompting.   
[204] Longhui Yu, Weisen Jiang, Han Shi, Jincheng Yu, Zhengying Liu, Yu Zhang, James T. Kwok, Zhenguo Li, Adrian Weller, and Weiyang Liu. 2024. MetaMath: Bootstrap Your Own Mathematical Questions for Large Language Models.   
[205] Longfei Yun, Yonghao Zhuang, Yao Fu, Eric P Xing, and Hao Zhang. 2024. Toward Inference-optimal Mixture-of-Expert Large Language Models.   
[206] Ted Zadouri, Ahmet Ust¨ un, Arash Ahmadian, Beyza Ermis¸, Acyr Locatelli, and Sara Hooker.¨ 2023. Pushing Mixture of Experts to the Limit: Extremely Parameter Efficient MoE for Instruction Tuning.   
[207] Rowan Zellers, Ari Holtzman, Yonatan Bisk, Ali Farhadi, and Yejin Choi. 2019. HellaSwag: Can a Machine Really Finish Your Sentence?   
[208] Biao Zhang and Rico Sennrich. 2019. Root Mean Square Layer Normalization.

[209] Ge Zhang, Scott Qu, Jiaheng Liu, Chenchen Zhang, Chenghua Lin, Chou Leuang Yu, Danny Pan, Esther Cheng, Jie Liu, Qunshu Lin, Raven Yuan, Tuney Zheng, Wei Pang, Xinrun Du, Yiming Liang, Yinghao Ma, Yizhi Li, Ziyang Ma, Bill Lin, Emmanouil Benetos, Huan Yang, Junting Zhou, Kaijing Ma, Minghao Liu, Morry Niu, Noah Wang, Quehry Que, Ruibo Liu, Sine Liu, Shawn Guo, Soren Gao, Wangchunshu Zhou, Xinyue Zhang, Yizhi Zhou, Yubo Wang, Yuelin Bai, Yuhan Zhang, Yuxiang Zhang, Zenith Wang, Zhenzhu Yang, Zijian Zhao, Jiajun Zhang, Wanli Ouyang, Wenhao Huang, and Wenhu Chen. 2024. MAP-Neo: Highly Capable and Transparent Bilingual Large Language Model Series.   
[210] Peiyuan Zhang, Guangtao Zeng, Tianduo Wang, and Wei Lu. 2024. TinyLlama: An Open-Source Small Language Model.   
[211] Qizhen Zhang, Nikolas Gritsch, Dwaraknath Gnaneshwar, Simon Guo, David Cairuz, Bharat Venkitesh, Jakob Foerster, Phil Blunsom, Sebastian Ruder, Ahmet Ustun, and Acyr Locatelli. 2024. BAM! Just Like That: Simple and Efficient Parameter Upcycling for Mixture of Experts.   
[212] Susan Zhang, Stephen Roller, Naman Goyal, Mikel Artetxe, Moya Chen, Shuohui Chen, Christopher Dewan, Mona Diab, Xian Li, Xi Victoria Lin, Todor Mihaylov, Myle Ott, Sam Shleifer, Kurt Shuster, Daniel Simig, Punit Singh Koura, Anjali Sridhar, Tianlu Wang, and Luke Zettlemoyer. 2022. OPT: Open Pre-trained Transformer Language Models.   
[213] Yanli Zhao, Andrew Gu, Rohan Varma, Liang Luo, Chien-Chin Huang, Min Xu, Less Wright, Hamid Shojanazeri, Myle Ott, Sam Shleifer, Alban Desmaison, Can Balioglu, Pritam Damania, Bernard Nguyen, Geeta Chauhan, Yuchen Hao, Ajit Mathews, and Shen Li. 2023. PyTorch FSDP: Experiences on Scaling Fully Sharded Data Parallel.   
[214] Tianyu Zheng, Ge Zhang, Tianhao Shen, Xueling Liu, Bill Yuchen Lin, Jie Fu, Wenhu Chen, and Xiang Yue. 2024. Opencodeinterpreter: Integrating code generation with execution and refinement. arXiv preprint arXiv:2402.14658.   
[215] Zexuan Zhong, Mengzhou Xia, Danqi Chen, and Mike Lewis. 2024. Lory: Fully Differentiable Mixture-of-Experts for Autoregressive Language Model Pre-training.   
[216] Chunting Zhou, Pengfei Liu, Puxin Xu, Srini Iyer, Jiao Sun, Yuning Mao, Xuezhe Ma, Avia Efrat, Ping Yu, Lili Yu, Susan Zhang, Gargi Ghosh, Mike Lewis, Luke Zettlemoyer, and Omer Levy. 2023. LIMA: Less Is More for Alignment.   
[217] Jeffrey Zhou, Tianjian Lu, Swaroop Mishra, Siddhartha Brahma, Sujoy Basu, Yi Luan, Denny Zhou, and Le Hou. 2023. Instruction-Following Evaluation for Large Language Models.   
[218] Yanqi Zhou, Nan Du, Yanping Huang, Daiyi Peng, Chang Lan, Da Huang, Siamak Shakeri, David So, Andrew Dai, Yifeng Lu, Zhifeng Chen, Quoc Le, Claire Cui, James Laudon, and Jeff Dean. 2024. Brainformers: Trading Simplicity for Efficiency.   
[219] Yanqi Zhou, Tao Lei, Hanxiao Liu, Nan Du, Yanping Huang, Vincent Zhao, Andrew Dai, Zhifeng Chen, Quoc Le, and James Laudon. 2022. Mixture-of-Experts with Expert Choice Routing.   
[220] Terry Yue Zhuo, Armel Zebaze, Nitchakarn Suppattarachai, Leandro von Werra, Harm de Vries, Qian Liu, and Niklas Muennighoff. 2024. Astraios: Parameter-Efficient Instruction Tuning Code Large Language Models.   
[221] Barret Zoph, Irwan Bello, Sameer Kumar, Nan Du, Yanping Huang, Jeff Dean, Noam Shazeer, and William Fedus. 2022. ST-MoE: Designing Stable and Transferable Sparse Expert Models.   
[222] Simiao Zuo, Xiaodong Liu, Jian Jiao, Young Jin Kim, Hany Hassan, Ruofei Zhang, Tuo Zhao, and Jianfeng Gao. 2022. Taming Sparsely Activated Transformer with Stochastic Experts.   
[223] Ahmet Ust¨ un, Viraat Aryabumi, Zheng-Xin Yong, Wei-Yin Ko, Daniel D’souza, Gbemileke¨ Onilude, Neel Bhandari, Shivalika Singh, Hui-Lee Ooi, Amr Kayid, Freddie Vargus, Phil Blunsom, Shayne Longpre, Niklas Muennighoff, Marzieh Fadaee, Julia Kreutzer, and Sara Hooker. 2024. Aya Model: An Instruction Finetuned Open-Access Multilingual Language Model.

# A Artifacts

<table><tr><td>Artifact</td><td>Public link</td></tr><tr><td>OLMoE-1B-7B</td><td>https://hf.co/allenai/OLMoE-1B-7B-0924</td></tr><tr><td>OLMoE-1B-7B-INSTRUCT</td><td>https://hf.co/allenai/OLMoE-1B-7B-0924-Instruct</td></tr><tr><td>OLMoE-1B-7B-SFT</td><td>https://hf.co/allenai/OLMoE-1B-7B-0924-SFT</td></tr><tr><td>OLMoE-Mix</td><td>https://hf.co/datasets/allenai/OLMoE-mix-0924</td></tr><tr><td>SFT data</td><td>https://hf.co/datasets/allenai/tulu-v3.1-mix-preview-4096-OLMoE</td></tr><tr><td>KTO/DPO data</td><td>https://hf.co/datasets/allenai/ultrafeedback_binarized_cleaned</td></tr><tr><td>Code</td><td>https://github.com/allenai/OLMoE</td></tr><tr><td>Logs</td><td>https://wandb.ai/ai2-llm/olmoe/reports/OLMoE-1B-7B-0924--Vmlldzo40TcyMjU3</td></tr><tr><td>BLOOM-7B</td><td>https://hf.co/bigscience/bloom-7b1</td></tr><tr><td>DeepSeekMoE-3B-16B</td><td>https://hf.co/deepseek-ai/deepseek-moe-16b-base</td></tr><tr><td>DeepSeekMoE-3B-16B+chat</td><td>https://hf.co/deepseek-ai/deepseek-moe-16b-chat</td></tr><tr><td>DeepSeekV2-2B-16B</td><td>https://hf.co/deepseek-ai/DeepSeek-V2-Lite</td></tr><tr><td>DCLM-1B</td><td>https://hf.co/TRI-ML/DCLM-1B</td></tr><tr><td>DCLM-7B</td><td>https://hf.co/TRI-ML/DCLM-7B</td></tr><tr><td>Falcon-7B</td><td>https://hf.co/tiiuae/falcon-7b</td></tr><tr><td>Gemma2-3B</td><td>https://hf.co/google/gemma-2-2b</td></tr><tr><td>Gemma2-9B</td><td>https://hf.co/google/gemma-2-9b</td></tr><tr><td>JetMoE-2B-9B</td><td>https://hf.co/jetmoe/jetmoe-8b</td></tr><tr><td>JetMoE-2B-9B+SFT</td><td>https://hf.co/jetmoe/jetmoe-8b-sft</td></tr><tr><td>JetMoE-2B-9B+Chat</td><td>https://hf.co/jetmoe/jetmoe-8b-chat</td></tr><tr><td>Llama-7B</td><td>https://hf.co/huggyllama/llama-7b</td></tr><tr><td>Llama2-7B</td><td>https://hf.co/meta-llama/Llama-2-7b-hf</td></tr><tr><td>Llama3.1-8B</td><td>https://hf.co/meta-llama/Meta-Llama-3.1-8B</td></tr><tr><td>MPT-7B</td><td>https://hf.co/mosaicml/mpt-7b</td></tr><tr><td>Mistral-7B</td><td>https://hf.co/mistralai/Mistral-7B-v0.1</td></tr><tr><td>Mixtral-8x7B</td><td>https://hf.co/mistralai/Mixtral-8x7B-v0.1</td></tr><tr><td>OLMo-1B (0724)</td><td>https://hf.co/allenai/OLMo-1B-0724-hf</td></tr><tr><td>OLMo-7B (0724)</td><td>https://hf.co/allenai/OLMo-7B-0724-hf</td></tr><tr><td>OpenMoE-3B-9B</td><td>https://hf.co/OrionZheng/openmoe-8b</td></tr><tr><td>Pythia-7B</td><td>https://hf.co/EleutherAI/pythia-6.9b</td></tr><tr><td>Qwen1.5-3B-14B</td><td>https://hf.co/Qwen/Qwen1.5-MoE-A2.7B</td></tr><tr><td>Qwen1.5-3B-14B+Chat</td><td>https://hf.co/Qwen/Qwen1.5-MoE-A2.7B-Chat</td></tr><tr><td>StableLM2-2B</td><td>https://hf.co/stabilityai/stablelm-2-1_6b</td></tr><tr><td>TinyLlama-1B</td><td>https://hf.co/TinyLlama/TinyLlama_v1.1</td></tr></table>

Table 9: All artifacts released and used in this work. We point from the name used for a given artifact in this work (e.g. Figure 1) to the URL where it can be obtained.

# B Training Configuration

Pretraining We display the pretraining hyperparameter configuration of OLMOE-1B-7B in Appendix B comparing with other relevant models. We follow Groeneveld et al. [65] using the AdamW optimizer [107] with ZeRO [142] via PyTorch FSDP [213] and mixed-precision training [116]. Our main model settings differing from Groeneveld et al. [65] are: (1) MoE-related changes: OLMOE-1B-7B is a sparsely activated decoder-only transformer [185] using dropless Mixtureof-Experts [58]. Unlike most prior MoEs, we use a high granularity [39, 86] with 64 small experts with an FFN dimension of just 1,024 rather than a few large experts. We further use two auxiliary losses: router z-loss [221] and load balancing loss [154]. (2) Stability improvements: (a) We use a truncated normal initialization with a standard deviation of 0.02 and a minimum (maximum) cut-off of -0.06 (0.06) corresponding to three standard deviations. (b) We use QK normalization [173, 113, 44]. (c) We use RMSNorm [208] instead of the non-parametric LayerNorm used in Groeneveld et al. [65]. (3) Performance improvements: Besides some of the stability improvements which also impact performance, we also reduce the AdamW epsilon to 1.0E-08 from the 1.0E-05 used in Groeneveld et al. [65] to speed up convergence. Finally, we train OLMOE-1B-7B for significantly longer than all prior OLMo models amounting to 5T tokens and thus more than one epoch (1.3) following Muennighoff et al. [121]. We shuffle the pretraining dataset before starting the second epoch. For the final 100B tokens, we decay the learning rate linearly from 5.0E-04 to 0. We experiment with many of these settings in §4.

Adaptation For finetuning we use Open Instruct [188, 76].8 We filter all SFT samples to a length of fewer than 4096 tokens to match the sequence length of the model. Following Muennighoff et al. [122], we aggregate loss at the token level during SFT to improve performance on long generative tasks, such as AlpacaEval. We finetune in BF16 with a global batch size of 128 (4 H100 nodes with 8 GPUs each, a per device batch size of 2, and 2 gradient accumulation steps). We train for 2 epochs with a constant learning rate of 2.0E-5. For DPO [138], we reduce the global batch size to 32 (4 H100 nodes with 8 GPUs each and a per device batch size of 1). We train for 3 epochs with a learning rate of 5.0E-7 and a DPO beta of 0.1. Our adapted models are built on top of our annealed checkpoint, and we include the load balancing loss during both SFT and DPO based on our experiments in §4.3. Our preference tuning recipe is heavily optimized for DPO based on extensive experiments by Ivison et al. [76], thus for KTO [54] we experiment with a few settings in Appendix F. Our final KTO adaptation uses the same hyperparameters as DPO, except that we use the RMSProp optimizer instead of Adam, which we use for SFT and DPO, and that we reduce the training duration to 1.3 epochs (5,000 steps) for KTO instead of the 3 epochs used for DPO.

Hardware We pretrain OLMOE-1B-7B on 256 H100 GPUs for approximately 10 days with NVlink interconnect across GPUs and InfiniBand interconnect across nodes. We also use H100 GPUs for all our experiments but some use a cluster with GCP TCPx interconnect across nodes instead. For adaptation, we use 32 H100 GPUs for 33 hours to instruction tune and for another 14 hours to preference tune via DPO. For KTO adaptation we use 8 H100 GPUs for 30 hours instead.

<table><tr><td></td><td>OLMoE-1B-7B</td><td>JetMoE</td><td>OpenMoE</td><td>OLMo-1B (0724)</td></tr><tr><td>Dimension</td><td>2,048</td><td>2,048</td><td>2,048</td><td>2,048</td></tr><tr><td>Activation</td><td>SwiGLU</td><td>SwiGLU</td><td>SwiGLU</td><td>SwiGLU</td></tr><tr><td>FFN dimension</td><td>1,024</td><td>5,632</td><td>8,192</td><td>8,192</td></tr><tr><td>Vocab size</td><td>50,304</td><td>32,000</td><td>256,384</td><td>50,304</td></tr><tr><td>Attn heads</td><td>16</td><td>16</td><td>24</td><td>16</td></tr><tr><td>Num layers</td><td>16</td><td>24</td><td>32</td><td>16</td></tr><tr><td>Layer norm type</td><td>RMSNorm</td><td>RMSNorm</td><td>RMSNorm</td><td>non-parametric</td></tr><tr><td>Layer norm eps</td><td>1.0E-05</td><td>1.0E-05</td><td>1.0E-06</td><td>1.0E-05</td></tr><tr><td>QK-Norm</td><td>yes</td><td>no</td><td>no</td><td>no</td></tr><tr><td>Pos emb.</td><td>RoPE</td><td>RoPE</td><td>RoPE</td><td>RoPE</td></tr><tr><td>RoPE θ</td><td>10,000</td><td>10,000</td><td>10,000</td><td>10,000</td></tr><tr><td>Attention variant</td><td>full</td><td>MoA</td><td>full</td><td>full</td></tr><tr><td>Biases</td><td>-</td><td>MLP &amp; Attn</td><td>-</td><td>-</td></tr><tr><td>Weight tying</td><td>no</td><td>yes</td><td>no</td><td>no</td></tr><tr><td>Init dist</td><td>trunc normal</td><td>?</td><td>?</td><td>normal</td></tr><tr><td>Init std</td><td>0.02</td><td>0.02</td><td>varies</td><td>varies</td></tr><tr><td>Init trunc</td><td>3×std</td><td>-</td><td>-</td><td>-</td></tr><tr><td>MoE layers</td><td>Every</td><td>Every</td><td>Every 6th</td><td>-</td></tr><tr><td>MoE layer type</td><td>dMoE</td><td>dMoE</td><td>ST-MoE</td><td>-</td></tr><tr><td># Experts</td><td>64</td><td>8</td><td>32</td><td>1</td></tr><tr><td># Activated</td><td>8</td><td>2</td><td>2</td><td>1</td></tr><tr><td># Vocab params</td><td>103M</td><td>66M</td><td>525M</td><td>103M</td></tr><tr><td># Active params</td><td>1.3B</td><td>2.2B</td><td>2.6B</td><td>1.3B</td></tr><tr><td># Total params</td><td>6.9B</td><td>8.5B</td><td>8.7B</td><td>1.3B</td></tr><tr><td>Sequence length</td><td>4,096</td><td>4,096</td><td>2,048</td><td>4,096</td></tr><tr><td>Batch size (samples)</td><td>1,024</td><td>1,024</td><td>2,048</td><td>512</td></tr><tr><td>Batch size (tokens)</td><td>~4M</td><td>~4M</td><td>~4M</td><td>~2M</td></tr><tr><td>warmup steps</td><td>2,500</td><td>2,500</td><td>10,000</td><td>2,000</td></tr><tr><td>peak LR</td><td>4.0E-04</td><td>5.0E-04</td><td>0.01</td><td>4.0E-04</td></tr><tr><td>minimum LR</td><td>4.0E-05</td><td>5.0E-05</td><td>-</td><td>4.0E-05</td></tr><tr><td>optimizer</td><td>AdamW</td><td>AdamW</td><td>Adafactor</td><td>AdamW</td></tr><tr><td>weight decay</td><td>0.1</td><td>0.1</td><td>0.0</td><td>0.1</td></tr><tr><td>beta1</td><td>0.9</td><td>?</td><td>0.9</td><td>0.9</td></tr><tr><td>beta2</td><td>0.95</td><td>?</td><td>-</td><td>0.95</td></tr><tr><td>AdamW epsilon</td><td>1.0E-08</td><td>?</td><td>-</td><td>1.0E-05</td></tr><tr><td>LR schedule</td><td>cosine</td><td>WSD</td><td>Inv Sq Root</td><td>cosine</td></tr><tr><td>gradient clipping</td><td>global 1.0</td><td>global 1.0</td><td>global 1.0</td><td>global 1.0</td></tr><tr><td>gradient reduce dtype</td><td>FP32</td><td>?</td><td>?</td><td>FP32</td></tr><tr><td>optimizer state dtype</td><td>FP32</td><td>?</td><td>?</td><td>FP32</td></tr><tr><td>LBL weight</td><td>0.01</td><td>0.01</td><td>0.01</td><td>-</td></tr><tr><td>Router z-loss weight</td><td>0.001</td><td>0.001</td><td>0.0001</td><td>-</td></tr><tr><td>Pretraining tokens</td><td>5,033B</td><td>1,000B</td><td>1,100B</td><td>2,000B</td></tr><tr><td>Annealing tokens</td><td>100B</td><td>250B</td><td>-</td><td>50B</td></tr><tr><td>Annealing schedule</td><td>linear</td><td>-</td><td>-</td><td>linear</td></tr><tr><td>Annealing min LR</td><td>0</td><td>-</td><td>-</td><td>0</td></tr></table>

Table 10: Pretraining hyperparameters of OLMOE-1B-7B and comparable models trained from scratch. We highlight rows where OLMOE-1B-7B differs from OLMo-1B. Active params include vocab params. “?” = undisclosed settings, FFN = feed-forward network, Attn = Attention, LR = learning rate, WSD = Weight-Stable-Decay [74], LBL = load balancing loss, Inv Sq Root = Inverse Square Root decay [155], trunc = truncation, std = standard deviation, “varies” = stds that are layer or weight-dependent.

# C Evaluation Setup

<table><tr><td rowspan="2">Dataset (↓)</td><td colspan="4">During pretraining</td><td colspan="4">After pretraining (OLMES [67])</td></tr><tr><td>Format</td><td>Shot</td><td>Norm</td><td>Split</td><td>Format</td><td>Shot</td><td>CF Norm</td><td>Split</td></tr><tr><td>ARC-C [34]</td><td>CF</td><td>0</td><td>char</td><td>val</td><td>max(MCF,CF)</td><td>5</td><td>pmi</td><td>test</td></tr><tr><td>ARC-E [34]</td><td>CF</td><td>0</td><td>none</td><td>val</td><td>max(MCF,CF)</td><td>5</td><td>char</td><td>test</td></tr><tr><td>BoolQ [33]</td><td>CF</td><td>0</td><td>none</td><td>val</td><td>max(MCF,CF)</td><td>5</td><td>none</td><td>val</td></tr><tr><td>COPA [63]</td><td>CF</td><td>0</td><td>none</td><td>val</td><td>-</td><td>-</td><td>-</td><td>-</td></tr><tr><td>CSQA [170]</td><td>CF</td><td>0</td><td>char</td><td>val</td><td>max(MCF,CF)</td><td>5</td><td>pmi</td><td>val</td></tr><tr><td>HellaSwag [207]</td><td>CF</td><td>0</td><td>char</td><td>val</td><td>max(MCF,CF)</td><td>5</td><td>char</td><td>val</td></tr><tr><td>MMLU [70]</td><td>MCF</td><td>5</td><td>none</td><td>val</td><td>max(MCF,CF)</td><td>5</td><td>char</td><td>test</td></tr><tr><td>MMLU Var</td><td>CF</td><td>0-5</td><td>char</td><td>val</td><td>-</td><td>-</td><td>-</td><td>-</td></tr><tr><td>OBQA [117]</td><td>CF</td><td>0</td><td>char</td><td>val</td><td>max(MCF,CF)</td><td>5</td><td>pmi</td><td>test</td></tr><tr><td>PIQA [20]</td><td>CF</td><td>0</td><td>char</td><td>val</td><td>max(MCF,CF)</td><td>5</td><td>char</td><td>val</td></tr><tr><td>SciQ [192]</td><td>CF</td><td>0</td><td>none</td><td>val</td><td>-</td><td>-</td><td>-</td><td>-</td></tr><tr><td>SocialIQA [150]</td><td>CF</td><td>0</td><td>char</td><td>val</td><td>max(MCF,CF)</td><td>5</td><td>char</td><td>val</td></tr><tr><td>Winogrande [148]</td><td>CF</td><td>0</td><td>none</td><td>val</td><td>max(MCF,CF)</td><td>5</td><td>none</td><td>val</td></tr></table>

Table 11: Summary of downstream evaluation during and after pretraining (OLMES). ARC-C and ARC-E refer to ARC-Challenge and -Easy, CSQA=CommonsenseQA, OBQA=OpenBookQA, CF=Completion/Cloze formulation, MCF=Multiple-choice formulation, pmi=pointwise-mutualinformation, char=per-character, Var=variants referring to the use of few-shots varying from 0-5.

During pretraining We evaluate using a similar in-loop evaluation setup as Groeneveld et al. [65], with the addition of more tasks such as CommonsenseQA, PIQA, and different implementations of MMLU. Following Groeneveld et al. [65], for the majority of the tasks, we perform 0-shot evaluation using the Completion/Cloze Formulation (CF), ranking each answer string using language model probabilities. In terms of probability normalization, there is either no normalization (none) or normalization by the number of characters in the answer (char) when ranking solely based on probability may heavily favor shorter answers [24]. For MMLU, the in-loop evaluation also includes a setup where we increase the total number of instances by including a range of 0-shot to 5-shot setups together as we found this provides smoother trends as the training proceeds (“MMLU Var”). We also include the Multiple-Choice Formulation (MCF) version of MMLU, scoring prediction of answer labels like A/B/C/D, which generally starts to rise only later in training as models only gain the multiple-choice capability later (at around 1T tokens for OLMOE-1B-7B in Figure 25). We also evaluate perplexity on selected validation sets from Paloma [111, 144, 59, 163, 96, 115]. All code used for evaluation during pretraining is at https://github.com/allenai/OLMo/tree/ 61ac104d616ec5435db225796e5c7532c9abd95a/olmo/eval.

After pretraining - OLMES We perform evaluations following the OLMES evaluation standard [67], with the suite of tasks in the original paper. OLMES (Open Language Model Evaluation Standard) is a standard for reproducible LM evaluations that is open, practical, and documented, providing recommendations guided by experiments and results from the literature [19, 60, 64]. It is designed to support comparisons between smaller base models that require the Cloze formulation of multiple-choice questions against larger models that can utilize the Multiple-choice formulation. To make our evaluations reproducible, we follow OLMES in prompt formatting, choice of in-context examples, probability normalization, task formulation, as well as all other details. We summarize this setup in Table 4 and refer to Gu et al. [67] for more details.

After pretraining - DCLM For results on the DCLM tasks [90] in Table 13, we precisely follow their setup using the evaluation code released by the authors at https://github.com/ mlfoundations/dclm. “Core” results are the low variance tasks in their evaluation code, while “Extended” corresponds to the heavy tasks.

After adaptation After supervised finetuning and direct preference optimization, we evaluate models using a subset of the evaluations and the same overall setup used in Ivison et al. [76] and Wang et al. [188]. We cover a wide range of model capabilities in our evaluation suite including coding (HumanEval [28]), general and mathematical reasoning (Big Bench Hard [169], GSM8k [35]), world knowledge (MMLU), general instruction following (AlpacaEval 1.0 [93], not the length-controlled variant [51]), precise instruction following (IFEval [217]) and safety (XSTest [147]). We refer to Wang et al. [188] for more details on each benchmark.

# D Openness of Models

We list the openness of various models summarized in Figure 1. We exclude Switch Transformers [56], as it was published over three years ago and is very different from more recent MoE models (MLM objective, Encoder-decoder, etc.).

# Grok-86B-314B [196]

Model: Their model is licensed under the open-source Apache 2.0 license.   
• Data: Unavailable.   
• Code: Unavailable.   
• Logs: Unavailable.

# Mixtral-39B-141B and Mixtral-13B-42B [79]

• Model: Their model is licensed under the open-source Apache 2.0 license.   
• Data: Unavailable.   
• Code: Unavailable.   
• Logs: Unavailable.

# DBRX-36B-132B [40]

• Model: The model is licensed under a custom non-open-source license9 with additional 10 use-case restrictions.   
• Data: Unavailable.   
• Code: They use closed-source custom adaptations of their public libraries LLMfoundry, composer, and megablocks.   
• Logs: Unavailable.

# Skywork-MoE-22B-146B [191]

• Model: The model is licensed under a custom non-open-source license. 12   
• Data: Unavailable.   
• Code: Unavailable.   
• Logs: Unavailable.

# DeepSeekV2-21B-236B [43] and DeepSeekMoE-3B-14B [39]

• Model: The models are licensed under custom non-open-source licenses. 13

• Data: Unavailable.   
• Code: Unavailable.   
• Logs: Unavailable.

# Arctic-17B-480B [162]

• Model: The model is licensed under the open-source Apache 2.0 license.   
• Data: They describe their mixture but do not release it.14   
• Code: Unavailable.   
• Logs: Unavailable.

# Qwen2-14B-57B [180]

• Model: The model is licensed under the open-source Apache 2.0 license.   
• Data: Unavailable.   
• Code: Unavailable.   
• Logs: Unavailable.

# Jamba-12B-52B [97]

• Model: The model is licensed under the open-source Apache 2.0 license.   
• Data: Unavailable.   
• Code: Unavailable.   
• Logs: Unavailable.

# Qwen1.5-3B-14B [180]

• Model: The model is licensed under a custom non-open-source license. 15   
• Data: Unavailable.   
• Code: Unavailable.   
• Logs: Unavailable.

# JetMoE-2B-9B [158]

• Model: The model is licensed under the open-source Apache 2.0 license.   
• Data: They describe their mixture but do not release it.   
Code: They make their fork of megablocks publicly available,16 however, their 17 Megatron-LM training code is not available.   
• Logs: Unavailable.

# OpenMoE-2B-9B [199]

• Model: The model is licensed under the open-source Apache 2.0 license.   
• Data: They make scripts for recreating their data available.   
Code: They make their code available.18   
• Logs: Unavailable.

# OLMOE-1B-7B

Model: The model is licensed under the open-source Apache 2.0 license.   
Data: The data is licensed under the open-source ODC-By 1.0 license.   
Code: The code is licensed under the open-source Apache 2.0 license.   
• Logs: Logs are available with the same open-source license as the code (Apache 2.0).

# E Additional Evaluation

![](images/81e6507e1697f3f453941a243192786ab32e5cc8a4d5166367978560bbb3ec74.jpg)  
Figure 24: Losses of OLMOE-1B-7B during training. The Books, Reddit, and Stack [84] datasets are from Dolma 1.7 [163] via Paloma [111]. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/Plot-OLMoE-1B-7B--Vmlldzo4OTcyMjU3

![](images/210fcb076658496d609cc13127510d3f2425b71b68239667514ad167c2b43e84.jpg)  
Figure 25: Evaluation of OLMOE-1B-7B and the current best OLMo models during pretraining. Grey vertical lines correspond to where the respective run enters annealing with the 1st line being for OLMo-7B, the 2nd for OLMo-1B, and the third for OLMOE-1B-7B. Figure 3 is a version of this plot with training FLOPs as the xaxis. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/ Plot-OLMoE-1B-7B-vs-OLMo-7B-vs-OLMo-1B--Vmlldzo4OTcyMjEz

<table><tr><td>Model</td><td>ARC_C</td><td>ARC_E</td><td>BoolQ</td><td>CSQA</td><td>HSwag</td><td>MMLU</td><td>OBQA</td><td>PIQA</td><td>SIQA</td><td>WinoG</td><td>Avg</td></tr><tr><td colspan="12">LMs with ~7-9B active parameters</td></tr><tr><td>Mistral-7B</td><td>78.6†</td><td>90.8†</td><td>89.3</td><td>72.4†</td><td>83.0</td><td>64.0†</td><td>80.6†</td><td>82.8</td><td>71.3†</td><td>77.9</td><td>79.1</td></tr><tr><td>OLMo-7B (0724)</td><td>68.0†</td><td>85.7†</td><td>85.3</td><td>85.4†</td><td>80.5</td><td>54.9†</td><td>67.6†</td><td>79.3</td><td>76.1†</td><td>73.2</td><td>75.6</td></tr><tr><td>DCLM-7B</td><td>79.8†</td><td>92.3†</td><td>87.0</td><td>77.0</td><td>82.3</td><td>64.4†</td><td>79.6†</td><td>80.1</td><td>71.2†</td><td>77.3</td><td>79.1</td></tr><tr><td>Llama2-7B</td><td>54.2</td><td>84.0</td><td>86.1</td><td>74.2</td><td>78.9</td><td>46.2†</td><td>57.8</td><td>77.5</td><td>59.6</td><td>71.7</td><td>69.0</td></tr><tr><td>Llama3.1-8B</td><td>79.5†</td><td>91.7†</td><td>88.5</td><td>74.3†</td><td>81.6</td><td>66.9†</td><td>78.6†</td><td>81.1</td><td>71.4†</td><td>76.6</td><td>79.0</td></tr><tr><td>Gemma2-9B</td><td>89.5†</td><td>95.5†</td><td>89.4</td><td>78.8†</td><td>87.3†</td><td>70.6†</td><td>88.4†</td><td>86.1†</td><td>76.0†</td><td>78.8</td><td>84.0</td></tr><tr><td colspan="12">LMs with ~2-3B active parameters</td></tr><tr><td>StableLM-2B</td><td>50.6†</td><td>75.3</td><td>82.3</td><td>70.4†</td><td>70.3</td><td>40.4†</td><td>56.6†</td><td>75.6</td><td>64.3†</td><td>65.8</td><td>65.1</td></tr><tr><td>Gemma2-3B</td><td>67.5†</td><td>84.3†</td><td>83.6</td><td>66.4†</td><td>74.6</td><td>53.3†</td><td>68.8†</td><td>78.5</td><td>64.7†</td><td>71.8</td><td>71.4</td></tr><tr><td>JetMoE-2B-9B</td><td>61.4†</td><td>81.9†</td><td>85.7</td><td>75.3†</td><td>81.7</td><td>49.1†</td><td>68.0†</td><td>80.3</td><td>71.3†</td><td>70.7</td><td>72.5</td></tr><tr><td>OpenMoE-3B-9B</td><td>29.3</td><td>50.6</td><td>63.2</td><td>21.5</td><td>44.4</td><td>27.4</td><td>34.6</td><td>63.3</td><td>42.9</td><td>51.9†</td><td>42.9</td></tr><tr><td>DeepSeek-3B-16B</td><td>53.4</td><td>82.7</td><td>81.9</td><td>72.7</td><td>80.4</td><td>45.5†</td><td>58.4</td><td>80.1</td><td>59.9</td><td>73.2</td><td>68.8</td></tr><tr><td>DeepSeekV2-2B-16B</td><td>74.0†</td><td>88.9†</td><td>84.7</td><td>73.8</td><td>81.9</td><td>58.8†</td><td>72.4†</td><td>80.2</td><td>69.1†</td><td>74.0</td><td>75.8</td></tr><tr><td>Llama3.2-3B</td><td>69.6†</td><td>85.1†</td><td>78.3</td><td>69.0</td><td>77.0</td><td>57.8†</td><td>67.2†</td><td>77.4</td><td>64.9†</td><td>69.9</td><td>71.6</td></tr><tr><td>Qwen1.5-3B-14B</td><td>77.4†</td><td>91.6†</td><td>85.0</td><td>81.4†</td><td>80.0</td><td>62.4†</td><td>80.6†</td><td>81.0</td><td>74.1†</td><td>72.3</td><td>78.6</td></tr><tr><td colspan="12">LMs with ~1B active parameters</td></tr><tr><td>OLMo-1B (0724)</td><td>36.4</td><td>53.5</td><td>66.8</td><td>42.4</td><td>67.5</td><td>32.1</td><td>44.2</td><td>74.0</td><td>45.2</td><td>62.9</td><td>52.5</td></tr><tr><td>TinyLlama-1B</td><td>38.1</td><td>69.5</td><td>63.6</td><td>61.1</td><td>60.8</td><td>33.6</td><td>45.0</td><td>71.7</td><td>50.4</td><td>60.1</td><td>55.4</td></tr><tr><td>Pythia-1B</td><td>31.4</td><td>63.4</td><td>56.8†</td><td>50.9</td><td>48.0</td><td>31.1</td><td>40.4</td><td>68.9</td><td>46.4</td><td>52.7</td><td>49.0</td></tr><tr><td>Llama3.2-1B</td><td>43.5</td><td>71.6</td><td>69.4</td><td>59.6</td><td>67.3</td><td>38.2</td><td>42.0</td><td>73.7</td><td>52.0</td><td>62.5</td><td>58.0</td></tr><tr><td>Zamba2-1B</td><td>55.0†</td><td>85.4</td><td>76.1</td><td>70.1</td><td>73.4</td><td>44.73†</td><td>59.8†</td><td>76.6</td><td>58.4</td><td>67.2</td><td>66.7</td></tr><tr><td>DCLM-1B</td><td>57.6†</td><td>79.5</td><td>80.9</td><td>71.3</td><td>75.1</td><td>48.5†</td><td>60.0†</td><td>76.6</td><td>60.5†</td><td>68.1</td><td>67.8</td></tr><tr><td>OLMoE-1B-7B</td><td>62.1†</td><td>84.2</td><td>79.2</td><td>72.9</td><td>80.0</td><td>54.1†</td><td>65.4†</td><td>79.8</td><td>63.0†</td><td>70.2</td><td>71.1</td></tr></table>

Table 12: More results on OLMES. † indicates use of the MCF score, see Appendix C. See Table 4 for details on naming and a summary of these results.

<table><tr><td>OLMoE-1B-7B checkpoint (→)</td><td>step 1,200,000</td><td>step 1,220,000</td><td>annealed</td><td>OLMo-1B</td><td>OLMo-7B</td></tr><tr><td>AGI Eval LSAT-AR*</td><td>24.3</td><td>26.5</td><td>28.7</td><td>28.3</td><td>28.3</td></tr><tr><td>AGI Eval LSAT-LR</td><td>40.2</td><td>38.6</td><td>37.3</td><td>30.2</td><td>42.9</td></tr><tr><td>AGI Eval LSAT-RC</td><td>47.4</td><td>43.7</td><td>46.6</td><td>23.5</td><td>61.6</td></tr><tr><td>AGI Eval SAT-En</td><td>55.3</td><td>54.9</td><td>52.9</td><td>28.2</td><td>73.8</td></tr><tr><td>AGI Eval SAT-Math CoT</td><td>5.5</td><td>4.1</td><td>6.4</td><td>1.8</td><td>6.8</td></tr><tr><td>AQuA CoT</td><td>2.4</td><td>2.9</td><td>2.0</td><td>2.9</td><td>6.1</td></tr><tr><td>ARC Challenge*</td><td>53.3</td><td>53.4</td><td>53.8</td><td>34.6</td><td>48.1</td></tr><tr><td>ARC Easy*</td><td>77.1</td><td>78.5</td><td>77.7</td><td>64.4</td><td>75.9</td></tr><tr><td>BBQ</td><td>49.8</td><td>48.3</td><td>50.6</td><td>45.8</td><td>67.2</td></tr><tr><td>BigBench CS Algorithms*</td><td>47.1</td><td>50.2</td><td>47.2</td><td>47.5</td><td>53.6</td></tr><tr><td>BigBench Conceptual Combinations</td><td>51.5</td><td>50.5</td><td>56.3</td><td>31.1</td><td>68.0</td></tr><tr><td>BigBench Conlang Translation</td><td>3.7</td><td>6.1</td><td>7.3</td><td>4.3</td><td>7.3</td></tr><tr><td>BigBench Dyck Languages*</td><td>19.3</td><td>15.9</td><td>21.5</td><td>26.6</td><td>22.2</td></tr><tr><td>BigBench Elementary Math QA</td><td>26.2</td><td>27.0</td><td>26.9</td><td>26.2</td><td>30.4</td></tr><tr><td>BigBench Language Identification*</td><td>31.9</td><td>34.0</td><td>31.0</td><td>27.0</td><td>39.1</td></tr><tr><td>BigBench Logical Deduction</td><td>26.6</td><td>25.3</td><td>24.6</td><td>23.6</td><td>27.3</td></tr><tr><td>BigBench Misconceptions</td><td>59.8</td><td>55.3</td><td>62.6</td><td>55.7</td><td>58.0</td></tr><tr><td>BigBench Novel Concepts</td><td>62.5</td><td>62.5</td><td>65.6</td><td>43.8</td><td>53.1</td></tr><tr><td>BigBench Operators*</td><td>36.2</td><td>34.3</td><td>33.8</td><td>23.8</td><td>45.2</td></tr><tr><td>BigBench QA Wikidata*</td><td>68.2</td><td>68.8</td><td>69.2</td><td>67.0</td><td>69.9</td></tr><tr><td>BigBench Repeat Copy Logic*</td><td>15.6</td><td>15.6</td><td>18.8</td><td>3.1</td><td>9.4</td></tr><tr><td>BigBench Strange Stories</td><td>66.7</td><td>68.4</td><td>69.5</td><td>53.4</td><td>66.1</td></tr><tr><td>BigBench Strategy QA</td><td>56.2</td><td>58.1</td><td>57.0</td><td>51.5</td><td>68.6</td></tr><tr><td>BigBench Understanding Fables</td><td>47.1</td><td>44.4</td><td>47.6</td><td>28.0</td><td>61.4</td></tr><tr><td>BoolQ*</td><td>73.3</td><td>72.8</td><td>73.2</td><td>63.7</td><td>83.9</td></tr><tr><td>COPA*</td><td>81.0</td><td>80.0</td><td>78.0</td><td>75.0</td><td>77.0</td></tr><tr><td>CoQA*</td><td>43.7</td><td>44.4</td><td>43.7</td><td>3.4</td><td>45.4</td></tr><tr><td>CommonsenseQA*</td><td>67.2</td><td>67.0</td><td>69.3</td><td>19.6</td><td>86.0</td></tr><tr><td>Enterprise PII Classification</td><td>52.3</td><td>53.7</td><td>52.2</td><td>57.3</td><td>50.6</td></tr><tr><td>GPQA Diamond</td><td>22.2</td><td>21.2</td><td>19.7</td><td>19.7</td><td>20.2</td></tr><tr><td>GPQA Main</td><td>24.8</td><td>22.3</td><td>22.5</td><td>20.3</td><td>23.0</td></tr><tr><td>GSM8K CoT</td><td>6.4</td><td>7.4</td><td>7.4</td><td>4.9</td><td>30.6</td></tr><tr><td>HellaSwag 0-shot*</td><td>76.0</td><td>76.0</td><td>77.0</td><td>65.8</td><td>76.7</td></tr><tr><td>HellaSwag 10-shot*</td><td>77.6</td><td>77.5</td><td>78.6</td><td>66.3</td><td>78.9</td></tr><tr><td>Jeopardy*</td><td>48.8</td><td>48.7</td><td>50.3</td><td>22.6</td><td>46.5</td></tr><tr><td>LAMBADA*</td><td>72.7</td><td>72.2</td><td>73.3</td><td>61.1</td><td>71.8</td></tr><tr><td>LogiQA</td><td>34.9</td><td>34.3</td><td>34.6</td><td>28.7</td><td>31.0</td></tr><tr><td>MMLU Few-shot</td><td>52.2</td><td>51.9</td><td>53.3</td><td>28.4</td><td>55.1</td></tr><tr><td>MMLU Zero-shot</td><td>41.6</td><td>42.7</td><td>43.3</td><td>26.2</td><td>50.0</td></tr><tr><td>Math QA</td><td>26.4</td><td>27.1</td><td>27.5</td><td>24.1</td><td>29.8</td></tr><tr><td>OpenBookQA*</td><td>41.4</td><td>44.0</td><td>44.8</td><td>36.6</td><td>43.4</td></tr><tr><td>PIQA*</td><td>81.3</td><td>81.2</td><td>82.0</td><td>76.4</td><td>81.7</td></tr><tr><td>PubMedQA</td><td>56.1</td><td>46.6</td><td>57.9</td><td>0.2</td><td>57.9</td></tr><tr><td>SQuAD*</td><td>52.9</td><td>52.4</td><td>52.4</td><td>0.0</td><td>65.5</td></tr><tr><td>SVAMP CoT</td><td>30.0</td><td>28.0</td><td>33.0</td><td>14.3</td><td>44.7</td></tr><tr><td>Simple Arithmetic, no spaces</td><td>17.6</td><td>18.1</td><td>20.1</td><td>1.2</td><td>15.3</td></tr><tr><td>Simple Arithmetic, with spaces</td><td>19.5</td><td>20.6</td><td>22.1</td><td>1.8</td><td>16.0</td></tr><tr><td>Social IQA</td><td>71.5</td><td>70.7</td><td>69.3</td><td>69.5</td><td>84.4</td></tr><tr><td>Trivia QA</td><td>54.2</td><td>53.0</td><td>55.9</td><td>25.1</td><td>51.8</td></tr><tr><td>Winogender Female</td><td>50.0</td><td>46.7</td><td>50.0</td><td>41.7</td><td>58.3</td></tr><tr><td>Winogender Male</td><td>55.0</td><td>58.3</td><td>60.0</td><td>63.3</td><td>58.3</td></tr><tr><td>Winograd*</td><td>82.8</td><td>83.2</td><td>84.6</td><td>79.9</td><td>83.2</td></tr><tr><td>Winogrande*</td><td>68.0</td><td>68.5</td><td>69.0</td><td>61.8</td><td>67.6</td></tr><tr><td>Core</td><td>46.3</td><td>46.5</td><td>47.2</td><td>30.2</td><td>49.8</td></tr><tr><td>Extended</td><td>31.3</td><td>30.9</td><td>32.5</td><td>16.9</td><td>37.0</td></tr></table>

Table 13: DCLM evaluation metrics on the Core and Extended task subsets [90]. =Core tasks. “annealed” is the final pretraining checkpoint we use for OLMOE-1B-7B and was annealed from the checkpoint at step 1,200,000. We left the non-annealing pretraining run train a little longer resulting in the 1,220,000 checkpoint.

# F Additional Experiments

![](images/1185bbb162fce7c4c70955c5a144d6f7483614bd994146127f22d3c6bf0c6a2e.jpg)  
Figure 26: Adding Reddit or FLAN to OLMOE-MIX. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/ Plot-Adding-Reddit-FLAN--Vmlldzo4OTg1NTg4

Adding Reddit or FLAN to OLMOE-MIX In Figure 26 we benchmark adding the Reddit or FLAN [190] subsets of Dolma 1.7 [163] to our pretraining data mix (§2). Overall, we do not find either one to lead to consistent gains, thus we do not use them in our final data mix.

Load balancing precision Fedus et al. [56] selectively perform operations related to routing in full precision (FP32) to improve stability. In Figure 27, we test whether computing the load balancing loss in full precision improves stability, but do not find it to reduce spikes. Thus, we stick with bfloat16 (BF16).

Noise upcycling For the creation of Qwen2-MoE [201, 180, 13], the authors add 50% of gaussian noise to feedforward networks before continuing training in an upcycled setup [85]. Komatsuzaki et al. [85] also report that they experimented with adding noise but did not find it beneficial. In Figure 28, we experiment with regular upcycling versus adding noise by randomly replacing 50% of each MLP with numbers drawn from a normal distribution with a standard deviation of 0.02 following. We find that after 700 billion tokens, the no noise variant still performs slightly better but both appear to converge to the same performance. If training further, it is possible that the noise variant eventually outperforms the no noise variant, but at that point, it may make more sense to just train the MoE from scratch (§4.1.5).

![](images/efbbfcd2eec1c020842d0e06f6ee9034de6b9f5d1e8faae4d08ed86bba1e5e5b.jpg)

<details>
<summary>line</summary>

| Step | Performance |
| ---- | ----------- |
| 10   | 5.0         |
| 40   | 4.0         |
| 70   | 5.0         |
| 100  | 5.0         |
| 130  | 5.0         |
</details>

![](images/1013040ee7b04586aa018300339089a50abcd3649548ab35e9623f76d8fbf727.jpg)

<details>
<summary>line</summary>

| Step | Validation Loss (C4) |
| ---- | -------------------- |
| 10   | 2.7                  |
| 40   | 2.9                  |
| 100  | 2.7                  |
| 130  | 2.7                  |
</details>

![](images/2c42113ff847425f002defd4369c59364091584cb2092da2e2b897d1f0eee918.jpg)

<details>
<summary>line</summary>

| x  | Line 1 | Line 2 |
|----|--------|--------|
| 10 | 63.0   | 62.0   |
| 40 | 62.0   | 61.0   |
| 70 | 63.0   | 62.0   |
| 100| 64.0   | 63.0   |
| 130| 65.0   | 64.0   |
</details>

![](images/f7b828cd2fd4241533b249b8521b76527b89e70c42d907d2e10d0dd753ead754.jpg)

<details>
<summary>line</summary>

| x  | BF16 | FP32 |
|----|------|------|
| 10 | 32.5 | 32.0 |
| 40 | 31.0 | 28.0 |
| 70 | 33.0 | 32.5 |
| 100| 32.0 | 32.5 |
| 130| 32.5 | 32.0 |
</details>

Tokens (B)

Figure 27: Load balancing precision. More results, logs, and configurations: https://wandb. ai/ai2-llm/olmoe/reports/Plot-FP32-LBL--Vmlldzo4NDMxNDA4   
![](images/ca16ca725ce3276487874e281ad888e972c92c8e601c008513f43a6a219565b4.jpg)

<details>
<summary>line</summary>

| Step | Performance (Pink) | Performance (Blue) |
|------|--------------------|--------------------|
| 10   | 2.5                | 8.5                |
| 250  | 8.0                | 7.0                |
| 500  | 7.5                | 8.0                |
| 750  | 8.0                | 7.5                |
</details>

![](images/43c04a972935ce103ff846484e13bb86918b0490805fe311977ee7694fabbf83.jpg)

<details>
<summary>line</summary>

| Step | Validation Loss (C4) |
| ---- | -------------------- |
| 10   | 3.25                 |
| 250  | 2.75                 |
| 500  | 2.75                 |
| 750  | 2.75                 |
</details>

![](images/efde32f6376f382a23a7cbaefa2a8d410d8eb474d6abd1b25c70325afa19bbd3.jpg)

<details>
<summary>line</summary>

| Step | No noise | Noise |
| ---- | -------- | ----- |
| 10   | 60       | 40    |
| 250  | 60       | 60    |
| 500  | 60       | 60    |
| 750  | 60       | 60    |
</details>

![](images/637bddf99ecc86509157846ba0dd21a0a423ea14db45ed03998dadf0b6a318ee.jpg)

<details>
<summary>line</summary>

| Step | MMLU Var (Pink Line) | MMLU Var (Blue Line) |
|------|----------------------|----------------------|
| 10   | ~32                  | ~28                  |
| 250  | ~33                  | ~30                  |
| 500  | ~34                  | ~32                  |
| 750  | ~34                  | ~33                  |
</details>

Figure 28: Adding noise to the upcycled checkpoint. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/ Plot-Noise-upcycle---Vmlldzo4NDA3MzI2

![](images/a27f0f8d1397f7664a8cc4062cdca4935a5eef8e5e4f5a629c4213aae452eedb.jpg)

<details>
<summary>line</summary>

| Step | Performance |
| ---- | ----------- |
| 0    | 9.0         |
| 50   | 3.0         |
| 150  | 2.5         |
| 250  | 2.5         |
</details>

![](images/2870a29a98898d4a51bcff0b98505e20f4aa6ba63f2f44b0d96ed56e713c08d4.jpg)

<details>
<summary>line</summary>

| Step | Validation Loss (C4) |
| ---- | -------------------- |
| 0    | 3.4                  |
| 50   | 3.0                  |
| 150  | 2.9                  |
| 250  | 2.8                  |
</details>

![](images/a90fb008ac90dc9157e363dd44257993540e2b542f378031bfca1059cd25a5b1.jpg)

<details>
<summary>line</summary>

| Step | Dense | Layer-shared MoE |
| ---- | ----- | ---------------- |
| 0    | 25    | 25               |
| 50   | 45    | 40               |
| 150  | 50    | 48               |
| 250  | 52    | 50               |
</details>

![](images/c781e15abb123be8345f70c03838f7326fe13cfab527ba4b95996b91160f5ba8.jpg)

<details>
<summary>line</summary>

| x    | MMLU Var (Line 1) | MMLU Var (Line 2) |
| ---- | ----------------- | ----------------- |
| 0    | 25.0              | 25.0              |
| 50   | 28.0              | 27.5              |
| 100  | 29.0              | 28.5              |
| 150  | 29.5              | 29.0              |
| 200  | 30.0              | 29.5              |
| 250  | 30.5              | 30.0              |
</details>

Tokens (B)   
Figure 29: Sharing the same MoE across layers versus a regular dense LM. The number of experts in the MoE is equivalent to its number of layers. Thus, because the MoE is shared across layers, it has the same number of total and active parameters as the dense model. More results, logs, and configurations: https://wandb.ai/ai2-llm/olmoe/reports/ Plot-Shared-vs-Dense--Vmlldzo4NDI0MTc5

Shared Layer Some work has investigated Mixture-of-Experts with weights shared across layers in the context of Universal Transformers [171, 37, 45]. We test whether layer-shared Mixture-of-Experts can beat non-shared dense models in Figure 29. The layer-shared MoE uses a load balancing loss that is applied at the model level rather than at the layer level. This gives the model more flexibility by allowing it to completely deactivate certain experts for some layers and even emulate a dense model by always activating one separate expert for each layer. This makes it a generalization of the dense model which motivated our hypothesis that it may perform better than the dense model. However, in practice, we find that both perform similarly with the regular dense models even maintaining a small advantage on validation loss and HellaSwag. One possible advantage of layer-shared MoEs is that they can allow for better load balancing at inference. If prompts come in continuously, then newly incoming prompts can be batched with previous prompts that have already passed through several layers and sent through the MoE module together, as the MoE module is the same regardless of whether it is the first or last layer. Sharing also reduces throughput by around 20% during training, which further motivates our decision not to use it for OLMOE-1B-7B.

KTO experiments In Table 14 we experiment with the number of steps (5,000 vs. 10,000) and the optimizer (Adam [83] vs. RMS) used for KTO [54]. Based on these experiments we use the RMS optimizer and the checkpoint at 5,000 steps in §4.3.

<table><tr><td>Task (→)</td><td>MMLU</td><td>GSM8k</td><td>BBH</td><td>Human-Eval</td><td>Alpaca-Eval 1.0</td><td>XSTest</td><td>IFEval</td><td>Avg</td></tr><tr><td>Setup (→)</td><td>0-shot</td><td>8-shot CoT</td><td>0-shot</td><td>0-shot</td><td>0-shot</td><td>0-shot</td><td>0-shot</td><td>0-shot</td></tr><tr><td>Metric (→)</td><td>EM</td><td>EM</td><td>EM</td><td>Pass@10</td><td>%win</td><td>F1</td><td>Loose Acc</td><td></td></tr><tr><td>KTO, 5,000 steps, RMS</td><td>51.2</td><td>45.5</td><td>34.1</td><td>57.1</td><td>81.6</td><td>86.6</td><td>47.5</td><td>57.7</td></tr><tr><td>KTO, 10,000 steps, RMS</td><td>51.0</td><td>41.0</td><td>34.7</td><td>53.8</td><td>81.0</td><td>62.3</td><td>47.5</td><td>54.2</td></tr><tr><td>KTO, 5,000 steps, Adam</td><td>51.2</td><td>42.0</td><td>35.3</td><td>55.6</td><td>81.0</td><td>84.5</td><td>46.6</td><td>56.0</td></tr><tr><td>KTO, 10,000 steps, Adam</td><td>51.0</td><td>43.0</td><td>34.1</td><td>54.9</td><td>79.7</td><td>62.7</td><td>47.5</td><td>53.3</td></tr></table>

Table 14: KTO adaptation experiments. 5,000 and 10,000 steps correspond to 1.3 and 2.6 epochs on our adaptation dataset (§2), respectively.

G Additional Analysis   
![](images/c5da6b81c2cb52b94b1c43827e00c2381d20e91f85de532c6cba93c855fa51be.jpg)

<details>
<summary>line</summary>

| Layer ID | Vocabulary specialization (%) |
| -------- | ------------------------------ |
| 0        | 97.0                           |
| 1        | 97.5                           |
| 2        | 98.0                           |
| 3        | 97.5                           |
| 4        | 97.0                           |
| 5        | 96.5                           |
| 6        | 97.5                           |
| 7        | 96.0                           |
| 8        | 96.5                           |
| 9        | 97.0                           |
| 10       | 97.5                           |
| 11       | 97.0                           |
| 12       | 96.5                           |
| 13       | 96.0                           |
| 14       | 95.5                           |
| 15       | 95.0                           |
</details>

![](images/fa94a123f734a61b39a555bdfc70b568105d46ecd39415899216bdc2fddd2b70.jpg)

<details>
<summary>bar</summary>

| Expert ID | Input token ID | Predicted output token ID | Ground-truth output token ID |
| --------- | -------------- | ------------------------- | ---------------------------- |
| 0         | 100            | 90                        | 85                           |
| 1         | 100            | 85                        | 78                           |
| 2         | 100            | 100                       | 85                           |
| 3         | 100            | 90                        | 80                           |
| 4         | 100            | 90                        | 88                           |
| 5         | 100            | 80                        | 75                           |
| 6         | 100            | 90                        | 80                           |
| 7         | 100            | 90                        | 90                           |
| 8         | 100            | 90                        | 80                           |
| 27        | 100            | 90                        | 85                           |
| 37        | 100            | 90                        | 80                           |
| 58        | 100            | 80                        | 80                           |
</details>

Figure 30: Vocabulary specialization for OLMOE-1B-7B when considering all 8 activated experts. Equivalent to $k = 8$ in Equation 8.

![](images/de76b5ff27478797eceb55510a55cf13fe1fdcb4cdf74b90031e1f415b0c2081.jpg)

<details>
<summary>line</summary>

| Layer ID | Vocabulary specialization (%) |
| -------- | ----------------------------- |
| 0        | 75                            |
| 1        | 82                            |
| 2        | 87                            |
| 3        | 88                            |
| 4        | 91                            |
| 5        | 91                            |
| 6        | 86                            |
| 7        | 84                            |
| 8        | 82                            |
| 9        | 81                            |
| 10       | 84                            |
| 11       | 89                            |
| 12       | 85                            |
| 13       | 81                            |
| 14       | 83                            |
| 15       | 84                            |
| 16       | 85                            |
| 17       | 86                            |
| 18       | 86                            |
| 19       | 86                            |
| 20       | 85                            |
| 21       | 83                            |
| 22       | 82                            |
| 23       | 83                            |
| 24       | 82                            |
| 25       | 83                            |
| 26       | 83                            |
| 27       | 84                            |
| 28       | 85                            |
| 29       | 87                            |
| 30       | 88                            |
| 31       | 83                            |
</details>

![](images/60eb9c72827276b24eee4b5c3c15827f3b15d39625cb4c35a603691a317f1fe5.jpg)

<details>
<summary>bar</summary>

| Expert ID | Input token ID | Predicted output token ID | Ground-truth output token ID |
| --------- | -------------- | ------------------------- | ---------------------------- |
| 0         | 85             | 70                        | 65                           |
| 1         | 85             | 70                        | 65                           |
| 2         | 85             | 70                        | 65                           |
| 3         | 85             | 70                        | 65                           |
| 4         | 85             | 70                        | 65                           |
| 5         | 85             | 70                        | 65                           |
| 6         | 85             | 70                        | 65                           |
| 7         | 85             | 70                        | 65                           |
</details>

Figure 31: Vocabulary specialization for Mixtral-8x7B when considering all 2 activated experts. Equivalent to $k = 2$ in Equation 8.

![](images/a589a7b1bdd4c4d23b2891bc06ecbf082a7f95ebf0e6fd3da7cd19a9a20b3e2a.jpg)

<details>
<summary>bar_line</summary>

| Dataset  | Expert | Frequency (normalized %) |
|----------|--------|---------------------------|
| GitHub   | 0      | 40                        |
| GitHub   | 100    | 12                        |
| arXiv    | 0      | 8                         |
| arXiv    | 100    | 15                        |
| C4       | 0      | 8                         |
| C4       | 100    | 45                        |
| Books    | 0      | 10                        |
| Books    | 100    | 45                        |
| Books    | 200    | 10                        |
| Books    | 300    | 15                        |
| Books    | 400    | 10                        |
| Books    | 500    | 5                         |
| Books    | 600    | 10                        |
| Books    | 700    | 15                        |
| Books    | 800    | 20                        |
| Books    | 900    | 25                        |
| Books    | 1000   | 30                        |
</details>

![](images/c8d7be4934edf9ff92cdd4e5f16fe828c8e7a1e00f4137aaaa9fb464e85cfa12.jpg)

<details>
<summary>histogram</summary>

| Dataset  | Expert | Peak Frequency (%) | Peak Probability (%) |
|----------|--------|---------------------|------------------------|
| GitHub   | 0      | ~18                 | ~20                    |
| GitHub   | 1      | ~15                 | ~18                    |
| GitHub   | 2      | ~12                 | ~15                    |
| GitHub   | 3      | ~10                 | ~12                    |
| GitHub   | 4      | ~8                  | ~10                    |
| GitHub   | 5      | ~6                  | ~8                     |
| GitHub   | 6      | ~5                  | ~6                     |
| GitHub   | 7      | ~4                  | ~5                     |
| GitHub   | 8      | ~3                  | ~4                     |
| GitHub   | 9      | ~2                  | ~3                     |
| GitHub   | 10     | ~1                  | ~2                     |
| GitHub   | 11     | ~0.5                | ~1                     |
| GitHub   | 12     | ~0.2                | ~0.5                   |
| GitHub   | 13     | ~0.1                | ~0.2                   |
| GitHub   | 14     | ~0.05               | ~0.1                   |
| GitHub   | 15     | ~0.02               | ~0.05                  |
| GitHub   | 16     | ~0.01               | ~0.02                  |
| GitHub   | 17     | ~0.005              | ~0.01                  |
| GitHub   | 18     | ~0.002              | ~0.005                 |
| GitHub   | 19     | ~0.001              | ~0.002                 |
| GitHub   | 20     | ~0.0005             | ~0.001                 |
| arXiv    | 0      | ~15                 | ~20                    |
| arXiv    | 1      | ~12                 | ~15                    |
| arXiv    | 2      | ~10                 | ~12                    |
| arXiv    | 3      | ~8                  | ~10                    |
| arXiv    | 4      | ~6                  | ~8                     |
| arXiv    | 5      | ~5                  | ~6                     |
| arXiv    | 6      | ~4                  | ~5                     |
| arXiv    | 7      | ~3                  | ~4                     |
| arXiv    | 8      | ~2                  | ~3                     |
| arXiv    | 9      | ~1                  | ~2                     |
| arXiv    | 10     | ~0.5                | ~1                     |
| arXiv    | 11     | ~0.2                | ~0.5                   |
| arXiv    | 12     | ~0.1                | ~0.2                   |
| arXiv    | 13     | ~0.05               | ~0.1                   |
| arXiv    | 14     | ~0.02               | ~0.05                  |
| arXiv    | 15     | ~0.01               | ~0.02                  |
| arXiv    | 16     | ~0.005              | ~0.01                  |
| arXiv    | 17     | ~0.002              | ~0.005                 |
| arXiv    | 18     | ~0.001              | ~0.002                 |
| arXiv    | 19     | ~0.0005             | ~0.001                 |
| arXiv    | 20     | ~0.0002             | ~0.0005                |
| C4       | 0      | ~10                 | ~20                    |
| C4       | 1      | ~8                  | ~15                    |
| C4       | 2      | ~6                  | ~12                    |
| C4       | 3      | ~5                  | ~10                    |
| C4       | 4      | ~4                  | ~8                     |
| C4       | 5      | ~3                  | ~6                     |
| C4       | 6      | ~2                  | ~5                     |
| C4       | 7      | ~1                  | ~4                     |
| C4       | 8      | ~0.5                | ~3                     |
| C4       | 9      | ~0.2                | ~2                     |
| C4       | 10     | ~0.1                | ~1                     |
| C4       | 11     | ~0.05               | ~0.5                   |
| C4       | 12     | ~0.02               | ~0.2                   |
| C4       | 13     | ~0.01               | ~0.1                   |
| C4       | 14     | ~0.005              | ~0.05                  |
| C4       | 15     | ~0.002              | ~0.02                  |
| C4       | 16     | ~0.001              | ~0.01                  |
| C4       | 17     | ~0.0005             | ~0.005                 |
| C4       | 18     | ~0.0002             | ~0.002                 |
| C4       | 19     | ~0.0001             | ~0.001                 |
| C4       | 20     | ~0.00005            | ~0.0005                |
| Books    | 0      | ~20                 | ~10                    |
| Books    | 1      | ~15                 | ~8                     |
| Books    | 2      | ~12                 | ~6                     |
| Books    | 3      | ~10                 | ~5                     |
| Books    | 4      | ~8                  | ~4                     |
| Books    | 5      | ~6                  | ~3                     |
| Books    | 6      | ~5                  | ~2                     |
| Books    | 7      | ~4                  | ~1                     |
| Books    | 8      | ~3                  | ~0.5                   |
| Books    | 9      | ~2                  | ~0.2                   |
| Books    | 10     | ~1                  | ~0.1                   |
| Books    | 11     | ~0.5                | ~0.05                  |
| Books    | 12     | ~0.2                | ~0.02                  |
| Books    | 13     | ~0.1                | ~0.01                  |
| Books    | 14     | ~0.05               | ~0.005                 |
| Books    | 15     | ~0.02               | ~0.002                 |
| Books    | 16     | ~0.01               | ~0.001                 |
| Books    | 17     | ~0.005              | ~0.0005                |
| Books    | 18     | ~0.002              | ~0.0002                |
| Books    | 19     | ~0.001              | ~0.0001                |
| Books    | 20     | ~0.0005             | ~0.00005               |
</details>

Figure 32: Vocabulary specialization across domains of OLMOE-1B-7B (top) and Mixtral-8x7B (bottom). We visualize how often token IDs get routed to specific experts. We only include IDs that appear at least 8 times in the various corpora. Vertical gray lines correspond to uniform routing (8/64=12.5% for OLMOE-1B-7B as it has 64 experts, 8 of which are activated; 2/8=25% for Mixtral as it has 8 experts, 2 of which are activated). For example, among all token IDs in GitHub that get routed to Expert 0 at least 8 times for OLMOE-1B-7B, ∼40% of them get routed to Expert 0 with a probability of ∼100% (upper left) indicating that Expert 0 is specialized on those token IDs. For OLMOE-1B-7B there is much frequency at the routing probability extremes (0% or 100%) indicating that these experts exclusively focus on certain token IDs, especially for specific domains (§5.3) like GitHub and arXiv.

![](images/3b738a43b78c66eaf54c8562cad31954f96c78754ab66bad9d88d1352621dde6.jpg)

<details>
<summary>bar</summary>

| Expert ID | OLMoE | OLMoE-SFT | OLMoE-DPO |
| --------- | ----- | --------- | --------- |
| 0         | 20    | 10        | 5         |
| 8         | 15    | 8         | 4         |
| 16        | 12    | 15        | 6         |
| 24        | 30    | 20        | 10        |
| 32        | 10    | 5         | 3         |
| 40        | 18    | 12        | 8         |
| 48        | 14    | 10        | 5         |
| 56        | 16    | 15        | 7         |
| 0         | 25    | 18        | 10        |
| 8         | 35    | 25        | 15        |
| 16        | 40    | 30        | 20        |
| 24        | 20    | 10        | 5         |
| 32        | 15    | 8         | 4         |
| 40        | 12    | 10        | 6         |
| 48        | 10    | 5         | 3         |
| 56        | 15    | 12        | 8         |
| 0         | 20    | 15        | 10        |
| 8         | 25    | 20        | 15        |
| 16        | 30    | 25        | 20        |
| 24        | 20    | 10        | 5         |
| 32        | 15    | 8         | 4         |
| 40        | 12    | 10        | 6         |
| 48        | 10    | 5         | 3         |
| 56        | 15    | 12        | 8         |
| 0         | 25    | 20        | 15        |
| 8         | 30    | 25        | 20        |
| 16        | 35    | 30        | 25        |
| 24        | 20    | 10        | 5         |
| 32        | 15    | 8         | 4         |
| 40        | 12    | 10        | 6         |
| 48        | 10    | 5         | 3         |
| 56        | 15    | 12        | 8         |
</details>

Figure 33: Load imbalances in selective layers after adaptation. We visualize how often tokens from our instruction tuning dataset (§2) get routed to the 8 active experts out of the 64 total experts (k = 1 in Equation 7). Horizontal gray lines correspond to uniform routing (8/64=12.5% per expert). Although we run SFT and DPO without loss balancing loss (§4.3), we observe that the load distribution does not change substantially.

![](images/10476f0681aeac929428ed655b8a76501963120167ca6b12347d3ca220de2e60.jpg)

![](images/03abb8731fd4019d8f352c52af1416f5cc73cce906f1f78ea198355160447e97.jpg)

<details>
<summary>bar</summary>

| Expert ID | Layer 0 | Layer 7 | Layer 15 |
| --------- | ------- | ------- | -------- |
| 0         | 0       | 0       | 0        |
| 2         | 0       | 0       | 0        |
| 4         | 0       | 0       | 0        |
| 6         | 0       | 0       | 0        |
</details>

Figure 34: Domain specialization of OLMOE-1B-7B (top) vs. Mixtral-8x7B (bottom) of the top-1 routed expert. We visualize how often tokens from different domains get routed to the 64 (OLMOE) or 8 (Mixtral) experts at the end of pretraining. Unlike in Figure 22, here we only consider tokens routed to the top-1 expert (k = 1 in Equation 7). Horizontal gray lines correspond to uniform routing (1/64=1.56% per expert for OLMOE-1B-7B and 1/8=12.5% for Mixtral).

![](images/cea2fe2b5ff25e6c5e8319017effee8626e0a4a3e13593c484816caa1e3e4511.jpg)

<details>
<summary>sankey</summary>

| Layer   | Layer 0 | Layer 7 | Layer 15 |
|---------|---------|---------|----------|
| 0       | 2       | 0       | 1        |
| 0       | 15      | 15      | 5        |
| 0       | 17      | 21      | 8        |
| 0       | 21      | 27      | 17       |
| 0       | 27      | 31      | 24       |
| 0       | 31      | 36      | 30       |
| 0       | 36      | 41      | 36       |
| 0       | 41      | 47      | 44       |
| 0       | 47      | 49      | 52       |
| 0       | 52      | 54      | 57       |
| 0       | 54      | 58      | 57       |
| 7       | 0       | 2       | 0        |
| 7       | 2       | 4       | 0        |
| 7       | 12      | 12      | 0        |
| 7       | 17      | 17      | 0        |
| 7       | 21      | 27      | 0        |
| 7       | 27      | 35      | 0        |
| 7       | 35      | 42      | 0        |
| 7       | 45      | 58      | 0        |
| 7       | 58      | 58      | 0        |
| 15      | 0       | 0       | 0        |
| 15      | 0       | 0       | 0        |
| 15      | 0       | 0       | 0        |
| 15      | 0       | 0       | 0        |
| 15      | 0       | 0       | 0        |
| 15      | 0       | 0       | 0        |
| 15      | 0       | 0       | 0        |
</details>

![](images/4c2b2fdad0d1305ae3450435aa5f1527bc83f63c36dc4d29b5eed7dd815a570b.jpg)

<details>
<summary>sankey</summary>

| Layer    | ArXiv | Other |
| -------- | ----- | ----- |
| Layer 15 | 1     | 34    |
| Layer 7  | 2     | 4     |
| Layer 0  | 0     | 17    |
| Layer 7  | 17    | 35    |
| Layer 0  | 36    | 58    |
| Layer 7  | 36    | 58    |
| Layer 0  | 54    | 38    |
| Layer 7  | 54    | 38    |
| Layer 15 | 34    | 34    |
| Layer 7  | 34    | 34    |
| Layer 0  | 34    | 34    |
| Layer 7  | 34    | 34    |
| Layer 15 | 34    | 34    |
</details>

![](images/262113f1218255b002aab4785d47f83d2dc5f0924789228fa69c6724a56dffe5.jpg)

<details>
<summary>sankey</summary>

| Layer    | 0   | 7   | 15  |
| -------- | --- | --- | --- |
| Layer 0  | 3   | 4   | 11  |
| Layer 7  | 27  | 31  | 33  |
| Layer 15 | 1   | 6   | 35  |
</details>

![](images/42a9eef1c5443cff5305935fabf5ff8941959111cf3561ddc444fc60a31a46de.jpg)  
Figure 35: OLMOE-1B-7B token routing across layers. We visualize how often tokens from different domains get routed to a pair of experts across layers under top-1 routing, corresponding to Figure 34. The size of each rectangle is proportional to the total number of tokens an expert receives, while the flow between two experts shows the proportion of tokens routed to both experts. We only show experts that receive tokens 50% above random chance and use stronger coloring for larger flows. We observe some instances of cross-layer coordination between pairs of experts, e.g., expert 27 in layer 7 and expert 57 in layer 15 process a substantial fraction of Wikipedia tokens together. The flows between layers 0 → 7 and 7 → 15 are independent in this visualization.

![](images/cf77fd028c2087c40ddc65e269d270bc0c822ad4677b886fbe1ec6f331211ef9.jpg)

<details>
<summary>sankey</summary>

| Layer    | Node 0 | Node 1 | Node 2 | Node 3 | Node 4 | Node 5 | Node 6 | Node 7 |
| -------- | ------ | ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| Layer 0  | 0      | 1      | 2      | 3      | 4      | 5      | 6      | 7      |
| Layer 7  | 0      | 1      | 2      | 3      | 4      | 5      | 6      | 7      |
| Layer 15 | 0      | 1      | 2      | 3      | 4      | 5      | 6      | 7      |
</details>

![](images/5a0f369b907bab12f6922e1ce28006e6ad293fe85a690cc7e661e731f22bf37c.jpg)

<details>
<summary>sankey</summary>

| Layer    | 0    | 1    | 2    | 3    | 4    | 5    | 6    | 7    |
| -------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Layer 0  | 0    | 1    | 2    | 3    | 4    | 5    | 6    | 7    |
| Layer 7  | 0    | 1    | 2    | 3    | 4    | 5    | 6    | 7    |
| Layer 15 | 0    | 1    | 2    | 3    | 4    | 5    | 6    | 7    |
</details>

![](images/bc6686be778e0f480ac8681cefd6f34ef52616b913300ac26a1c2808262d72c1.jpg)

<details>
<summary>sankey</summary>

| Layer    | 0    | 1    | 2    | 3    | 4    | 5    | 6    | 7    |
| -------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Layer 0  | 0    | 1    | 2    | 3    | 4    | 5    | 6    | 7    |
| Layer 7  | 0    | 1    | 2    | 3    | 4    | 5    | 6    | 7    |
| Layer 15 | 0    | 1    | 2    | 3    | 4    | 5    | 6    | 7    |
</details>

![](images/b183383c63803501d43972e2a304bdb0fde576dcf8dfc2b733d53518a669e19a.jpg)

<details>
<summary>sankey</summary>

| Layer    | Book 0 | Book 1 | Book 2 | Book 3 | Book 4 | Book 5 | Book 6 | Book 7 |
| -------- | ------ | ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| Layer 0  | 0      | 0      | 0      | 0      | 0      | 0      | 0      | 0      |
| Layer 7  | 0      | 1      | 2      | 3      | 4      | 5      | 6      | 7      |
| Layer 15 | 0      | 1      | 2      | 3      | 4      | 5      | 6      | 7      |
</details>

Figure 36: Mixtral-8x7B token routing across layers. We visualize how often tokens from different domains get routed to a pair of experts across layers under top-1 routing, corresponding to Figure 34. The size of each rectangle is proportional to the total number of tokens an expert receives, while the flow between two experts shows the proportion of tokens routed to both experts. The flows between layers 0 → 7 and 7 → 15 are independent in this visualization.

# H Limitations and Future Work

We highlight four key limitations with this release of OLMOE-1B-7B. We look forward to addressing these issues in future iterations of OLMOE.

More parameters OLMOE-1B-7B has 7B total parameters out of which 1B are activated for each input token. This small size makes OLMOE-1B-7B very cheap to use, yet we demonstrate in this work that it outperforms much more expensive models (Figure 1). However, using only 1B parameters for each input token also limits the capabilities of OLMOE-1B-7B as seen by its performance compared to models that use >7× more parameters, such as Llama3.1-8B in §3. While it may be possible that more parameters are not needed to match 8B models and beyond [81], in the short-term adding parameters is an easy way to improve the performance of OLMOE, at least allowing the model to utilize more than 1B parameters per input, possibly via recursion [45] or agentic workflows [187, 202]. Relatedly, changing the allocation of parameters to e.g. vocabulary versus non-vocabulary parameters is another avenue for improvement [172].

More data We train OLMOE-1B-7B for 5 trillion tokens, however, some recent dense models train significantly longer, such as Llama 3 with 15 trillion tokens [50]. To the best of our knowledge, there has been no large MoE that has been overtrained [57] as much as OLMOE-1B-7B. Specifically, taking the active parameters of OLMOE-1B-7B, our token multiplier [57] is around 5,000 (5T / 1B). There are likely benefits to training even longer, but to what degree overtraining is effective for MoEs and how it differs from dense models still requires more research [7].

Multimodal OLMOE-1B-7B is a text-only large language model, thus it cannot take inputs or produce outputs in other modalities like images or audio. This limits its utility for the large variety of multimodal use cases of such models [75, 167, 27, 82, 119, 136, 14, 47, 50]. There has been early work on open multimodal MoEs [125, 98, 95, 157, 112, 194] and we look forward to making future versions of OLMOE a part of that.

Multilingual We pretrain OLMOE-1B-7B on a predominantly English corpus and exclusively evaluate on English tasks. This may severely limit the usefulness of our model for research on non-English language models [108, 160, 223, 53, 165, 197]. While there has been work on training language-specific LMs [110, 55], it is more likely that as we add more data to build better future iterations of OLMOE we will mix in more non-English data due to data constraints [121]. This may make future OLMOE models perform better in non-English languages.

# I OLMOE-1B-7B-0125

We introduced OLMOE-1B-7B in September 2024. In January 2025, we released a better model, OLMOE-1B-7B-0125, which we discuss here.

<table><tr><td>Source</td><td>Total tokens</td><td>Source %</td><td>Mix %</td></tr><tr><td>Filtered DCLM</td><td>752B</td><td>6.85</td><td>50.2</td></tr><tr><td>Decontaminated FLAN</td><td>17.0B</td><td>100</td><td>16.7</td></tr><tr><td>StackExchange Q&amp;A</td><td>1.26B</td><td>200</td><td>2.47</td></tr><tr><td>peS2o</td><td>58.6B</td><td>16.7</td><td>9.52</td></tr><tr><td>Wikipedia/Wikibooks</td><td>3.70B</td><td>100</td><td>3.57</td></tr><tr><td>Dolmino Math</td><td>10.7B</td><td>200</td><td>17.5</td></tr></table>

Table 15: DOLMINO composition and sampling distribution used for OLMOE-1B-7B-0125.

For pretraining, OLMOE-1B-7B-0125 uses the same data mix for the first stage of training. Following OLMo 2 [127], we anneal this new model on a curated mix of high-quality sources. We 19 sample this mix from the DOLMINO dataset, a collection of high-quality web pages, academic content, question answering pairs, instruction data, and math problems. We use the same 100B tokens sample of DOLMINO used to anneal OLMo 2 13B; a summary of this dataset is in Table 15.

<table><tr><td>OLMoE release</td><td>ARC_C</td><td>ARC_E</td><td>BoolQ</td><td>CSQA</td><td>HSwag</td><td>MMLU</td><td>OBQA</td><td>PIQA</td><td>SIQA</td><td>WinoG</td><td>Avg</td></tr><tr><td>Sep 2024 (0924)</td><td>62.1†</td><td>84.2</td><td>79.2</td><td>72.9</td><td>80.0</td><td>54.1†</td><td>65.4†</td><td>79.8</td><td>63.0†</td><td>70.2</td><td>71.1</td></tr><tr><td>Jan 2025 (0125)</td><td>67.5†</td><td>84.4†</td><td>80.6</td><td>70.8</td><td>81.7</td><td>56.3†</td><td>69.6†</td><td>78.7</td><td>66.8†</td><td>70.6</td><td>72.7</td></tr></table>

Table 16: OLMOE-1B-7B-0924 and OLMOE-1B-7B-0125 on OLMES. We bold the best performance. † indicates use of the MCF score, see Appendix C for evaluation details.

We compare OLMOE-1B-7B-0125 with OLMOE-1B-7B In Table 16. Overall, the new model is a notable improvement over the previous iteration being better on average (+1.6) and notable datasets like MMLU (+2.1).

Following this improved annealing setup, we adapt OLMOE-1B-7B-0125 using the post-training from Tulu 3 [ ¨ 87]. This recipe represents an updated version of the one originally used for OLMOE. It features an improved SFT mix, better sampled DPO data, and a PPO step that leverages verifiers as for the model reward. We compare this new iteration using the evaluation setup from Tulu¨ (which differs from other evaluations in this paper) in Table 17. After adaptation, the new model is significantly better, with a 10-point gain on the benchmark average.

The new models and datasets are freely available on the Hugging Face hub.20 For more information 21 about this release, we refer to its announcement on Ai2’s website.

<table><tr><td rowspan="2">Skill</td><td rowspan="2"> $Benchmark_{(eval)}$ </td><td colspan="2">OLMoE-1B-7B-0924</td><td colspan="3">OLMoE-1B-7B-0125</td></tr><tr><td>+SFT</td><td>+DPO</td><td>+SFT</td><td>+DPO</td><td>+RLVR</td></tr><tr><td></td><td>Avg.</td><td>39.7</td><td>39.8</td><td>46.6</td><td>49.3</td><td>49.8</td></tr><tr><td rowspan="3">Knowledge</td><td> $MMLU_{(0 shot, CoT)}$ </td><td>54.3</td><td>54.6</td><td>55.3</td><td>54.9</td><td>55.1</td></tr><tr><td> $PopQA_{(15 shot)}$ </td><td>21.0</td><td>20.6</td><td>20.1</td><td>19.7</td><td>19.8</td></tr><tr><td> $TruthfulQA_{(6 shot)}$ </td><td>44.7</td><td>49.1</td><td>45.5</td><td>50.0</td><td>50.6</td></tr><tr><td rowspan="2">Reasoning</td><td> $BigBenchHard_{(3 shot, CoT)}$ </td><td>36.6</td><td>36.8</td><td>37.3</td><td>37.4</td><td>38.6</td></tr><tr><td> $DROP_{(3 shot)}$ </td><td>34.7</td><td>34.5</td><td>48.6</td><td>48.4</td><td>47.9</td></tr><tr><td rowspan="2">Math</td><td> $MATH_{(4 shot CoT, Flex)}$ </td><td>8.2</td><td>8.2</td><td>21.4</td><td>20.4</td><td>21.4</td></tr><tr><td> $GSM8K_{(8 shot, CoT)}$ </td><td>42.5</td><td>47.4</td><td>55.7</td><td>64.6</td><td>72.4</td></tr><tr><td rowspan="2">Coding</td><td> $HumanEval_{(pass@10)}$ </td><td>63.7</td><td>63.0</td><td>62.6</td><td>61.9</td><td>62.3</td></tr><tr><td> $HumanEval_{+(pass@10)}$ </td><td>57.4</td><td>58.9</td><td>55.7</td><td>57.6</td><td>54.4</td></tr><tr><td rowspan="2">IF &amp; chat</td><td> $IFEval_{(prompt loose)}$ </td><td>41.2</td><td>45.3</td><td>56.6</td><td>65.6</td><td>66.4</td></tr><tr><td> $AlpacaEval 2_{(LC \% win)}$ </td><td>6.4</td><td>7.5</td><td>5.8</td><td>19.5</td><td>18.0</td></tr><tr><td>Safety</td><td> $Safety_{(6 task avg.)}$ </td><td>65.8</td><td>51.4</td><td>94.5</td><td>91.4</td><td>90.4</td></tr></table>

Table 17: OLMOE-1B-7B-0924 and OLMOE-1B-7B-0125 after adaptation. We bold the best performance.

# J Change log

V1 → V2 (2025-03):

• Added reference to OLMOE-1B-7B-0125 in Appendix I   
• Corrected OpenMoE active parameters in Table 4 from 2.9B to 2.6B   
• Corrected our max LR in Table 10 from 5.0E-04 to 4.0E-05   
• Added Zamba2, Llama3.2, and DeepSeekV2 in Table 12