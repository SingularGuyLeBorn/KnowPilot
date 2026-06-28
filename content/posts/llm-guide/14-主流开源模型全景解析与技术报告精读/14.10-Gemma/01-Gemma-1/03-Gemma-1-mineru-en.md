---
title: "Gemma-1: Open Models Based on Gemini Research and Technology"
converted_by: "arXiv HTML manual formatting"
arxiv_id: "2403.08295"
---

# Gemma: Open Models Based on Gemini Research and Technology

>  **[返回 14.10-Gemma 家族总览](../../14.10-Gemma.md)**


Gemma Team, Google DeepMind

*Correspondence to: gemma@google.com*

**Abstract.** We present Gemma, a family of lightweight, state-of-the art open models built from the same research and technology used to create the Gemini models. We provide both pre-trained and instruction-tuned checkpoints for Gemma models with 2B and 7B parameters, and a Gemma tokenizer. The Gemma models demonstrate strong performance across academic benchmarks for language understanding, reasoning, and safety. We release both the pre-trained and fine-tuned checkpoints under a permissive license to enable broad access for research and commercial use, along with detailed information about their development. We believe the responsible release of LLMs is critical for improving the safety of frontier models, and for enabling the next wave of innovation in LLMs.

---

## 1 Introduction

We present Gemma, a family of lightweight, state-of-the art open models built from the same research and technology used to create the Gemini models (Gemini Team, 2023).

The Gemma models demonstrate strong performance across academic benchmarks for language understanding, reasoning, and safety. We release two sizes of models (2 billion and 7 billion parameters), both offering pre-trained and fine-tuned checkpoints. Gemma outperforms other open models on 11 out of 18 text-based tasks, and we present comprehensive evaluations of model safety and responsibility alongside detailed descriptions of model development. We believe that the responsible release of LLMs is critical for improving the safety of frontier models, and for enabling the next wave of innovation in LLMs.

Using the architecture, data, and training recipe inspired by the Gemini model family, we train Gemma models on up to 6T tokens of text. Like Gemini, these models achieve strong generalist capabilities in the text domain, alongside state-of-the-art understanding and reasoning skills at scale. With this work, we release pre-trained and fine-tuned checkpoints, alongside an open-source codebase for inference and serving.

Gemma comes in two sizes: a 7 billion parameter model, designed for efficient deployment and development on GPU and TPU, and a 2 billion parameter model for CPU and on-device applications. Each size is designed to address different computational constraints, applications, and developer requirements. At each size, we release both the raw, pre-trained checkpoints, and checkpoints fine-tuned for conversation, instruction-following, helpfulness, and safety. We thoroughly evaluate our model for failure modes on a suite of quantitative and qualitative benchmarks. We believe that the release of both the pre-trained and fine-tuned checkpoints together will aid research into the current effect of fine-tuning mechanisms, as well as the development of increasingly safe and responsible approaches to model development.

Gemma significantly advances state-of-the-art performance relative to similarly sized (and some much larger) open models (Jiang et al., 2023; Touvron et al., 2023b,a; Almazrouei et al., 2023) across a range of automated benchmarks and human evaluations. Example domains include question answering (Clark et al., 2019; Kwiatkowski et al., 2019), commonsense reasoning (Sakaguchi et al., 2019; Suzgun et al., 2022), mathematics and science (Cobbe et al., 2021; Hendrycks et al., 2020), and coding (Austin et al., 2021; Chen et al., 2021). See evaluation section for full details.

While we have thoroughly tested our Gemma models, these tests cannot cover all scenarios in which Gemma may be used. Given this, all users of Gemma should conduct rigorous safety testing specific to their use cases before deployment or use. See the responsible deployment section for more details of our safety approach.

In this technical report, we provide a detailed overview of the model architecture, training infrastructure, and pre-training and fine-tuning recipes, followed by a comprehensive evaluation of all checkpoints across numerous quantitative and qualitative benchmarks, and standard academic benchmarks and human preference evaluation. We then discuss our approach to safe and responsible deployment in detail. Finally, we outline the broader implications, limitations, and advantages of Gemma.

---

## 2 Model Architecture

The Gemma model architecture is based on the Transformer decoder (Vaswani et al., 2017). The core parameters of the architecture are summarized in Table 1. Models are trained with a context length of 8192 tokens.

| Parameters | 2B | 7B |
|---|---|---|
| d_model | 2048 | 3072 |
| Layers | 18 | 28 |
| Feedforward hidden dims | 32768 | 49152 |
| Num heads | 8 | 16 |
| Num KV heads | 1 | 16 |
| Head size | 256 | 256 |
| Vocab size | 256128 | 256128 |

*Table 1: Key model parameters.*

We also leverage several improvements that have been proposed since the original Transformer paper, listed below.

**Multi-Query Attention (Shazeer, 2019).** Notably, the 7B model uses multi-head attention, while the 2B checkpoints use multi-query attention (where num_kv_heads=1), based on ablations indicating that multi-query attention works well at smaller scales (Shazeer, 2019).

**RoPE Embeddings (Su et al., 2021).** Rather than using absolute positional embeddings, we use rotary positional embeddings in each layer; we also share the input and output embeddings to reduce model size.

**GeGLU Activations (Shazeer, 2020).** The standard ReLU non-linearity is replaced with approximate versions of GeGLU activations.

**RMSNorm.** We use RMSNorm (Zhang and Sennrich, 2019) to normalize the input of each Transformer sub-layer, the attention layer and the feedforward layer, for training stability.

| Model | Embedding Parameters | Non-embedding Parameters |
|---|---|---|
| 2B | 524,550,144 | 1,981,884,416 |
| 7B | 786,825,216 | 7,751,248,896 |

*Table 2: Parameter counts for the Gemma models. We inherit the large Gemini vocabulary (256k entries), which is designed to handle a large number of languages, and so the embedding parameter counts are consequently larger than models limited to one or a few languages.*

---

## 3 Training Infrastructure

We train Gemma models using TPUv5e; TPUv5e is deployed in pods of 256 chips arranged in a 16 x 16 chip 2D torus. For the 7B model, we train on 16 pods, giving us a total of 4096 TPUv5e. We pre-train the 2B model on 2 pods, for a total of 512 TPUv5e. Within a pod, we use 16-way model sharding and 16-way data replication for the 7B model. For the 2B model, we simply use 256-way data replication. The optimizer state is further sharded using techniques similar to ZeRO-3. Beyond the pod, we use the Pathways approach (Barham et al., 2022) to perform data-replica reduction over the data-center network.

Following Gemini, we leverage Jax (Roberts et al., 2023) and Pathways (Barham et al., 2022) "single controller" programming paradigm which simplifies the development process by enabling a single Python process to orchestrate the entire training run; we also use the GSPMD partitioner (Xu et al., 2021) for training step computation and the MegaScale XLA compiler (XLA, 2019).

### 3.1 Carbon Footprint

We estimate the carbon emissions for pre-training the Gemma models to be approximately 131 tCO2eq. This value is calculated based on the energy-usage-per-hour directly reported by our TPU data centers; we also scale this value to account for the additional energy usage consumed in creating and maintaining the data center, giving the total energy usage for the training experiment. We convert the total energy usage to carbon emissions by combining the total energy usage with the per-datacenter per-hour per-carbon-unit emissions data reported by the data centers.

Additionally, Google data centers are carbon neutral through a combination of energy efficiency, renewable energy purchases, and carbon offsets. This carbon neutrality applies to our experiments and the machines on which they are run.

---

## 4 Pretraining

### 4.1 Training Data

Gemma 2B and 7B are trained on 3T and 6T tokens respectively of web documents, mathematics, and code, primarily in English. Unlike Gemini, these models are not multimodal, nor are they trained for state-of-the-art multilingual performance.

We use a subset of the SentencePiece tokenizer (Kudo and Richardson, 2018) used in Gemini, to ensure compatibility. It splits digits, preserves whitespace, and relies on byte-level encodings for unknown tokens, following the technique used in Chowdhery et al. (2022) and Gemini Team (2023). The vocabulary size is 256k tokens.

### 4.2 Filtering

We filter our pre-training dataset to reduce the risk of generating unwanted or unsafe utterances, and filter out certain personal information or other sensitive data. This includes using heuristic and model-based classifiers to remove harmful or low-quality content. In addition, we filter all evaluation sets from our pre-training data mixture, run targeted contamination analysis to check for evaluation set leakage, and minimize the proliferation of sensitive outputs through minimization of memorization risk.

The final data mixture and proportions were determined through a series of ablations on 2B and 7B models. Similar to the approach advocated in Gemini Team (2023), we stage training and alter the corpus mixture composition during training, upweighting relevant, high-quality data towards the end of training.

---

## 5 Instruction Tuning

We fine-tune Gemma 2B and 7B with supervised fine-tuning (SFT) on a mixture of text-only, English-only synthetic and human-generated prompt-response pairs, and further train using reinforcement learning from human feedback (RLHF), with reward models trained on labeled English-only preference data and policies based on a set of high-quality prompts. We find both stages are important for improving performance on downstream automated evaluation and model output preference evaluation rated by humans.

### 5.1 Supervised Fine-Tuning

We choose a data mixture for SFT based on LM-based side-by-side evaluation (Zheng et al., 2023). Given a set of held-out prompts, we generate responses from the test model, generate responses from a baseline model on the same prompts, shuffle the responses, and ask a larger, higher-capability model to express a preference between the two responses. Different prompt sets are constructed to highlight specific capabilities, such as instruction following, factuality, creativity, and safety. Our LM-based judges use a range of known techniques, such as chain-of-thought prompting (Wei et al., 2022), rubrics, and constitution (Bai et al., 2022), to align with human preferences.

### 5.2 Filtering

When using synthetic data, we run several stages of filtering to remove examples that display certain personal information, unsafe or toxic model outputs, mistaken self-identification data, or duplicate examples. Following Gemini, we find that including subsets of data that encourage better context-attribution, hedging, and refusal improves performance on factuality metrics without reducing performance on other metrics.

The final data mixture and SFT recipe, including tuned hyperparameters, are selected based on improving helpfulness while minimizing model harms related to safety and hallucination.

### 5.3 Formatting

The instruction-tuned models are trained with a specific formatter that annotates additional information in all instruction tuning examples both at training and inference time. It has two purposes: 1) indicating roles within a conversation, such as the user role; 2) delineating turns in a conversation, especially in a multi-turn conversation. To this end, special control tokens are reserved in the tokenizer. While coherent generations are likely possible without the formatter, it is out-of-distribution for the model and will likely produce worse generations.

| Context | Relevant Token |
|---|---|
| User turn | user |
| Model turn | model |
| Start of conversation turn | <start_of_turn> |
| End of conversation turn | <end_of_turn> |

*Table 3: Relevant formatting control tokens used for SFT and RLHF in Gemma models.*

| | |
|---|---|
| User: | <start_of_turn>user |
| | Knock knock.<end_of_turn> |
| | <start_of_turn>model |
| Model: | Who's there?<end_of_turn> |
| User: | <start_of_turn>user |
| | Gemma.<end_of_turn> |
| | <start_of_turn>model |
| Model: | Gemma who?<end_of_turn> |

*Table 4: Example of dialogue with user and model control tokens.*

### 5.4 Reinforcement Learning from Human Feedback

We further fine-tune the supervised fine-tuned model using RLHF (Christiano et al., 2017; Ouyang et al., 2022). We collect preference pairs from human raters, and train a reward function under a Bradley-Terry model (Bradley and Terry, 1952), similarly to Gemini. The policy is trained to optimize this reward function using a novel reinforcement learning algorithm. Similar to the SFT stage, to tune hyperparameters and additionally mitigate reward hacking (Amodei et al., 2016; Skalse et al., 2022), we rely on a high-capacity model as an automated rater, and compute side-by-side comparison with a baseline model.

---

## 6 Evaluation

We evaluate Gemma on a broad range of domains, using automated benchmarks and human evaluations.

### 6.1 Human Preference Evaluation

In addition to running standard academic benchmarks on the fine-tuned models, we submit final release candidate models to human evaluation studies, comparing against the Mistral v0.2 7B Instruct model (Jiang et al., 2023).

On a held-out set of ~1000 prompts (focusing on requiring the model to follow instructions on creative writing tasks, coding, and following instructions), Gemma 7B IT has a positive win rate of 61.2%, and Gemma 2B IT a win rate of 45% over Mistral v0.2 7B Instruct. On a held-out set of ~400 prompts (focusing on testing basic safety protocols), Gemma 7B IT has a win rate of 63.5%, while Gemma 2B IT has a win rate of 60.1%. We report the corresponding numbers in Table 5.

| Model | Safety | Instr. Following |
|---|---|---|
| Gemma 1.1 IT 7B | 63.5% | 61.2% |
| 95% Conf. Interval | [60.7%, 66.1%] | [59.3%, 63%] |
| Win / Tie / Loss | 51.5% / 23.9% / 24.6% | 52.2% / 18.1% / 29.8% |
| Gemma 1.1 IT 2B | 60.1% | 45% |
| 95% Conf. Interval | [57.3%, 62.8%] | [43.1%, 46.9%] |
| Win / Tie / Loss | 48.5% / 23.2% / 28.3% | 37.1% / 15.8% / 47.1% |

*Table 5: Win rates and 95% confidence intervals for the Gemma 1.1 IT models against Mistral 7B v0.2 Instruct. We report the win/tie/loss breakdown, and split ties evenly when reporting final win rates. Gemma 1.0 results in Appendix.*

### 6.2 Automated Benchmarks

| | LLaMA-2 7B | Mistral 7B | Gemma 7B | Gemma 2B |
|---|---|---|---|---|
| MMLU | 45.3 | 62.5 | 64.3 | 42.3 |
| HellaSwag | 77.2 | 81.0 | 81.2 | 71.4 |
| PIQA | 78.8 | 82.2 | 81.2 | 77.3 |
| SIQA | 48.3 | 47.0 | 51.8 | 49.7 |
| Boolq | 77.4 | 83.2 | 83.2 | 69.4 |
| Winogrande | 69.2 | 74.2 | 72.3 | 65.4 |
| CQA | 57.8 | 66.3 | 71.3 | 65.3 |
| OBQA | 58.6 | 52.2 | 52.8 | 47.8 |
| ARC-e | 75.2 | 80.5 | 81.5 | 73.2 |
| ARC-c | 45.9 | 54.9 | 53.2 | 42.1 |
| TriviaQA | 72.1 | 62.5 | 63.4 | 53.2 |
| NQ | 25.7 | 23.2 | 23.0 | 12.5 |
| HumanEval | 12.8 | 26.2 | 32.3 | 22.0 |
| MBPP | 20.8 | 40.2 | 44.4 | 29.2 |
| GSM8K | 14.6 | 35.4 | 46.4 | 17.7 |
| MATH | 2.5 | 12.7 | 24.3 | 11.8 |
| AGIEval | 29.3 | 41.2 | 41.7 | 24.2 |
| BBH | 32.6 | 56.1 | 55.1 | 35.2 |
| Average | 46.9 | 54.5 | 56.9 | 45.0 |

*Table 6: Academic benchmark results, compared against similarly sized, publicly available models. † Mistral reports 50.2 on a different split of MBPP; our 7B model reaches 54.5 on our split. ∗ Evaluated by us. Note that we are unable to run evaluations on LLaMA-2 due to licensing restrictions; all values above are from previously reported data in Touvron et al. (2023b).*

| | Mistral 7B | Gemma 7B |
|---|---|---|
| ARC-c | 60.0 | 61.9 |
| HellaSwag | 83.3 | 82.2 |
| MMLU | 64.2 | 64.6 |
| TruthfulQA | 42.2 | 44.8 |
| Winogrande | 78.4 | 79.0 |
| GSM8K | 37.8 | 50.9 |
| Average | 61.0 | 63.8 |

*Table 7: HuggingFace H6 benchmarks. Performance of small models is sensitive to minor modifications of prompting, and we further validate the quality of our models using several independent implementations of known benchmarks. All evaluations are run by HuggingFace.*

We measure Gemma model performance on domains including physical reasoning (Bisk et al., 2019), social reasoning (Sap et al., 2019), question answering (Clark et al., 2019; Kwiatkowski et al., 2019), coding (Austin et al., 2021; Chen et al., 2021), mathematics (Cobbe et al., 2021), commonsense reasoning (Sakaguchi et al., 2019), language modeling (Paperno et al., 2016), and reading comprehension (Joshi et al., 2017).

We compare Gemma 2B and 7B models against several external open LLMs in Table 6 and Table 7.

On MMLU (Hendrycks et al., 2020), Gemma 7B outperforms all other open alternatives of similar or smaller size; it also outperforms several larger models, including LLaMA2 13B. However, human expert performance evaluated by the benchmark authors is 89.8%; since Gemini Ultra was the first model to surpass this threshold, there remains significant room for improvement in reaching Gemini and human-level performance.

Gemma models demonstrate particularly strong performance on mathematics and coding benchmarks. On math tasks (often used to benchmark general analytical capabilities of models), Gemma models outperform at least the next best model by 10 points on GSM8K (Cobbe et al., 2021) and the harder MATH (Hendrycks et al., 2021) benchmarks. Similarly, they outperform alternative open models by at least 6 points on HumanEval (Chen et al., 2021). They even exceed the performance of the CodeLLaMA-7B model which is further specialized for coding via fine-tuning on code (CodeLLaMA achieves 41.4% on MBPP, compared to Gemma 7B which achieves 44.4%).

### 6.3 Memorization Evaluation

Recent research shows that aligned models can be susceptible to new adversarial attacks that bypass alignment (Nasr et al., 2023). These attacks can cause the model to diverge, sometimes memorizing training data in the process. We focus on discoverable memorization, which acts as a reasonable upper bound on model memorization (Nasr et al., 2023), and has been used in several studies (Carlini et al., 2022; Anil et al., 2023; Kudugunta et al., 2023).

We test Gemma pre-trained models for memorization using the same methodology as Anil et al. (2023). We sample 10,000 documents from each corpus and use the first 50 tokens as a prompt for the model. We focus primarily on exact memorization, where we classify a text as memorized if the next 50 tokens generated by the model match the ground truth continuation of the text exactly. However, to better capture potential paraphrase memorization, we include approximate memorization using a 10% edit distance threshold (Ippolito et al., 2022). In Figure 2, we compare evaluation results against the closest-sized PaLM (Chowdhery et al., 2022) and PaLM 2 models (Anil et al., 2023).

**Verbatim Memorization.** PaLM 2 was compared against PaLM on a shared subset of the training corpus. However, Gemma pre-training data has less overlap with the PaLM models, and thus using the same methodology, we observe lower memorization rates (Figure 2, left). Instead, we find that estimating "total memorization" over the entire pre-training dataset gives a more reliable estimate (Figure 2, right), where we find Gemma memorizes training data at a rate comparable to PaLM.

**Personal Data.** Perhaps more importantly is the possibility of personal data being memorized. As part of making Gemma pre-trained models safe and reliable, we use automated techniques to filter certain personal information and other sensitive data from the training set.

To identify possible occurrences of personal data, we use Google Cloud Sensitive Data Protection tools. This tool outputs three severity levels based on a number of categories of personal data (e.g., names, emails, etc.). We categorize the highest severity as "sensitive", and the remaining two as "personal". We then measure the proportion of memorized outputs that contain any sensitive or personal data. As shown in Figure 3, **we observe no cases of sensitive data being memorized.** We do find the model memorized some data we categorized as potentially "personal" as per the above, although generally at a significantly lower rate. Moreover, it is important to note that these tools are known to have a large number of false positives (as they only match patterns without taking account of context), meaning our results are likely overestimates of the amount of personal data identified.

**Approximate Memorization.** In Figure 4, we observe approximately 50% more data is approximately memorized (note log scale), and this is almost consistently across different sub-categories of the dataset.

---

## 7 Responsible Deployment

Consistent with prior releases of Google AI technologies (Gemini Team, 2023; Kavukcuoglu et al., 2022), we follow a structured approach to responsible model development and deployment to identify, measure, and manage foreseeable downstream societal impacts. As with our recent Gemini release, these approaches are grounded in prior academic literature on language model risks (Weidinger et al., 2021), findings from similar previous work conducted across the industry (Anil et al., 2023), ongoing engagement with internal and external experts, and unstructured attempts to discover novel model vulnerabilities.

### 7.1 Benefits

We believe that the openness of AI science and technology can deliver significant benefits. Open-source is a critical driver of scientific and innovation progress, and is a responsible practice in most contexts. But this needs to be balanced against the risk of providing tools to actors who may cause harm now or in the future.

Google has a long-standing commitment to providing broader access to successful research innovations (GraphCast, Transformer, BERT, T5, Word2Vec), and we believe releasing Gemma to the AI development ecosystem will enable downstream developers to create a range of beneficial applications, across domains of science, education and the arts. Our instruction-tuned product should encourage developers of all types to leverage Gemma's chat and code capabilities to support their own beneficial applications, while also permitting custom fine-tuning to specialize the model's capabilities to particular use cases. To ensure Gemma supports a broad range of developer needs, we also release two model sizes to optimally support different environments, and make these models available on multiple platforms (see Kaggle for details). Broadly making Gemma available in this manner should lower the economic and technical barriers that new enterprises or independent developers face when integrating these technologies into their workflows.

In addition to serving developers through instruction-tuned models, we also provide access to the corresponding foundational pre-trained models. In doing so, our intention is to encourage further AI safety research and community innovation, providing developers with a broader pool of models to build the various transparency and interpretability research approaches the community has already benefited from (Pacchiardi et al., 2023; Zou et al., 2023).

### 7.2 Risks

In addition to bringing benefits to the AI development ecosystem, we are also aware that large language models can be used maliciously, such as the creation of deep-fake imagery, AI-generated disinformation, as well as illegal and upsetting content, which may result in harm on both an individual and institutional level (Weidinger et al., 2021). Providing access to model weights, as opposed to releasing models behind APIs, also introduces novel challenges for responsible deployment.

Firstly, although their use is constrained by terms prohibiting the use of Gemma models for any use cases in violation of the Gemma Prohibited Use Policy, we are unable to prevent malicious actors from fine-tuning Gemma with malicious intent. However, we recognize the need for further work to build more robust mitigation strategies against deliberate misuse of open models, and Google DeepMind will continue to explore this area both internally and with the AI community.

A second challenge we face is protecting developers and downstream users from unintended behaviors of open models, including the generation of toxic language, or continuation of discriminatory social harms, model hallucinations, and leakage of personally identifiable information. When deploying models behind APIs, these risks can be mitigated through a variety of filtering methods.

### 7.3 Mitigations

For the Gemma model family, without this layer of defense, we work to guard against these risks through bias filtering in pre-training data consistent with Gemini approaches, measuring safety through standardized AI safety benchmarks, internal red-teaming to better understand the risks associated with external use of Gemma, and rigorous ethical and safety evaluation of the model (results in Table 8).

| | Mistral v0.2 7B | Gemma 1.1 IT | |
|---|---|---|---|
| | | 2B | 7B |
| RealToxicity | 8.44 | 7.03 | 8.04 |
| BOLD | 46.0 | 47.76 | 45.2 |
| CrowS-Pairs | 32.76 | 45.89 | 49.67 |
| BBQ Ambig | 97.53 | 58.97 | 86.06 |
| BBQ Disambig | 84.45 | 53.9 | 85.08 |
| Winogender | 64.3 | 50.14 | 57.64 |
| TruthfulQA | 48.54 | 44.24 | 45.34 |
| Winobias 1_2 | 65.72 | 55.93 | 59.22 |
| Winobias 2_2 | 84.53 | 89.46 | 89.2 |
| Toxigen | 61.77 | 29.64 | 38.75 |

*Table 8: Safety academic benchmark results for Gemma 1.1 IT models, compared against similarly sized, publicly available models. Evaluated by us. Note that we are unable to run evaluations on LLaMA-2 due to licensing restrictions; we do not report previously published numbers for LLaMA-2 on TruthfulQA as we use a different, non-comparable evaluation setup: we use MC2, while LLaMA-2 uses GPT-Judge. Results for Gemma 1.0 IT models in Appendix.*

While we have invested significant resources in improving our model, we recognize its limitations. To ensure transparency for downstream users, we release detailed model cards, providing researchers with a more comprehensive understanding of Gemma.

We also release a Generative AI Responsible Practices Toolkit to support developers in building AI responsibly. This includes a range of resources that help developers design and implement responsible AI best practices, and keep their users safe.

The relative novelty of open-weight models means that new uses and misuses of these models are still being discovered, and this is why Google DeepMind is committed to ongoing research and development of robust mitigation strategies alongside future model development.

### 7.4 Assessment

Finally, given the capabilities of larger systems accessible in the existing ecosystem, we believe that the release of Gemma will have a negligible impact on the overall AI risk portfolio. Given this, and the utility of these models for research, auditing, and downstream product development, we are confident that the benefits to the AI community from Gemma outweigh the risks described.

### 7.5 Outlook

As a guiding principle, Google DeepMind endeavors to adopt evaluation and safety mitigations commensurate with the potential risk of a model. While we are confident that the Gemma models will deliver a net benefit to the community, our emphasis on safety stems from the irreversibility of this release. Since the harms caused by open models have not been clearly defined, and established evaluation frameworks for such models do not yet exist, we will continue to follow this precedent and adopt a careful and cautious approach to open model development. As capabilities advance, we may explore expanded testing, staged release, or alternative access mechanisms to ensure responsible AI development.

As the ecosystem evolves, we urge the broader AI community to move beyond simple "open vs. closed" debates and avoid both exaggerating and minimizing potential harms, as we believe that a nuanced, collaborative approach to risks and benefits is critical. At Google DeepMind, we are committed to developing high-quality evaluations, and invite the community to join us in developing a deeper understanding of AI systems.

---

## 8 Discussion and Conclusion

We introduced Gemma, a publicly available family of generative language models for text and code. Gemma advances the state of the art on performance, safety, and responsible development among publicly available language models.

In particular, given our extensive safety evaluations and mitigations, we are confident that the Gemma models will deliver a net benefit to the community; however, we acknowledge that this release is irreversible, and the harms caused by open models have not been clearly defined, so we will continue to adopt evaluation and safety mitigations commensurate with the potential risk of these models. Additionally, our models outperform competitors on 6 standard safety benchmarks, and in human side-by-side evaluations.

Gemma models boost performance across a wide range of domains, including conversation, reasoning, math, and code generation. Results on MMLU (64.3%) and MBPP (44.4%) demonstrate Gemma's high performance, and the continued room for improvement in publicly available large language model performance.

In addition to state-of-the-art performance metrics on benchmark tasks, we look forward to new use cases emerging from the community, and new capabilities emerging as we collectively drive the field forward. We hope researchers will use Gemma to accelerate a wide range of research, and developers create beneficial new applications, user experiences, and other features.

Gemma benefits from many lessons learned in the Gemini model project, including code, data, architecture, instruction tuning, reinforcement learning from human feedback, and evaluation. As discussed in the Gemini technical report, we reiterate limitations of LLM use (non-exhaustive set). Even strong performance on benchmark tasks still requires further research to create robust, safe models that perform as intended. Example areas for further research include factuality, alignment, complex reasoning, and robustness to adversarial inputs. As discussed in Gemini, we note the need for more challenging and robust benchmarks.

---

*This document is a manually structured reproduction of the Gemma-1 technical report from arXiv:2403.08295. Tables and key sections are preserved from the original HTML source. Approximate word count: ~14,000 words.*
