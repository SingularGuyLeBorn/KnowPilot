---
title: "Qwen2.5-Math - MinerU 原始转换(英文)"
source_pdf: pdfs/Qwen2.5-Math-Technical-Report.pdf
converted_by: MinerU
date: 2026-05-19
---

# QWEN2.5-MATH TECHNICAL REPORT: TOWARD MATHEMATICAL EXPERT MODEL VIA SELF-IMPROVEMENT

>  **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**


An Yang, Beichen Zhang, Binyuan Hui, Bofei Gao, Bowen Yu†, Chengpeng Li, Dayiheng Liu†, Jianhong Tu, Jingren Zhou, Junyang Lin†, Keming Lu, Mingfeng Xue, Runji Lin, Tianyu Liu, Xingzhang Ren, Zhenru Zhang

Qwen Team, Alibaba Group∗

## ABSTRACT

In this report, we present a series of math-specific large language models: Qwen2.5-Math and Qwen2.5-Math-Instruct-1.5B/7B/72B. The core innovation of the Qwen2.5 series lies in integrating the philosophy of self-improvement throughout the entire pipeline, from pre-training and post-training to inference: (1) During the pre-training phase, Qwen2-Math-Instruct is utilized to generate large-scale, high-quality mathematical data. (2) In the post-training phase, we develop a reward model (RM) by conducting massive sampling from Qwen2-Math-Instruct. This RM is then applied to the iterative evolution of data in supervised fine-tuning (SFT). With a stronger SFT model, it’s possible to iteratively train and update the RM, which in turn guides the next round of SFT data iteration. On the final SFT model, we employ the ultimate RM for reinforcement learning, resulting in the Qwen2.5-Math-Instruct. (3) Furthermore, during the inference stage, the RM is used to guide sampling, optimizing the model’s performance.

Qwen2.5-Math-Instruct supports both Chinese and English, and possess advanced mathematical reasoning capabilities, including Chain-of-Thought (CoT) and Tool-Integrated Reasoning (TIR). We evaluate our models on 10 mathematics datasets in both English and Chinese, such as GSM8K, MATH, GaoKao, AMC23, and AIME24, covering a range of difficulties from grade school level to math competition problems. The flagship model, Qwen2.5-Math-72B-Instruct, significantly outperforms both open-source models and leading closed-source models (e.g., GPT-4o, Gemini Math-Specialized 1.5 Pro). Particularly in the challenging AMC 2023, with the assistance of RM, Qwen2.5-Math-72B-Instruct successfully solves almost all the problems. Qwen2.5-Math-7B-Instruct surpasses Qwen2-Math-Instruct 72B in performance. Under CoT and TIR settings, it achieves MATH scores of 83.6 and 85.3, respectively. Even our smallest 1.5B model, achieving a MATH score of around 80 when utilizing the Python Interpreter, outperforms the majority of current models in this domain. We hope that Qwen2.5-Math can contribute to the community for solving complex mathematical problems.

The base models, instruct models, and reward model of the Qwen2.5-Math series are available on Hugging Face 1 and ModelScope2, and the evaluation scripts on GitHub3. We have also developed a demo that supports the TIR mode in Qwen-Agent4, which allows running code locally to experience Tool-Integrated Reasoning capabilities of Qwen2.5-Math.

## CONTENTS

1 Introduction 3   
2 Qwen2.5-Math Pre-training 4   
3 Qwen2.5-Math Post-training 5   
3.1 Supervised Fine-tuning 6   
3.1.1 Chain-of-Thought Data Synthesis 6   
3.1.2 Tool-integrated Reasoning Data Synthesis . 6   
3.2 Reward Model Training . 7   
3.2.1 Data Synthesis 7   
3.2.2 Training Strategy 7   
3.3 Reinforcement Learning 7   
4 Decontamination 8   
5 Evaluation 9   
5.1 Base Models . . . 9   
5.2 Instruction Models 9   
6 Conclusion 14   
A Case Study of Qwen2-MATH on Olympiad-level Problems 19   
A.1 Number Theory 19   
A.2 Algebra 22   
A.3 Counting & Probability 27   
A.4 Geometry 30   
B Prompts Used in the Evaluation 31

![](images/fig01_pass_at_1_math_cot.jpg)  
Figure 1: The pass@1 performance of Qwen2.5-Math-72B-Instruct on MATH by the Chain-of-Thought reasoning.

Over the past year, we have devoted considerable effort to researching and enhancing the reasoning capabilities of large language models, with a particular emphasis on their ability to solve arithmetic and mathematical problems. In this report, we introduce a series of math-specific large language models, Qwen2.5-Math, Qwen2.5-Math-RM, and Qwen2.5-Math-Instruct-1.5B/7B/72B. To provide a comprehensive understanding of the technical developments behind Qwen2.5-Math, we also offer a detailed overview of its predecessor, Qwen2-Math (Qwen, 2024).

We introduce a series of self-improvement techniques to develop Qwen2.5-Math models on top of the Qwen2-Math. Self-improvement techniques take advantage of supervision from large language models themselves (Cao et al., 2024). Specifically, we apply self-improvement from three aspects during the training of Qwen2.5-Math. In pre-training, we employ Qwen2-Math-Instruct to synthesize math queries and corresponding responses on a large scale to enrich the pre-training corpus of Qwen2.5-Math. In post-training, we train a reward model on massive sampling from previous models and apply it to the iterative evolution of data in supervised fine-tuning. The better mathematical models trained from this enhancement lead to a more robust reward model, Qwen2.5-Math-RM. Then, we use this reward model in reinforcement learning and best-of-N sampling during inference. Synthetic data and judgment play a significant role in the enhancement of Qwen2.5-Math compared with its predecessor.

Specifically, the overall pipelines for developing Qwen2-Math and Qwen2.5-Math are illustrated in Figure 2. First, the Qwen2-Math base models are trained on a high-quality mathematical pre-training dataset called the Qwen Math Corpus v1, which contains approximately 700 billion tokens. Second, we train a math-specific reward model Qwen2-Math-RM, derived from Qwen2-Math-72B, to create the Qwen2-Math-Instruct models. This reward model is used to construct Supervised Fine-Tuning (SFT) data through Rejection Sampling (Yuan et al., 2023). Moreover, the reward model plays a key role in the reinforcement learning stage, where we employ Group Relative Policy Optimization (GRPO) (Shao et al., 2024) following SFT. Third, leveraging the Qwen2-Math-72B-Instruct model, we synthesize additional high-quality mathematical pre-training data, which serves as the foundation for Qwen Math Corpus v2. This updated corpus contains over 1 trillion tokens and is used to pre-train the Qwen2.5-Math models. Lastly, similar to the process used for the Qwen2-Math-Instruct models, we construct the Qwen2.5-Math-RM and Qwen2.5-Math-Instruct models. An important distinction in this stage is the inclusion of both English and Chinese Chain-of-Thought (CoT) reasoning data, as well as Tool-Integrated Reasoning (TIR) data, for training the Qwen2.5-Math-Instruct models, as opposed to using only English CoT data as was done for Qwen2-Math-Instruct.

We evaluate our math-specific models on eight English and Chinese math benchmarks. Notably, the Qwen2.5-Math-7B base model achieves scores of 91.6, 55.4, and 57.6 on GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021b), and GaoKao Math Cloze (Zhang et al., 2023), respectively, outperforming the Qwen2-72B (Yang et al., 2024) general model, which achieves scores of 89.5, 51.1, and 55.9 on the same datasets. Additionally, the Qwen2.5-Math-72B base model sets a new state-of-the-art on the MATH benchmark, achieving a score of 66.8—an improvement of 5.3 points over Qwen2-Math-72B and 15.7 points over Qwen2-72B.

For the Instruct models, in CoT mode, the Qwen2.5-Math-1.5B-Instruct model surpasses the performance of all currently available open-source models on most metrics, including models as large as 70B parameters. Furthermore, the Qwen2.5-Math-7B-Instruct model nearly matches the performance of the Qwen2-Math-72B-Instruct model, indicating that improvements to the training data and strategy can, to a certain extent, compensate for the scaling up of parameters. The Qwen2.5-Math-72B-Instruct model outperforms the Qwen2-Math-72B-Instruct model by an average margin of 4.4 and 6.1 points in English and Chinese, respectively, establishing itself as the best open-source mathematical model currently available. Moreover, all model sizes demonstrate significant improvements in their Chinese math problem-solving capabilities. In our newly introduced TIR mode, performance sees further enhancement compared to CoT. For instance, the 72B model achieves close to 90 points on the MATH benchmark, and even the 1.5B model scores around 80, demonstrating that Qwen2.5 is now highly proficient at leveraging the Python Interpreter for accurate mathematical computation.

![](images/fig02_development_pipelines.jpg)  
Figure 2: The development pipelines of Qwen2-Math and Qwen2.5-Math.

## 2 QWEN2.5-MATH PRE-TRAINING

In mathematical pre-training, our primary focus is on constructing a high-quality dataset rich in mathematical content. This dataset encompasses a wide variety of sources, including math-related web texts, code snippets, encyclopedias, exam questions, and synthetic mathematical data generated by Qwen2 (Yang et al., 2024). The process of assembling this pre-training dataset involves several key steps: data recall, deduplication, filtering, data synthesis, and optimization of the data mixture. The final curated dataset, which forms the foundation of our pre-training, is termed the Qwen Math Corpus v1. The Qwen2-Math base models, initialized with Qwen2-1.5B/7B/72B, undergo continuous pre-training using the Qwen Math Corpus v1.

Prior to the construction of Qwen Math Corpus v1, we observe that the suboptimal performance of general language models in mathematical reasoning stems from an insufficiency of mathematical data during pre-training. The existing endeavors pre-training to large-scale, specialized LLMs focused on mathematics (Shao et al., 2024; Ying et al., 2024; Lewkowycz et al., 2022a; Azerbayev et al., 2024) have unequivocally demonstrated the value of extracting a considerable corpus of mathematical texts from digital databases. Our initial strategy involves the recall of mathematical data from web sources, such as Common Crawl, to escalate the quantity of data. Concretely, we train a FastText (Joulin et al., 2016) classifier utilizing high-quality mathematical seed data and general text data. We leverage iterative training with more math data each epoch to continuously enhance the performance of the classifier. To recognize the missing mathematical-related data in the corpus pool, we leverage meta-information, such as URLs, from the recalled data to expand the data pool for mathematical data retrieval. Subsequently, deduplication techniques, including MinHash (Broder, 2000), are employed to filter out similar mathematical documents.

Upon collecting a substantial volume of mathematical data, our focus shifts toward enhancing its quality. For this, we implement a language-model-based filtering technique to further curate the dataset. Specifically, we utilize the Qwen2-0.5B-Instruct model (Yang et al., 2024), augmented with prompt engineering, to evaluate the quality of potential data entries. Data that receive higher scores, indicating higher quality according to the language model, are prioritized for inclusion in the final dataset. Beyond recalling a diverse set of mathematical documents and filtering out low-quality data, we draw inspiration from previous efforts in generating synthetic mathematical data (Yue et al., 2024; Zhou et al., 2024). We employ the Qwen2-72B-Instruct model to synthesize a large amount of mathematical pre-training corpus. At this stage, the high-quality mathematical data already collected are used as reference materials. Using the Qwen2-72B-Instruct model, we: (1) extract and refine existing mathematical question-answer data from these references, and (2) directly generate new mathematical question-answer pairs.

In the final phase, we conduct ablation studies on data mixture using a small math-specific language model, Qwen2-Math-1.5B. Based on the findings, we construct the Qwen Math Corpus v1, which comprises 700 billion tokens in total. We initialize the Qwen2-Math-1.5B/7B/72B pre-training with intermediate checkpoints from the corresponding Qwen2-1.5B/7B/72B base models. These models are then continuously pre-trained on Qwen Math Corpus v1 with a context length of 4K.

Following the training of the Qwen2-Math base models, we further upgrade them to Qwen2.5-Math models through three primary avenues: (1) We utilize the Qwen2-Math-72B-Instruct model, further post-trained with the steps described in Section 3, to synthesize additional high-quality mathematical pre-training data. 2) We aggregate more high-quality mathematical data, especially in Chinese, sourced from web documents, books, and code repositories across multiple recall cycles. As a result of these efforts, we compile the Qwen Math Corpus v2 for Qwen2.5-Math-1.5B/7B/72B pre-training, while maintaining a context length of 4K. Compared to Qwen Math Corpus v1, the total token count of Qwen Math Corpus v2 escalates from 700B to over 1T. (3) Instead of initializing from the Qwen2 series, we leverage the Qwen2.5 series base models for parameter initialization, as they exhibit enhanced capabilities in language understanding, code generation, and text reasoning. Qwen2.5-Math models are continuously pre-trained on Qwen Math Corpus v2 under a math pre-training setup similar to Qwen2-Math. Benefiting from the improvements in both the dataset and the base model, Qwen2.5-Math models demonstrate further advancements in mathematical reasoning abilities beyond Qwen2-Math.

## 3 QWEN2.5-MATH POST-TRAINING

After completing extensive mathematical pre-training, we proceed with post-training to further augment the mathematical logical reasoning capabilities of Qwen-Math, specifically focusing on Chain-of-Thought (CoT) and Tool-Integrated Reasoning (TIR). Our investigation is particularly focused on two key challenges: (1) How to automatically generate a substantial volume of highquality and reliable CoT and TIR annotations, and (2) How to effectively leverage these annotations for both Supervised Fine-Tuning and Reinforcement Learning.

## 3.1 SUPERVISED FINE-TUNING

We aim for Qwen-Math to excel in two core capabilities: solving math problems through step-by-step natural language reasoning (Wei et al., 2022), and leveraging external tools (e.g., a Python interpreter) to address complex mathematical or algorithmic reasoning tasks (Yue et al., 2023). We have constructed dedicated datasets for both Chain-of-Though (CoT) and Tool-integrated Reasoning (TIR) and combined these datasets to train the model jointly. All models are trained for 3 epochs with a sequence length of 4,096 tokens. For the 72B model, we use a batch size of 256 and a learning rate of $5 \times 1 0 ^ { - 6 }$ . For the 1.5B and 7B models, we set the batch size to 128 and the learning rate to $2 \times 1 0 ^ { - 5 }$ During training, the learning rate gradually decays to a final value of $7 \times 1 0 ^ { - 7 }$

## 3.1.1 CHAIN-OF-THOUGHT DATA SYNTHESIS

Query Construction. The chain-of-thought dataset comprises a wide-ranging collection of 580K English and 500K Chinese mathematical problems, including both annotated and synthesized items. The annotated problems are derived from well-established sources such as the training set of GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021b), and NuminaMath (LI et al., 2024). In an effort to bolster the Chinese reasoning capabilities of Qwen2.5-Math, we have further enriched the dataset with additional Chinese mathematical problems from exclusive K-12 problem collections. The synthesized problems are evolved from the annotated ones using the MuggleMath approach (Li et al., 2024b). To maintain a balanced distribution across varying levels of problem complexity, we utilize a difficulty-scoring model to categorize our problem set effectively.

Response Construction. We adopt an iterative approach that leverages rejection sampling, guided by reward modeling and annotated answers, to incrementally enhance the quality of responses (Yuan et al., 2023). At each iteration, the current best model is deployed to generate multiple reasoning pathways for the given problems, expanding the pool of candidate solutions. For problems with annotated answers, we select the top-k reasoning paths with correct final answers from the pool. For synthesized problems lacking definitive answers, we implement a weighted majority voting mechanism to deduce the most plausible correct reasoning paths. From these, we choose the top-k pathways that receive the highest reward scores. In the development of Qwen2.5-Math, an additional iteration is conducted using the Qwen2-Math-Instruct models to polish the quality of responses further. The final CoT training set encompasses 2000K English samples and 500K Chinese samples.

## 3.1.2 TOOL-INTEGRATED REASONING DATA SYNTHESIS

It is important to recognize that while CoT prompting plays a crucial role in enhancing the reasoning skills of large language models, it faces challenges in achieving computational accuracy and in handling complex mathematical or algorithmic problems, such as finding the roots of quadratic equations or computing the eigenvalues of matrices (Yue et al., 2023). To overcome these limitations and improve the model’s proficiency in precise calculations, symbolic manipulation, and algorithmic reasoning, we have developed a dataset that incorporates a tool-integrated reasoning format. This innovative format enables the model to leverage a Python interpreter as an auxiliary resource in reasoning tasks.

Query Construction. The tool-integrated reasoning dataset consists of 190K annotated problems and 205K synthesized problems. The annotated problems are sourced from the training sets of established benchmarks, including GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021b), CollegeMath (Tang et al., 2024a), and NuminaMath (LI et al., 2024). The synthesized problems are generated by employing techniques from MuggleMath (Li et al., 2024b) and DotaMath (Li et al., 2024a) designed to facilitate query evolution within the GSM8K and MATH training sets. Additionally, we have selected 75K annotated problems for translation into Chinese using the Qwen2- 72B model (Yang et al., 2024), aimed at enhancing the model’s reasoning capabilities in Chinese.

Response Construction. For the annotated problems, we utilize an online Rejection Fine-Tuning (RFT) (Yuan et al., 2023; Singh et al., 2024) approach to iteratively generate tool-integrated reasoning paths whose final answers align with the reference answers. In each RFT iteration, we carry out multiple nucleus samplings with the currently best model at various temperatures, increasing the sample size for particularly challenging problems. After each iteration, to enhance data diversity, we apply a deduplication process to the responses, and the resulting cleaned dataset is then used to fine-tune the model for the next iteration. For the synthesized problems, we employ the optimal model derived from the online RFT process to generate reasoning samples. Majority voting is employed to select the most probable correct reasoning paths, which are subsequently incorporated into the overall dataset.

## 3.2 REWARD MODEL TRAINING

To provide supervisory signals beyond merely the final answer during both the selection of supervised fine-tuning data and the subsequent stages of reinforcement learning training, we have developed a mathematical reward model for Qwen2-Math and Qwen2.5-Math, referred to as Qwen2-Math-RM and Qwen2.5-Math-RM, respectively. These reward models are specifically designed to guide the model throughout the training process by offering more granular feedback on the quality of reasoning and intermediate steps, ultimately facilitating more robust model improvements.

## 3.2.1 DATA SYNTHESIS

In the development of Qwen2-Math-RM, we utilize 206K English mathematical problems, each paired with 6 candidate responses sampled from an intermediate version of Qwen2-Math. For Qwen2.5-Math-RM, we further enhance its support for both the Chinese language and TIR mode, training it with a more diverse set of 361K English and 257K Chinese mathematical problems, with each problem accompanied by 6 responses sampled from Qwen2.5-Math. This expansion ensures that Qwen2.5-Math-RM is well-equipped to provide supervisory feedback across a broader range of problem types and languages.

To establish the preference signals among the responses, we check the final answers of the responses to determine their correctness. Responses with the correct answers are labeled as positive, while those with incorrect answers are labeled as negative, thereby naturally creating a ranking relationship among the responses. We then filter out any cases where all responses are either entirely correct or entirely incorrect. However, to avoid the potential drawback of retaining only overly simplistic data, we enrich the dataset with responses from various intermediate versions and models of different sizes. This strategy ensures a more balanced distribution of query difficulty and maintains an even ratio of positive to negative responses.

## 3.2.2 TRAINING STRATEGY

We initialize the reward model from the supervised fine-tuning model. In terms of architecture, we replace the language modeling head originally used for next-token prediction with a scalar-value head, consisting of two linear layers. As previously mentioned, each query in the reward model’s training dataset is paired with 6 responses, comprising both positive and negative candidates. If there are k positive responses, then the remaining $6 - k$ are negative. Following Ouyang et al. (2022), the loss function for the reward model can therefore be formulated as follows:

$$
\mathcal { L } _ { r m } ( \theta ) = - \frac { 1 } { k \times ( 6 - k ) } E _ { ( x , y _ { p o s } , y _ { n e g } ) \sim D } \left[ \log \left( \sigma \left( r _ { \theta } ( x , y _ { p o s } ) - r _ { \theta } ( x , y _ { n e g } ) \right) \right) \right] .\tag{1}
$$

Here, $r _ { \theta } ( x , y )$ denotes the output of the reward model, where x represents the problem and $y$ is the corresponding response. Rather than breaking these into multiple individual pairs and computing the loss in a pairwise fashion, we adopt a listwise approach to compute the ranking loss directly over valid pairs. This method enhances both training efficiency and effectiveness.

## 3.3 REINFORCEMENT LEARNING

Query Selection. The queries for reinforcement learning training are selected from the reward model’s training set. We leverage supervised fine-tuning models with varying sizes to resample 8 responses for each query, with each response classified as either correct or incorrect by comparing it to the gold-standard answer. In the reinforcement learning stage, our primary goal is to ensure that the model consistently produces correct answers for queries where a correct response is possible. Therefore, we only retain queries for which 2 to 5 out of the 8 responses are correct. Queries with fewer than 2 correct answers are excluded as they indicate that the current Math model lacks the fundamental capability to learn from them. Likewise, queries with more than $5$ correct responses are omitted since the model already demonstrates competence in these cases and no further training is necessary. In the end, we retain 66K queries for training.

Group Relative Policy Optimization (GRPO). As introduced by Shao et al. (2024), GRPO is a reinforcement learning method specifically designed for large language models, obviating the need for additional value function approximation as in PPO. GRPO uses the average rewards of a group of sampled outputs as a baseline to calculate the advantages of each output. The objective of GRPO is defined as Eq. 2:

$$
\begin{array} { l } { \mathcal { I } _ { G R P O } ( \theta ) = \mathbb { E } _ { [ q \sim P ( Q ) , \{ o _ { i } \} _ { i = 1 } ^ { G } \sim \pi _ { \theta _ { o l d } } ( O | q ) ] } } \\ { \displaystyle \frac { 1 } { G } \sum _ { i = 1 } ^ { G } \frac { 1 } { | o _ { i } | } \sum _ { t = 1 } ^ { | o _ { i } | } \lbrace \operatorname* { m i n } _ { \overline { { \pi } } _ { \theta _ { o l d } } ^ { i , t } } \hat { A } _ { i , t } , \mathrm { c l i p } ( \pi _ { \overline { { \pi } } _ { \theta _ { o l d } } ^ { i , t } , 1 - \epsilon , 1 + \epsilon ) } \hat { A } _ { i , t } \rbrace - \beta \mathbb { D } _ { K L } [ \pi _ { \theta } | | \pi _ { \mathrm { r e f } } ] \rbrace , } \end{array}\tag{2}
$$

where $\pi ^ { i , t } = \pi ( o _ { i , t } | q , o _ { i , < t } )$ , G is the number of responses in a group. $\pi _ { r e f } , \pi _ { \theta } .$ , and $\pi _ { o l d }$ are reference, training, and sampling models, respectively. q and $\{ o _ { i } \} _ { i = 1 } ^ { G }$ are questions and generated responses set in training. The advantage of each responses ${ \hat { A } } _ { i }$ is calculated by $\begin{array} { r } { \hat { A } _ { i } = \frac { r _ { i } - \mathrm { m e a n } \left( r _ { i } \right) } { \mathrm { s t d } \left( r _ { i } \right) } } \end{array}$ Then this sequence-level advantage is applied to each token in the response as $\hat { A } _ { i , t }$

Reward Shaping. We combine the rewards from both a rule-based verifier and the reward model to shape the overall reward signal. The rule-based verifier extracts potential answers from each response and compares them against the gold-standard answer.

Given that the output of the reward model is denoted as $r _ { m } \in \mathbb { R }$ , and the sparse reward from the rule-based verifier as $r _ { v } \in \{ 0 , 1 \}$ }, the overall reward is calculated as follows:

$$
\boldsymbol { r } = \sigma ( \boldsymbol { \alpha } \cdot \boldsymbol { r } _ { m } ) + ( \boldsymbol { r } _ { v } - 1 ) ,\tag{3}
$$

where α is set as 0.5 in all of our experiments.

This shaping mechanism ensures that correct responses consistently receive higher overall rewards compared to incorrect ones. Within each of the correct and incorrect groups, the responses are ranked based on the scores from the reward models. ecially in hard samples.

Implementations. Our experiments are implemented based on the open-source RLHF framework ChatLearn5. The core implementation of our rule-based verifier is similar to the one used in our evaluation6. All policy models in different parameter sizes are trained with the same reward model. We sample 32 responses for each query. Considering a pair of queries and responses as a sample, the number of samples in one episode is 4,096 and 2,048 for training 7B and 72B, respectively. All models are trained with a 512 global batch size. The learning rates are $1 \times 1 0 ^ { - 5 }$ and $\mathrm { 5 \times 1 0 ^ { - 6 } }$ for 7B and 72B, respectively. And the KL coefficient for all training is $1 \times 1 0 ^ { - 3 }$ . We mask all output tokens the Python executor provides in reinforcement learning of tool-integrated reasoning.

## 4 DECONTAMINATION

Decontamination is critical to ensuring unbiased model performance evaluation. Following prior work (Yang et al., 2024), we exclude potentially contaminated training samples using 13-gram matching. To improve the accuracy of this matching process, we perform text normalization, removing irrelevant punctuation and symbols. To further reduce false negatives, particularly for common mathematical expressions, we introduce an additional criterion: the ratio of the longest common subsequence must exceed 0.6 for a sample to be considered contaminated. For pre-training data, we filter potentially contaminated samples against datasets such as GSM8K (Cobbe et al., 2021) and MATH (Hendrycks et al., 2021b). When dealing with post-training data, including SFT data, RM training data, and the RL query set, we exclude any potentially contaminated problems or solutions across all reported evaluation datasets. These evaluation datasets include GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021b), Minerva Math (Lewkowycz et al., 2022b), Gaokao 2023 En (Liao et al., 2024), Olympiad Bench (He et al., 2024), College Math (Tang et al., 2024b),

MMLU STEM (Hendrycks et al., 2021a), GaoKao (Zhong et al., 2024), CMATH (Wei et al., 2023), CN Middle School 24, AIME 24, and AMC 23. During the analysis of contaminated samples, we identify that some existing training datasets (e.g., the MATH training dataset) contain a significant proportion of problems that share highly similar concepts or structures with those found in test datasets. Although these variations are not exact duplicates, they could potentially compromise the integrity of our evaluation. Therefore, we continue to exclude such samples from the training corpora. Table 1 provides examples of similar problems identified across the training and test sets.

Problems from MATH train (filtered):

What is the remainder when 1 + 2 + 3 + 4 + · · · + 9 + 10 is divided by 8?

For how many integer values of n between 1 and 1000 inclusive does the decimal representation of $\frac { n } { 1 4 0 0 }$ terminate?

Problems from MATH test:

Krista put 1 cent into her new bank on a Sunday morning. On Monday she put 2 cents into her bank. On Tuesday she put 4 cents into her bank, and she continued to double the amount of money she put into her bank each day for two weeks. On what day of the week did the total amount of money in her bank first exceed \$2?

What is the remainder when 1 + 2 + 3 + 4 + · · · + 9 + 10 is divided by 9?

For how many integer values of n between 1 and 1000 inclusive does the decimal representation of $\frac { n } { 1 3 7 5 }$ terminate?

Krista put 1 cent into her new bank on a Sunday morning. On Monday she put 2 cents into her bank. On Tuesday she put 4 cents into her bank, and she continued to double the amount of money she put into her bank each day for two weeks. On what day of the week did the total amount of money in her bank first exceed \$5?

Table 1: Examples of filtered samples in the MATH training set with similar samples in the test set.

## 5 EVALUATION

## 5.1 BASE MODELS

We evaluate our Qwen2-Math and Qwen2.5-Math base models on three widely used English math benchmarks GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021b), and MMLU-STEM (Hendrycks et al., 2021a). In addition, we also evaluate three Chinese math benchmarks CMATH (Wei et al., 2023), GaoKao Math Cloze (Zhong et al., 2024), and GaoKao Math QA (Zhong et al., 2024). All evaluations are tested with few-shot chain-of-thought prompting. The prompts of these benchmarks are shown in Appendix B. For general models, we report the results on LLama-3.1- 8B/70B/405B (AI@Meta, 2024) and Qwen2-1.5B/7B/72B (Yang et al., 2024). For specific models, DeepSeekMath-Base-7B (Shao et al., 2024), DeepSeek-Coder-V2-Lite-Base (Zhu et al., 2024), and Intermln2-Math-Base-20B (Ying et al., 2024) are used as baselines.

The results are shown in Table 2. We can see that the smallest model of the Qwen2.5-Math series, Qwen2.5-Math-1.5B, outperforms all specific baselines on GSM8K, MATH, CMATH, GaoKao Math Cloze, and Gaokao Math QA. Furthermore, the medium-size model, Qwen2.5-Math-7B, obtains 91.6 and 55.4 scores on GSM8K and MATH, which outperforms Qwen2-72B with 89.5 and 51.1, and Llama-3.1-405B with 89.0 and 53.8. Our flagship Qwen2.5-Math-72B achieves new SOTA on MATH, CMATH, Gaokao Math Cloze, and Gaokao Math QA, which obtains 66.8 on MATH. Compared to Qwen2-Math-1.5B/7B/72B, Qwen2.5-Math-1.5B/7B/72B have achieved significant improvements on all benchmarks. For example, Qwen2.5-Math-1.5B/7B/72B obtains 5.4, 5.0, 6.3 scores improvement on MATH, and 3.4, 12.2, 19.8 scores improvement on Gaokao Math QA, which demonstrates the effectiveness of our Qwen Math corpus v2.

## 5.2 INSTRUCTION MODELS

We evaluate Qwen2-Math-Instruct on mathematical benchmarks in both English and Chinese. In addition to the widely-used benchmarks, such as GSM8K (Cobbe et al., 2021) and MATH (Hendrycks et al., 2021b), we also involve more exams that are more challenging to fully inspect the capabilities of Qwen2-Math-Instruct and Qwen2.5-Math-Instruct, such as OlympiadBench (He et al., 2024),

<table><tr><td rowspan="2">BENCHMARK MODEL</td><td colspan="3">EN</td><td colspan="3">ZH</td></tr><tr><td>GSM8K 8-shot</td><td>MATH 4-shot</td><td>MMLU STEM 4-shot</td><td>CMATH 6-shot</td><td>GaoKao Math Cloze 5-shot</td><td>GaoKao Math QA 4-shot</td></tr><tr><td colspan="7">General Model</td></tr><tr><td>Llama-3.1-8B</td><td>56.7</td><td>20.3</td><td>53.1</td><td>51.5</td><td>8.5</td><td>28.5</td></tr><tr><td>Llama-3.1-70B</td><td>85.5</td><td>41.4</td><td>78.1</td><td>75.5</td><td>11.9</td><td>43.3</td></tr><tr><td>Llama-3.1-405B</td><td>89.0</td><td>53.8</td><td>-</td><td>-</td><td>-</td><td>-</td></tr><tr><td>Qwen2-1.5B</td><td>58.5</td><td>21.7</td><td>44.8</td><td>55.6</td><td>12.7</td><td>35.6</td></tr><tr><td>Qwen2-7B</td><td>79.9</td><td>44.2</td><td>67.6</td><td>76.7</td><td>37.3</td><td>51.6</td></tr><tr><td>Qwen2-72B</td><td>89.5</td><td>51.1</td><td>79.9</td><td>85.4</td><td>55.9</td><td>72.6</td></tr><tr><td colspan="7">Specific Model</td></tr><tr><td>DeepSeekMath-Base-7B</td><td>64.2</td><td>36.2</td><td>56.5</td><td>71.7</td><td>20.3</td><td>40.7</td></tr><tr><td>DeepSeek-Coder-V2-Lite-Base</td><td>68.3</td><td>38.1</td><td>59.5</td><td>77.8</td><td>25.4</td><td>51.3</td></tr><tr><td>Internlm2-Math-Base-20B</td><td>68.2</td><td>30.4</td><td>63.0</td><td>65.9</td><td>16.9</td><td>40.2</td></tr><tr><td>Qwen2-Math-1.5B</td><td>71.3</td><td>44.4</td><td>50.4</td><td>79.6</td><td>37.3</td><td>50.7</td></tr><tr><td>Qwen2-Math-7B</td><td>80.4</td><td>50.4</td><td>65.7</td><td>83.2</td><td>48.3</td><td>57.3</td></tr><tr><td>Qwen2-Math-72B</td><td>89.1</td><td>60.5</td><td>79.1</td><td>86.4</td><td>72.9</td><td>69.5</td></tr><tr><td>Qwen2.5-Math-1.5B</td><td>76.8</td><td>49.8</td><td>51.3</td><td>83.0</td><td>47.5</td><td>54.1</td></tr><tr><td>Qwen2.5-Math-7B</td><td>91.6</td><td>55.4</td><td>67.8</td><td>85.0</td><td>57.6</td><td>69.5</td></tr><tr><td>Qwen2.5-Math-72B</td><td>90.8</td><td>66.8</td><td>82.8</td><td>89.7</td><td>72.9</td><td>86.3</td></tr></table>

Table 2: The results of Qwen2.5-Math and other base models on English and Chinese mathematical benchmarks. Models are evaluated with few-shot chain-of-thought prompting.

![](images/fig03_math_cot_comparison.jpg)  
Figure 3: The Performance of Qwen2.5-Math-1.5/7/72B-Instruct on MATH by CoT compared to models of the same size.

CollegeMath (Tang et al., 2024a), GaoKao 2023 En (Liao et al., 2024), AIME2024 7, and AMC2023 8. For Chinese mathematical benchmarks, we use CMATH (Wei et al., 2023), GaoKao (including GaoKao I/II 2024 9, GaoKao-Math-QA (Zhong et al., 2024), GaoKao-Math-Cloze (Zhong et al., 2024) and 91 collected GaoKao problems in 2024), and CN Middle School 24 (101 collected problems from China High School Entrance Examination in 2024). We report greedy, Maj@8, and RM@8 performance on all benchmarks in the zero-shot setting, except for the multi-choice benchmarks (including MMLU STEM and multiple-choice problems in GaoKao and CN Middle School 24) with a 5-shot setting.

We take Qwen2-1.5/7/72B-Instruct (Yang et al., 2024), Llama-3.1-8/70B-instruct (AI@Meta, 2024), and GPT4o-2024-08-06 (OpenAI, 2024) as general model baselines. Besides, DeepSeekMath-7B-RL (Shao et al., 2024), DeepSeek-Coder-V2-Lite-Instruct (Zhu et al., 2024), Interlm2-math-plus-7B/20B/mixtral8x7B (Ying et al., 2024), Mathstral-7B-v0.1 (Mistral-AI, 2024), NuminaMath-7/72B-CoT (LI et al., 2024) are taken as specific-model baselines.
<table><tr><td rowspan="2"> $\overbrace { \mathrm { \mathbf { M o d e l } } } ^ { \mathrm { B e n c h m a r k } }$ </td><td colspan="8">EN</td></tr><tr><td>GSM8K</td><td>MATH</td><td>Minerva Math</td><td>GaoKao 2023 En</td><td>Olympiad Bench</td><td>College Math</td><td>MMLU STEM</td><td>Avg.</td></tr><tr><td colspan="9">Chain-of-Thought</td></tr><tr><td>GPT-4o-2024-08-06</td><td>92.9</td><td>81.1</td><td>36.8</td><td>67.5</td><td>43.3</td><td>48.5</td><td>64.2</td><td>62.0</td></tr><tr><td>DeepSeekMath-7B-RL</td><td>88.2</td><td>52.4</td><td>20.6</td><td>43.6</td><td>19.0</td><td>37.5</td><td>64.8</td><td>46.6</td></tr><tr><td>DeepSeek-Coder-V2-Lite-Instruct</td><td>87.6</td><td>61.0</td><td>29.4</td><td>56.1</td><td>26.4</td><td>39.8</td><td>68.6</td><td>52.7</td></tr><tr><td>Internlm2-math-plus-7B</td><td>84.0</td><td>54.4</td><td>17.3</td><td>50.1</td><td>18.8</td><td>36.2</td><td>55.2</td><td>45.1</td></tr><tr><td>Internlm2-math-plus-20B Internlm2-math-plus-mixtral8x7B</td><td>87.9</td><td>56.5 59.4</td><td>20.2</td><td>51.9</td><td>23.1</td><td>37.5 37.5</td><td>63.5</td><td>48.7</td></tr><tr><td></td><td>92.1</td><td></td><td>26.8</td><td>49.6</td><td>25.0</td><td></td><td>71.9</td><td>51.8</td></tr><tr><td>Mathstral-7B-v0.1</td><td>84.9</td><td>56.6</td><td>16.2</td><td>46.0</td><td>21.5</td><td>33.7</td><td>64.0</td><td>46.1</td></tr><tr><td>NuminaMath-7B-CoT</td><td>75.4</td><td>55.2</td><td>19.1</td><td>47.5</td><td>19.9</td><td>36.9</td><td>60.8</td><td>45.0</td></tr><tr><td>NuminaMath-72B-CoT</td><td>90.8</td><td>66.7</td><td>25.0</td><td>58.4</td><td>32.6</td><td>39.7</td><td>64.5</td><td>54.0</td></tr><tr><td>Llama-3.1-8B-Instruct</td><td>76.6</td><td>47.2</td><td>21.7</td><td>38.4</td><td>15.4</td><td>33.8</td><td>60.5</td><td>41.9</td></tr><tr><td>Llama-3.1-70B-Instruct</td><td>94.1</td><td>65.7</td><td>34.2</td><td>54.0</td><td>27.7</td><td>42.5</td><td>80.4</td><td>56.9</td></tr><tr><td>Qwen2-1.5B-Instruct</td><td>64.1</td><td>25.1</td><td>5.5</td><td>19.7</td><td>4.1</td><td>10.4</td><td>46.2</td><td>25.0</td></tr><tr><td>Qwen2-7B-Instruct</td><td>85.7 93.2</td><td>52.9 69.0</td><td>19.5</td><td>36.4</td><td>21.3</td><td>24.5 43.2</td><td>68.2</td><td>44.1</td></tr><tr><td>Qwen2-72B-Instruct</td><td>84.2</td><td>69.4</td><td>31.6 29.4</td><td>58.7 59.7</td><td>33.2 31.3</td><td>44.2</td><td>84.4 54.9</td><td>59.0</td></tr><tr><td>Qwen2-Math-1.5B-Instruct</td><td>88.6maj8 92.7rm88</td><td>75.3maj@88 79.9me8</td><td>32.0majj8 36.4m8</td><td> $6 3 . 9 _ { \mathrm { m a j } \oplus 8 }$  68.8m8</td><td>37.6maj@8 43.4rm@8</td><td>46.6maj88 46.8m8</td><td>59.5maj8 74.5rme8</td><td>53.3 57.6maj@8 63.2m@8</td></tr><tr><td>Qwen2-Math-7B-Instruct</td><td>89.9 93.1maj@8 95.1rm 88</td><td>75.1  $8 0 . 2 _ { \tt m a j \tt \theta 8 }$  83.3m8</td><td>34.6 37.1maj@8 39.7rm@</td><td>62.1  $6 8 . 1 _ { \tt m a j \tt G 8 }$   $7 1 . 9 _ { \mathrm { r m } \oplus 8 }$ </td><td>38.2  $4 3 . 7 _ { \mathrm { { m a j } \ell 8 } }$  47.6rm88</td><td>45.9  $4 7 . 8 _ { \mathrm { m a j \ell \ell } }$  47.9rm88</td><td>63.8 73.2maj@8 78.2me8</td><td>58.5 63.3maj@8 66.2m8</td></tr><tr><td>Qwen2-Math-72B-Instruct</td><td>96.7  $9 7 . 0 _ { \mathrm { m a j \ell \ell ^ { - } } }$   $9 6 . 7 _ { \mathrm { z m } \oplus 8 }$ </td><td>84.0  $8 6 . 8 _ { \mathrm { m a j \ell \ell } }$   $8 6 . 7 _ { z m \ell \ell }$ </td><td>40.1 45.2maj88 47.1me88</td><td>68.3 71.4maje8  $7 2 . 5 _ { \mathrm { r m \ell s } }$ </td><td>43.0  $4 8 . 9 _ { \mathrm { m a j \ell \ell } }$   $5 2 . 4 _ { z m \ell 8 }$ </td><td>47.9 48.7maje8 48.2rm88</td><td>79.9 83.1maj8  $8 2 . 2 _ { z m \not \in \mathcal { Q } }$ </td><td>65.7 68.7maje8 6.4m@8</td></tr><tr><td>Qwen2.5-Math-1.5B-Instruct</td><td>84.8 89.5maj08  $9 4 . 1 _ { \mathrm { r m } \oplus \mathrm { ~ 8 ~ } }$ </td><td>75.8  $8 0 . 3 \mathrm { \ m a j \ } \mathbb { 8 }$   $8 3 . 9 _ { \mathrm { r m } \oplus \mathrm { \ell } }$ </td><td>29.4  $3 2 . 0 _ { \tt m a j \theta 8 }$   $3 7 . 5 _ { \mathrm { z m  { \mathbb { Q } }  { \ell } } }$ </td><td>65.5  $6 8 . 8 _ { \tt m a j \tt G B }$   $7 3 . 0 _ { \mathrm { r m } \oplus 8 }$ </td><td>38.1  $4 3 . 9 _ { \mathrm { { m a j } \ell 8 } }$   $4 7 . 3 _ { \mathrm { z m } \oplus 8 }$ </td><td>47.7 48.9maje8  $5 0 . 2 _ { \mathrm { z m } \oplus 8 }$ </td><td>57.5 60.7maje8  $6 5 . 2 _ { \mathrm { z m } \oplus \mathrm { \AA } }$ </td><td>56.9 60.6maj@8 64.5rm8</td></tr><tr><td>Qwen2.5-Math-7B-Instruct</td><td> $9 5 . 2$   $9 6 . 7 _ { \mathrm { m a j } \ell 8 }$   $9 7 . 9 _ { \mathrm { z m } \oplus 8 }$ </td><td>83.6  $8 7 . 1 _ { \tt m a j \tt \& 8 }$   $8 8 . 5 _ { z m \thinspace \oplus \thinspace 8 }$ </td><td>37.1  $4 1 . 2 _ { \mathrm { m a j } \ell 8 }$   $4 2 . 6 _ { \mathrm { z m } \oplus \mathrm { 8 } }$ </td><td>66.8  $7 2 . 5 _ { \mathrm { m a j } \oplus 8 }$   $7 5 . 1 _ { \mathrm { r m } \mathrm { \ell } 8 }$ </td><td>41.6  $4 4 . 4 _ { \mathrm { m a j \ell \ell 8 } }$   $4 9 . 9 _ { \mathrm { z m } \oplus 8 }$ </td><td>46.8  $4 7 . 8 _ { \mathrm { m a j } \ell 8 }$   $4 9 . 6 _ { z m \ : \mathrm { 8 } }$ </td><td>71.9 73.8maj@8  $7 8 . 7 _ { \mathrm { r m } \oplus \mathrm { \ell } }$ </td><td>62.9 66.2maj8 68.9m8</td></tr><tr><td>Qwen2.5-Math-72B-Instruct</td><td>95.9  $9 6 . 0 _ { \mathrm { m a j \ell \ell ^ { - } } }$   $9 6 . 4 _ { \mathrm { r m } \oplus \mathrm { ~ 8 ~ } }$ </td><td>85.9  $8 8 . 6 _ { \mathrm { m a j } \ell ^ { 8 } }$   $8 9 . 8 _ { \ z m \not \in 8 }$ </td><td>44.1  $4 7 . 8 _ { \tt m a j \tt \perp 8 }$   $4 7 . 4 _ { z m \textcircled { \div } 8 }$ </td><td>71.9 73.8maj@8  $7 6 . 9 _ { \mathrm { r m } \oplus \mathrm { \AA } }$ </td><td>49.0  $5 0 . 1 _ { \mathrm { m a j \ell \ell 8 } }$   $5 4 . 5 _ { \mathrm { r m } \oplus \mathrm { \AA } }$ </td><td>49.5  $5 0 . 2 _ { \mathrm { m a j \ell \ell } }$   $5 0 . 6 _ { \mathrm { z m } \oplus 8 }$ </td><td>80.8 84.9maj@8  $8 0 . 1 _ { z m \cap \ell }$ </td><td>68.2 70.2maj8 70.8rm88</td></tr><tr><td>Qwen2.5-Math-1.5B-Instruct</td><td>83.7</td><td>79.9</td><td>33.5</td><td>TOOL-INTEGRATED REASONING 67.8</td><td>49.2</td><td>54.8</td><td>56.9</td><td>60.8</td></tr><tr><td></td><td> $9 0 . 0 _ { \mathrm { m a j \ell \ell 8 } }$   $9 3 . 3 _ { z m \ell 8 }$   $9 4 . 6$ </td><td> $8 5 . 3 _ { \mathrm { m a j } \ell ^ { 8 } }$   $8 8 . 9 _ { z m \ell \ell }$  85.2</td><td>35.a j88  $3 9 . 7 _ { z m \tt \tt \tt \tt \tt \tt \tt \tt \tt \tt 0 8 }$  39.0</td><td> $7 1 . 9 _ { \mathrm { m a j } \ @ 8 }$   $7 8 . 7 _ { \mathrm { r m } \oplus \mathrm { ~ 8 ~ } }$  71.4</td><td> ${ 5 4 . 3 } _ { \mathrm { m a j \ell 8 } }$   $5 9 . 3 _ { z m \ell \ell }$  55.6</td><td> ${ 5 6 . 3 } _ { \mathrm { m a j \ell \ell s } }$   $5 8 . 8 _ { z m \ell 8 }$  56.0</td><td> $6 0 . 4 _ { \mathrm { m a j \ell \ell } }$   $7 6 . 6 _ { z m \ell \ell }$  70.1</td><td>64.8maj@8 70.8rm@8 67.4</td></tr><tr><td>Qwen2.5-Math-7B-Instruct</td><td> $9 6 . 4 _ { \mathrm { m a j \ell \ell } }$   $9 7 . 6 _ { z m \ell 8 }$   $\mathbf { 9 5 . 8 }$ </td><td> $8 9 . 9 _ { \mathrm { m a j } \ \perp 8 }$   $9 1 . 4 _ { z m \ ` \ell }$   $\mathbf { 8 8 . 1 }$ </td><td>40.8maj8  $4 2 . 3 _ { \mathrm { r m } \oplus \mathrm { \ell } }$ </td><td> $7 6 . 4 \mathrm { _ { m a j \ell \ell } }$   $8 0 . 8 _ { z m \not \in 8 }$ </td><td> $5 8 . 6 _ { \mathrm { m a j \ell \ell 8 } }$   $6 3 . 1 _ { z m \ell 8 }$ </td><td> $5 7 . 2 _ { \mathrm { m a j } \ell 8 }$   $5 8 . 7 _ { \mathrm { z m } \mathrm { 8 } }$ </td><td> $7 1 . 3 \mathrm { _ { m a j \ell \ell } }$   $8 2 . 2 _ { z m \not \in \mathcal { Q } }$ </td><td>70.1maj8  $7 3 . 7 _ { \mathrm { r m } \oplus \mathrm { \ell \ell } }$ </td></tr><tr><td>Qwen2.5-Math-72B-Instruct</td><td> $9 6 . 7 _ { \mathrm { m a j } \ell 8 }$   $9 6 . 4 _ { z m \ : \mathrm { ~ \normalfont ~ 9 ~ 6 ~ } }$ </td><td> $9 1 . 8 _ { \tt m a j \tt \& \tt B }$   $9 2 . 9 _ { \mathrm { z m \hat { \varrho } \hat { \varrho } } }$ </td><td>48.2 48.2maj8  $4 9 . 3 _ { \ z m \oplus 8 }$ </td><td>75.3  $8 3 . 1 _ { \tt m a j \tt \tt \tt \tt \tt \tt \otimes \tt 8 }$   $8 3 . 4 _ { z m \not \in 8 }$ </td><td> $6 0 . 6$   $6 4 . 5 _ { \mathrm { m a j \ell \ell 8 } }$   $6 5 . 9 _ { \mathrm { z m } \oplus \mathrm { 8 } }$ </td><td> $5 7 . 7$   $5 8 . 3 _ { \mathrm { m a j \ell 8 } }$   $5 9 . 7 _ { \mathrm { r m } \oplus 8 }$ </td><td>82.3  $8 5 . 0 _ { \mathrm { m a j \ell \ell } ^ { 8 } }$   $9 0 . 0 _ { z m \ell \ell }$ </td><td>72.6  $7 5 . 4 _ { \mathrm { m a j } \ \perp 8 }$   $7 6 . 8 _ { \ z m \textcircled { 4 } }$ </td></tr></table>

Table 3: The results of Qwen2.5-Math-Instruct and other instruct models on English benchmarks. For CoT, we report few-shot pass@1 performance on MMLU(STEM) and zero-shot pass@1 performance on other benchmarks. For PoT, all benchmarks are evaluated in the zero-shot setting. Except for the pass@1 scores, we also provide the Qwen2-Math and Qwen2.5-Math performance with majority voting and reward model best-of-N among 8 sampled responses. Best pass@1 performance in CoT and TIR are marked in bold.

Let us first analyze the performance on English benchmarks. As shown in Table 3, we can draw the following conclusions: (1) Qwen2-Math-Instruct has demonstrated exceptional capabilities. The 1.5B model achieves an average score higher than any sub-70B model currently available. The 7B model performs on par with Qwen2-72B-Instruct, and Qwen2-Math-72B-Instruct surpasses the latest version of GPT-4o by 3.7 points. (2) The performance of Qwen2.5-Math-Instruct represents a further upgrade over Qwen2-Math-Instruct. In the traditional CoT mode, the 1.5B and 7B Qwen2.5-Math-Instruct models achieve results comparable to the 7B and 72B Qwen2-Math-Instruct models, respectively, demonstrating a cross-scale improvement. Qwen2.5-Math-72B-Instruct achieves an average score of 2.5 points ahead of the current best model and is 6.2 points higher than GPT-4o. This shows that our improvements in training data and strategy can provide an alternative pathway for performance enhancements beyond simply increasing model size. (3) The TIR mode introduced in Qwen2.5- Math-Instruct is highly effective. With the assistance of a Python Interpreter, the 7B model already matches the performance of Qwen2.5-Math-72B-Instruct. This indicates that precise mathematical calculations via external tools can significantly aid LLM reasoning. In many cases, the reasoning process of LLMs is sound, but computational errors can arise. (4) Our RM performs exceptionally well. Across almost all benchmarks and models, RM@N scores are substantially better than Maj@N scores. This provides a reliable performance oracle for improving reinforcement learning strategies in the future. It is likely that we may soon see models with greedy decoding exceeding 90 points on MATH, even for the 7B scale.

<table><tr><td rowspan="2"> $\overbrace { \mathrm { \mathbf { M o d e l } } } ^ { \mathrm { B e n c h m a r k } }$ </td><td colspan="4">ZH</td></tr><tr><td>GaoKao</td><td>CMATH</td><td>CN Middle School 24</td><td>Avg.</td></tr><tr><td colspan="5">Chain-of-Thought</td></tr><tr><td>GPT-4o-2024-08-06</td><td>42.6 33.6</td><td>92.5 86.7</td><td>60.4</td><td>65.2</td></tr><tr><td>DeepSeekMath-7B-RL DeepSeek-Coder-V2-Lite-Instruct</td><td>51.1</td><td>89.8</td><td>67.3 66.3</td><td>62.5 69.1</td></tr><tr><td>Internlm2-math-plus-7B Internlm2-math-plus-20B</td><td>34.5 36.1</td><td>82.7 81.3</td><td>32.7 33.7</td><td>50.0 50.4</td></tr><tr><td>Internlm2-math-plus-mixtral8x7B Mathstral-7B-v0.1</td><td>37.3 31.6</td><td>85.7 76.7</td><td>39.6 42.6</td><td>54.2 50.3</td></tr><tr><td>NuminaMath-7B-CoT</td><td>36.4 47.9</td><td>78.2 87.3</td><td>60.4</td><td>58.3</td></tr><tr><td>NuminaMath-72B-CoT Llama-3.1-8B-Instruct</td><td>30.4</td><td>64.8 86.7</td><td>75.2 43.6</td><td>70.1 46.3</td></tr><tr><td>Llama-3.1-70B-Instruct Qwen2-1.5B-Instruct Qwen2-7B-Instruct</td><td>41.7 17.0 35.1</td><td>65.5 83.5</td><td>59.4 31.7 54.5</td><td>62.6 38.1 57.7</td></tr><tr><td>Qwen2-72B-Instruct</td><td>54.6 46.5</td><td>92.2 84.2  $8 8 . 0 _ { \tt m a j \tt \tt \tt \tt \tt \otimes }$ </td><td>74.3 66.3</td><td>73.7 65.7</td></tr><tr><td>Qwen2-Math-1.5B-Instruct</td><td> $5 0 . 1 _ { \tt m a j \tt \tt \tt \tt \tt \tt \tt \tt \otimes }$   $5 8 . 2 _ { \mathrm { r m } \tt \tt \tt \tt { q } 8 }$  49.0</td><td> $9 2 . 2 _ { \mathrm { r m } \oplus \mathrm { \ell } }$  90.0</td><td> $7 0 . 3 _ { \mathrm { m a j } \oplus 8 }$   $7 5 . 2 _ { \mathrm { z m  { \mathbb { Q } } 8 } }$  69.3</td><td> $6 9 . 5 _ { \tt m a j \tt \tt \tt \tt \tt \tt \otimes }$   $7 5 . 2 _ { \mathrm { r m } \oplus 8 }$  69.4</td></tr><tr><td>Qwen2-Math-7B-Instruct</td><td> $5 9 . 5 _ { \mathrm { m a j \mathbb { \beta } } }$   $6 2 . 7 _ { \tt r m \tt d B }$  59.8</td><td> $9 1 . 7 _ { \tt m a j \tt G 8 }$   $9 4 . 0 _ { \tt r m \tt d 8 }$  92.8  $9 3 . 2 _ { \tt m a j \tt \tt \tt \tt \tt \tt \tt \tt \otimes }$ </td><td> $7 2 . 3 \mathrm { _ { m a j \ell \ell } }$   $7 8 . 2 _ { \mathrm { z m  { \mathbb { Q } } 8 } }$  77.2 79.2maj@8</td><td> $7 4 . 5 \mathrm { \ m a j } \mathrm { \ } \emptyset .$  78.3m 76.6  $7 8 . 0 _ { \mathrm { \ m a j \mathbb { \beta } 8 } }$ </td></tr><tr><td>Qwen2.5-Math-1.5B-Instruct</td><td> $6 1 . 7 _ { \mathrm { m a j } \ @ 8 }$   $6 7 . 7 _ { \tt r m \tt d B }$  62.4  $6 6 . 4 _ { \tt m a j \tt \tt \tt \tt \tt \tt \tt \tt \tt \tt \otimes }$ </td><td> $9 4 . 2 _ { \tt r m \tt d . 8 }$  89.7  $9 1 . 7 _ { \tt m a j \tt G 8 }$ </td><td> $7 8 . 2 _ { \mathrm { z m  { \mathbb { Q } } 8 } }$  76.2  $7 7 . 2 _ { \tt m a j \tt \tt \tt \tt \tt \tt \tt \tt \tt \tt \tt \tt \otimes \tt \tt }$ </td><td>80.0 rm8 76.1  $7 8 . 4 \mathrm { \ m a j \mathbb { \ell } ^ { 8 } }$ </td></tr><tr><td>Qwen2.5-Math-7B-Instruct</td><td> $6 7 . 5 _ { \tt r m \tt d B }$   $6 6 . 3$   $6 8 . 1 _ { \tt m a j \tt \tt \tt \tt \otimes \tt }$ </td><td> $9 4 . 0 _ { \tt r m \tt \tt \otimes \tt }$   $9 1 . 8$   $9 2 . 7 _ { \tt m a j \tt G 8 }$ </td><td> $8 0 . 2 _ { \scriptstyle \mathrm { z m } \scriptscriptstyle \mathrm { Q } 8 }$   $7 3 . 3$   $7 8 . 2 _ { \mathrm { m a j \textmu 8 } }$ </td><td> $8 0 . 6 _ { \ z m \not \in 8 }$  77.1  $7 9 . 7 _ { \mathrm { \ m a j \mathbb { Q } 8 } }$ </td></tr><tr><td>Qwen2.5-Math-72B-Instruct</td><td> $7 2 . 2 _ { \mathrm { z m  { \mathbb { Q } } 8 } }$  68.6  $7 5 . 0 _ { \tt m a j \tt \tt \tt \tt \tt \tt \tt \tt \tt \otimes \tt }$ </td><td> $9 4 . 5 _ { \tt r m \tt d 8 }$  94.3  $9 5 . 3 _ { \tt m a j \tt \tt \tt \tt \tt \tt \otimes }$ </td><td> $8 1 . 2 _ { \scriptstyle \mathrm { z m \ 6 8 } }$  79.2  $7 9 . 2 _ { \tt m a j \tt \tt \tt \tt \tt \tt \tt \tt \tt \tt \otimes \tt \tt }$ </td><td> $8 2 . 6 _ { \ z m \not \in 8 }$  82.7  $8 3 . 2 _ { \mathrm { \ m a j / \ell 8 } }$ </td></tr><tr><td></td><td> $7 6 . 5 _ { \mathrm { z m  { \mathbb { Q } } 8 } }$ </td><td> $9 5 . 7 _ { \tt r m \tt d 8 }$  TOOL-INTEGRATED REASONING</td><td> $8 0 . 2 _ { \scriptstyle \mathrm { z m } \scriptscriptstyle \mathrm { Q } 8 }$ </td><td> $8 4 . 1 _ { \ z m \notin 8 }$ </td></tr><tr><td>Qwen2.5-Math-1.5B-Instruct</td><td> $5 9 . 6$   $6 8 . 3 _ { \mathtt { m a j } \oplus 8 }$ </td><td> $8 9 . 3$   $9 0 . 8 _ { \tt m a j \tt G 8 }$ </td><td>71.3  $7 8 . 2 _ { \mathrm { m a j \textmu 8 } }$   $7 8 . 2 _ { \mathrm { z m  { \mathbb { Q } } 8 } }$ </td><td>73.4  $7 9 . 1 \mathrm { \ m a j \mathbb { \varrho } 8 }$   $7 8 . 5 _ { \ z m \not \in \mathrm { \AA } }$ </td></tr><tr><td>Qwen2.5-Math-7B-Instruct</td><td> $6 4 . 1 _ { z m \mathscr { Q } 8 }$  62.9  $7 0 . 8 _ { \mathtt { m a j } \oplus 8 }$ </td><td> $9 3 . 2 _ { \tt r m \tt d 8 }$   $9 0 . 5 $  92.0maj@8</td><td>75.2  $7 8 . 2 _ { \mathrm { m a j \textmu 8 } }$ </td><td>76.2 80.3maj@8</td></tr><tr><td>Qwen2.5-Math-72B-Instruct</td><td> $7 2 . 9 _ { \mathrm { z m  { \ell } s } }$  68.5  $7 2 . 0 _ { \tt m a j \tt \tt \tt \tt \tt \tt \tt \tt \otimes \tt }$ </td><td> $9 4 . 2 _ { \tt r m \tt d 8 }$  93.0  $9 3 . 5 _ { \tt m a j \tt \tt \tt \tt \tt \tt \tt \otimes }$ </td><td> $8 0 . 2 _ { \scriptstyle \mathrm { z m } \scriptscriptstyle \mathrm { Q } 8 }$  78.2  $7 8 . 2 _ { \mathrm { m a j \textmu 8 } }$ </td><td> $8 2 . 4 _ { \ z m \not \in 8 }$  79.9  $8 1 . 2 _ { \mathrm { ~ m a j } \ @ 8 }$ </td></tr></table>

Table 4: The results of Qwen2.5-Math-Instruct and other instruct models on Chinese benchmarks.

![](images/fig04_tir_vs_cot.jpg)  
Figure 4: The Performance of Qwen2.5-Math-1.5/7/72B-Instruct by using TIR compared to using CoT. We use blue color to represent the performance of TIR, and orange to represent the performance of CoT. It can be seen that TIR can achieve further performance improvement compared to CoT.

Let’s now shift our attention to Table 4 to analyze the performance on the Chinese benchmarks. For Qwen2-Math-Instruct, no specifically Chinese mathematics-related training data was incorporated. However, thanks to Qwen2’s strong language transfer capabilities, the Qwen2-Math-1.5B-Instruct model has already surpassed GPT-4o in terms of the average Chinese score. During the development of Qwen2.5-Math-Instruct, we intentionally integrated Chinese-specific math post-training data, resulting in substantial improvements in Chinese performance. The Qwen2.5-Math-1.5B-Instruct model achieves results similar to Qwen2-Math-72B-Instruct, while Qwen2.5-Math-72B-Instruct outperforms GPT-4o by an impressive 17.5 points. Our RM also exhibits strong performance in Chinese benchmarks. Similar to our results in English, RM@N scores consistently surpass Maj@N scores, highlighting its effectiveness. However, one key difference from the English results is that the TIR mode in Chinese does not show a significant performance advantage over the CoT mode. We will continue to investigate this aspect in future research.

Lastly, we intend to evaluate the model’s ability to solve complex mathematical problems on highly challenging competition benchmarks such as AIME 2024 and AMC 2023. As shown in Table 5, we observe a significant improvement in performance on difficult problems with Qwen2.5-Math-Instruct compared to Qwen2-Math-Instruct. With the support of the RM, Qwen2.5-Math-1.5B-Instruct, using the RM@256 in CoT mode, successfully solves 29 out of 40 problems on AMC 2023, significantly

outperforming NuminaMath-72B CoT. Moreover, Qwen2.5-Math-72B-Instruct nearly achieves a perfect score in TIR mode, solving almost all the problems. We attribute this impressive performance to the extensive amounts of challenging mathematical data collected and synthesized during pretraining. On the extremely difficult AIME 2024 benchmark, Claude3 Opus, GPT-4 Turbo, and Gemini 1.5 Pro manage to solve only 1 or 2 questions out of 30. In contrast, Qwen2.5-Math-72B-Instruct solves 9 problems in Greedy decoding CoT mode and 12 problems in TIR mode. With the help of the RM, Qwen2.5-Math-7B-Instruct could even solve up to 21 problems, further demonstrating the outstanding mathematical problem-solving ability of Qwen2.5-Math-Instruct.
<table><tr><td>MODEL</td><td>AIME24</td><td>AMC23</td></tr><tr><td colspan="3">Chain-Of-Thought</td></tr><tr><td>Claude 3 Opus</td><td>2/30</td><td></td></tr><tr><td>GPT-4Turbo Gemini 1.5 Pro</td><td>1/30 2/30</td><td></td></tr><tr><td>Gemini Math-Specialized 1.5 Pro</td><td>7/30</td><td></td></tr><tr><td></td><td> $8 / 3 0 _ { \mathrm { r m  { \ell } { = } 2 5 6 } }$  1/30</td><td>- 21/40</td></tr><tr><td>NuminaMath-72B CoT</td><td> $3 / 3 0 _ { \mathrm { m a j \mathbb { \ell } 6 4 } }$  1/30</td><td>24/40maj@64 18/40</td></tr><tr><td>Qwen2-Math-1.5B-Instruct</td><td>5/30rm256 4/30</td><td>25/40rm@256 25/40</td></tr><tr><td>Qwen2-Math-7B-Instruct Qwen2-Math-72B-Instruct</td><td>6/30rm256 6/30 8/30maj64 9130rm64</td><td>29/40rm256 24/40 29/40maj@64</td></tr><tr><td>Qwen2.5-Math-1.5B-Instruct</td><td>11/30m@256 3/30</td><td>29/40rm@64 28/40rm@256 24/40</td></tr><tr><td>Qwen2.5-Math-7B-Instruct</td><td>10/30rm@256 5/30 10/30rm@256</td><td>29/40rm@256 25/40</td></tr><tr><td>Qwen2.5-Math-72B-Instruct</td><td>9/30  $9 / 3 0 _ { \mathrm { m a j \ell \in \Theta 4 } }$ </td><td>30/40rm@256 28/40 30/40maj64</td></tr><tr><td></td><td>13/0 @64 13/30rm@256</td><td>29/40rm64 30/40rm256</td></tr><tr><td>Qwen2.5-Math-1.5B-Instruct</td><td>TOOL-INTEGRATED REASONING 7/30</td><td>20/40</td></tr><tr><td></td><td>9/30maj@64 18/30rm@64 9/30maj@256 19/0m@256</td><td>31/40maj@64 36/40rm@64 32/40maj@256</td></tr><tr><td>Qwen2.5-Math-7B-Instruct</td><td>6/30 13/30maj@64 21/30m64</td><td>36/40rm@256 27/40 31/40maj@64 33/40rm@64</td></tr><tr><td>Qwen2.5-Math-72B-Instruct</td><td> $1 4 / 3 0 _ { \mathrm { m a j } \ell 2 5 6 }$   $2 1 / 3 0 _ { \mathrm { r m \ell } 2 5 6 }$  12/30  $\begin{array} { l } { { 1 4 / 3 0 _ { \mathrm { m a j } \ @ 6 4 } } } \\ { { 1 8 / 3 0 _ { \mathrm { r m \thinspace \sharp 6 4 } } } } \end{array}$ </td><td>31/40maj@256  $3 5 / 4 0 _ { \mathrm { r m \ell 2 5 6 } }$  28/40  $3 6 / 4 0 _ { \mathrm { m a j } \perp 6 4 }$ </td></tr></table>

Table 5: The results on the mathematics competition problems.

## 6 CONCLUSION

In this report, we introduce Qwen2.5-Math, which features several key technical highlights: (1) extensive use of synthesized mathematical data from Qwen2-Math during the pre-training phase, (2) iterative generation of fine-tuning data and reinforcement training guided by the reward model during the post-training and inference phase and (3) support for bilingual (English and Chinese) queries, along with chain-of-thought and tool-integrated reasoning capabilities. As a result, Qwen2.5-Math represents the most advanced open-source math model series to date. The Qwen2.5-Math-1.5B-Instruct model already surpasses most previous 70B math models, while the Qwen2.5-Math-7B-Instruct matches the performance of Qwen2-Math-72B-Instruct. Our flagship model, Qwen2.5-Math-7B-Instruct, outperforms Qwen2-Math-72B-Instruct with an average score increase of 4.4 points across 7 datasets. We hope that the advances we’ve made with specialized models like Qwen2.5-Math will continue to strengthen the overall capabilities of the Qwen model and bring us closer to achieving artificial general intelligence.

## ACKNOWLEDGEMENTS

We sincerely appreciate the support from other members of the Qwen team. We would also like to thank the ChatLearn team from PAI, Alibaba, for their infrastructure support of large-scale reinforcement learning.

## REFERENCES

AI@Meta. Llama 3 model card, 2024. URL https://github.com/meta-llama/llama3/ blob/main/MODEL\_CARD.md.

Zhangir Azerbayev, Hailey Schoelkopf, Keiran Paster, Marco Dos Santos, Stephen Marcus McAleer, Albert Q. Jiang, Jia Deng, Stella Biderman, and Sean Welleck. Llemma: An open language model for mathematics. In ICLR. OpenReview.net, 2024.

Andrei Z. Broder. Identifying and filtering near-duplicate documents. In CPM, volume 1848 of Lecture Notes in Computer Science, pp. 1–10. Springer, 2000.

Boxi Cao, Keming Lu, Xinyu Lu, Jiawei Chen, Mengjie Ren, Hao Xiang, Peilin Liu, Yaojie Lu, Ben He, Xianpei Han, Le Sun, Hongyu Lin, and Bowen Yu. Towards scalable automated alignment of LLMs: A survey. CoRR, abs/2406.01252, 2024.

Karl Cobbe, Vineet Kosaraju, Mohammad Bavarian, Mark Chen, Heewoo Jun, Lukasz Kaiser, Matthias Plappert, Jerry Tworek, Jacob Hilton, Reiichiro Nakano, Christopher Hesse, and John Schulman. Training verifiers to solve math word problems. CoRR, abs/2110.14168, 2021.

Chaoqun He, Renjie Luo, Yuzhuo Bai, Shengding Hu, Zhen Leng Thai, Junhao Shen, Jinyi Hu, Xu Han, Yujie Huang, Yuxiang Zhang, Jie Liu, Lei Qi, Zhiyuan Liu, and Maosong Sun. Olympiadbench: A challenging benchmark for promoting AGI with olympiad-level bilingual multimodal scientific problems. In ACL (1), pp. 3828–3850. Association for Computational Linguistics, 2024.

Dan Hendrycks, Collin Burns, Steven Basart, Andy Zou, Mantas Mazeika, Dawn Song, and Jacob Steinhardt. Measuring massive multitask language understanding. In ICLR. OpenReview.net, 2021a.

Dan Hendrycks, Collin Burns, Saurav Kadavath, Akul Arora, Steven Basart, Eric Tang, Dawn Song, and Jacob Steinhardt. Measuring mathematical problem solving with the MATH dataset. In NeurIPS Datasets and Benchmarks, 2021b.

Armand Joulin, Edouard Grave, Piotr Bojanowski, Matthijs Douze, Herve J ´ egou, and Tom ´ as Mikolov. ´ Fasttext.zip: Compressing text classification models. CoRR, abs/1612.03651, 2016.

Aitor Lewkowycz, Anders Andreassen, David Dohan, Ethan Dyer, Henryk Michalewski, Vinay V. Ramasesh, Ambrose Slone, Cem Anil, Imanol Schlag, Theo Gutman-Solo, Yuhuai Wu, Behnam Neyshabur, Guy Gur-Ari, and Vedant Misra. Solving quantitative reasoning problems with language models. In NeurIPS, 2022a.

Aitor Lewkowycz, Anders Andreassen, David Dohan, Ethan Dyer, Henryk Michalewski, Vinay V. Ramasesh, Ambrose Slone, Cem Anil, Imanol Schlag, Theo Gutman-Solo, Yuhuai Wu, Behnam Neyshabur, Guy Gur-Ari, and Vedant Misra. Solving quantitative reasoning problems with language models. In Sanmi Koyejo, S. Mohamed, A. Agarwal, Danielle Belgrave, K. Cho, and A. Oh (eds.), Advances in Neural Information Processing Systems 35: Annual Conference on Neural Information Processing Systems 2022, NeurIPS 2022, New Orleans, LA, USA, November 28 - December 9, 2022, 2022b.

Chengpeng Li, Guanting Dong, Mingfeng Xue, Ru Peng, Xiang Wang, and Dayiheng Liu. Dotamath: Decomposition of thought with code assistance and self-correction for mathematical reasoning, 2024a. URL https://arxiv.org/abs/2407.04078.

Chengpeng Li, Zheng Yuan, Hongyi Yuan, Guanting Dong, Keming Lu, Jiancan Wu, Chuanqi Tan, Xiang Wang, and Chang Zhou. Mugglemath: Assessing the impact of query and response augmentation on math reasoning. In Lun-Wei Ku, Andre Martins, and Vivek Srikumar (eds.), Proceedings of the 62nd Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), ACL 2024, Bangkok, Thailand, August 11-16, 2024, pp. 10230–10258. Association for Computational Linguistics, 2024b.

Jia LI, Edward Beeching, Lewis Tunstall, Ben Lipkin, Roman Soletskyi, Shengyi Costa Huang, Kashif Rasul, Longhui Yu, Albert Jiang, Ziju Shen, Zihan Qin, Bin Dong, Li Zhou, Yann Fleureau, Guillaume Lample, and Stanislas Polu. Numinamath. [https://github.com/projectnumina/aimo-progress-prize](https://github.com/project-numina/ aimo-progress-prize/blob/main/report/numina\_dataset.pdf), 2024.

Minpeng Liao, Chengxi Li, Wei Luo, Jing Wu, and Kai Fan. MARIO: math reasoning with code interpreter output - A reproducible pipeline. In Lun-Wei Ku, Andre Martins, and Vivek Srikumar (eds.), Findings of the Association for Computational Linguistics, ACL 2024, Bangkok, Thailand and virtual meeting, August 11-16, 2024, pp. 905–924. Association for Computational Linguistics, 2024.

Team Mistral-AI. Mathstral. https://mistral.ai/news/mathstral/, 2024.

OpenAI. Hello GPT-4o, 2024. URL https://openai.com/index/hello-gpt-4o/.

Long Ouyang, Jeffrey Wu, Xu Jiang, Diogo Almeida, Carroll Wainwright, Pamela Mishkin, Chong Zhang, Sandhini Agarwal, Katarina Slama, Alex Ray, John Schulman, Jacob Hilton, Fraser Kelton, Luke Miller, Maddie Simens, Amanda Askell, Peter Welinder, Paul F Christiano, Jan Leike, and Ryan Lowe. Training language models to follow instructions with human feedback. In S. Koyejo, S. Mohamed, A. Agarwal, D. Belgrave, K. Cho, and A. Oh (eds.), Advances in Neural Information Processing Systems, volume 35, pp. 27730–27744. Curran Associates, Inc., 2022. URL https://proceedings.neurips.cc/paper\_files/paper/ 2022/file/b1efde53be364a73914f58805a001731-Paper-Conference.pdf.

Team Qwen. Introducing qwen2-math. https://qwenlm.github.io/blog/qwen2-math/, 2024.

Zhihong Shao, Peiyi Wang, Qihao Zhu, Runxin Xu, Junxiao Song, Mingchuan Zhang, Y. K. Li, Y. Wu, and Daya Guo. Deepseekmath: Pushing the limits of mathematical reasoning in open language models. CoRR, abs/2402.03300, 2024.

Avi Singh, John D. Co-Reyes, Rishabh Agarwal, Ankesh Anand, Piyush Patil, Xavier Garcia, Peter J. Liu, James Harrison, Jaehoon Lee, Kelvin Xu, Aaron Parisi, Abhishek Kumar, Alex Alemi, Alex Rizkowsky, Azade Nova, Ben Adlam, Bernd Bohnet, Gamaleldin Elsayed, Hanie Sedghi, Igor Mordatch, Isabelle Simpson, Izzeddin Gur, Jasper Snoek, Jeffrey Pennington, Jiri Hron, Kathleen Kenealy, Kevin Swersky, Kshiteej Mahajan, Laura Culp, Lechao Xiao, Maxwell L. Bileschi, Noah Constant, Roman Novak, Rosanne Liu, Tris Warkentin, Yundi Qian, Yamini Bansal, Ethan Dyer, Behnam Neyshabur, Jascha Sohl-Dickstein, and Noah Fiedel. Beyond human data: Scaling self-training for problem-solving with language models, 2024. URL https: //arxiv.org/abs/2312.06585.

Zhengyang Tang, Xingxing Zhang, Benyou Wang, and Furu Wei. Mathscale: Scaling instruction tuning for mathematical reasoning. In ICML. OpenReview.net, 2024a.

Zhengyang Tang, Xingxing Zhang, Benyou Wang, and Furu Wei. Mathscale: Scaling instruction tuning for mathematical reasoning. In Forty-first International Conference on Machine Learning, ICML 2024, Vienna, Austria, July 21-27, 2024. OpenReview.net, 2024b. URL https://openreview.net/forum?id=Kjww7ZN47M.

Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma, Fei Xia, Ed Chi, Quoc V Le, Denny Zhou, et al. Chain-of-thought prompting elicits reasoning in large language models. Advances in Neural Information Processing Systems, 35:24824–24837, 2022.

Tianwen Wei, Jian Luan, Wei Liu, Shuang Dong, and Bin Wang. CMATH: can your language model pass chinese elementary school math test? CoRR, abs/2306.16636, 2023.

An Yang, Baosong Yang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Zhou, Chengpeng Li, Chengyuan Li, Dayiheng Liu, Fei Huang, Guanting Dong, Haoran Wei, Huan Lin, Jialong Tang, Jialin Wang, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Ma, Jianxin Yang, Jin Xu, Jingren Zhou, Jinze Bai, Jinzheng He, Junyang Lin, Kai Dang, Keming Lu, Keqin Chen, Kexin Yang, Mei Li, Mingfeng Xue, Na Ni, Pei Zhang, Peng Wang, Ru Peng, Rui Men, Ruize Gao, Runji Lin, Shijie Wang, Shuai Bai, Sinan Tan, Tianhang Zhu, Tianhao Li, Tianyu Liu, Wenbin Ge, Xiaodong Deng, Xiaohuan Zhou, Xingzhang Ren, Xinyu Zhang, Xipin Wei, Xuancheng Ren, Xuejing Liu, Yang Fan, Yang Yao, Yichang Zhang, Yu Wan, Yunfei Chu, Yuqiong Liu, Zeyu Cui, Zhenru Zhang, Zhifang Guo, and Zhihao Fan. Qwen2 technical report. CoRR, abs/2407.10671, 2024.

Huaiyuan Ying, Shuo Zhang, Linyang Li, Zhejian Zhou, Yunfan Shao, Zhaoye Fei, Yichuan Ma, Jiawei Hong, Kuikun Liu, Ziyi Wang, Yudong Wang, Zijian Wu, Shuaibin Li, Fengzhe Zhou,

Hongwei Liu, Songyang Zhang, Wenwei Zhang, Hang Yan, Xipeng Qiu, Jiayu Wang, Kai Chen, and Dahua Lin. Internlm-math: Open math large language models toward verifiable reasoning. CoRR, abs/2402.06332, 2024.

Zheng Yuan, Hongyi Yuan, Chengpeng Li, Guanting Dong, Keming Lu, Chuanqi Tan, Chang Zhou, and Jingren Zhou. Scaling relationship on learning mathematical reasoning with large language models, 2023.

Xiang Yue, Xingwei Qu, Ge Zhang, Yao Fu, Wenhao Huang, Huan Sun, Yu Su, and Wenhu Chen. MAmmoTH: Building math generalist models through hybrid instruction tuning. arXiv preprint arXiv:2309.05653, 2023.

Xiang Yue, Tuney Zheng, Ge Zhang, and Wenhu Chen. Mammoth2: Scaling instructions from the web. CoRR, abs/2405.03548, 2024.

Xiaotian Zhang, Chunyang Li, Yi Zong, Zhengyu Ying, Liang He, and Xipeng Qiu. Evaluating the performance of large language models on GAOKAO benchmark. CoRR, abs/2305.12474, 2023. doi: 10.48550/arXiv.2305.12474. URL https://doi.org/10.48550/arXiv.2305.12474.

Wanjun Zhong, Ruixiang Cui, Yiduo Guo, Yaobo Liang, Shuai Lu, Yanlin Wang, Amin Saied, Weizhu Chen, and Nan Duan. Agieval: A human-centric benchmark for evaluating foundation models. In NAACL-HLT (Findings), pp. 2299–2314. Association for Computational Linguistics, 2024.

Kun Zhou, Beichen Zhang, Jiapeng Wang, Zhipeng Chen, Wayne Xin Zhao, Jing Sha, Zhichao Sheng, Shijin Wang, and Ji-Rong Wen. Jiuzhang3.0: Efficiently improving mathematical reasoning by training small data synthesis models. CoRR, abs/2405.14365, 2024.

Qihao Zhu, Daya Guo, Zhihong Shao, Dejian Yang, Peiyi Wang, Runxin Xu, Y Wu, Yukun Li, Huazuo Gao, Shirong Ma, et al. Deepseek-coder-v2: Breaking the barrier of closed-source models in code intelligence. arXiv preprint arXiv:2406.11931, 2024.

## A CASE STUDY OF QWEN2-MATH ON OLYMPIAD-LEVEL PROBLEMS

## A.1 NUMBER THEORY

## Problem From IMO Shortlist 2002:

What is the smallest positive integer t such that there exist integers $x _ { 1 } , x _ { 2 } , \ldots , x _ { t }$ with

$$
x _ { 1 } ^ { 3 } + x _ { 2 } ^ { 3 } + \ldots + x _ { t } ^ { 3 } = 2 0 0 2 ^ { 2 0 0 2 } ?
$$

## Qwen2-Math-72B-Instruct Solution

To determine the smallest positive integer t such that there exist integers $x _ { 1 } , x _ { 2 } , \ldots , x _ { t }$ satisfying the equation

$$
x _ { 1 } ^ { 3 } + x _ { 2 } ^ { 3 } + \cdot \cdot \cdot + x _ { t } ^ { 3 } = 2 0 0 2 ^ { 2 0 0 2 } ,
$$

we start by analyzing the properties of cubes and their sums. We need to find the smallest t for which the sum of t cubes equals $2 0 \bar { 0 } 2 ^ { 2 0 0 2 }$

First, we note that 2002 can be factored into prime factors:

$$
2 0 0 2 = 2 \times 7 \times 1 1 \times 1 3 .
$$

Thus,

$$
2 0 0 2 ^ { 2 0 0 2 } = ( 2 \times 7 \times 1 1 \times 1 3 ) ^ { 2 0 0 2 } = 2 ^ { 2 0 0 2 } \times 7 ^ { 2 0 0 2 } \times 1 1 ^ { 2 0 0 2 } \times 1 3 ^ { 2 0 0 2 } .
$$

Next, we consider the properties of cubes modulo 9. Cubes modulo 9 can only be congruent to 0, 1, or −1. This is because:

$$
{ \begin{array} { r l } & { \mathbf { \eta } _ { 0 } ^ { 3 } \equiv 0 \pmod { 9 } , } \\ & { \mathbf { \eta } _ { 1 } ^ { 3 } \equiv 1 \pmod { 9 } , } \\ & { \mathbf { \eta } _ { 2 } ^ { 3 } \equiv \mathbf { 8 } \equiv \mathbf { - 1 } \pmod { 9 } , } \\ & { \mathbf { \eta } _ { 3 } ^ { 3 } \equiv 2 7 \equiv 0 \pmod { 9 } , } \\ & { \mathbf { \eta } _ { 4 } ^ { 3 } \equiv 6 \mathbf { 4 } \equiv 1 \pmod { 9 } , } \\ & { \mathbf { \eta } _ { 5 } ^ { 3 } \equiv \mathbf { 1 } \pmod { 9 } , } \\ & { \mathbf { \eta } _ { 6 } ^ { 3 } \equiv 2 \mathbf { 1 } 6 \equiv \mathbf { 0 } \pmod { 9 } , } \\ & { { \boldsymbol { \eta } } ^ { 3 } \equiv 3 4 3 \equiv 1 \pmod { 9 } , } \\ & { \mathbf { \eta } _ { 8 } ^ { 3 } \equiv \mathbf { 5 } 1 2 \equiv \mathbf { - 1 } \pmod { 9 } . } \end{array} }
$$

Now, we need to determine $2 0 0 2 ^ { 2 0 0 2 }$ mod 9. First, we find 2002 mod 9:

$$
2 0 0 2 \div 9 = 2 2 2 { \mathrm { ~ r e m a i n d e r ~ 4 ~ } } \quad \Rightarrow \quad 2 0 0 2 \equiv 4 { \pmod { 9 } } .
$$

Thus,

$$
2 0 0 2 ^ { 2 0 0 2 } \equiv 4 ^ { 2 0 0 2 } { \pmod { 9 } } .
$$

Next, we use Euler’s theorem, which states that $a ^ { \phi ( n ) } \equiv 1$ (mod n) for $\operatorname* { g c d } ( a , n ) = 1$ . Here, $\phi ( 9 ) = 6 ,$ so:

$$
4 ^ { 6 } \equiv 1 { \pmod { 9 } } .
$$

We can reduce the exponent 2002 mod 6:

$$
2 0 0 2 \div 6 = 3 3 3 \mathrm { r e m a i n d e r } 4 \quad \Rightarrow \quad 2 0 0 2 \equiv 4 \quad ( \mathrm { m o d } \ 6 ) .
$$

Thus,

$$
4 ^ { 2 0 0 2 } \equiv 4 ^ { 4 } { \pmod { 9 } } .
$$

$$
4 ^ { 4 } = 2 5 6 .
$$

Finally, we find 256 mod 9:

$$
2 5 6 \div 9 = 2 8 { \mathrm { ~ r e m a i n d e r ~ 4 ~ } } \quad \Rightarrow \quad 2 5 6 \equiv 4 { \pmod { 9 } } .
$$

Therefore,

$$
2 0 0 2 ^ { 2 0 0 2 } \equiv 4 { \pmod { 9 } } .
$$

We need to find the smallest t such that the sum of t cubes is congruent to 4 modulo 9. The possible sums of cubes modulo 9 are:

$$
\begin{array} { r } { \begin{array} { r } { 0 = 0 \ \ \mathrm { ( m o d ~ 9 ) } , } \\ { 1 = 1 \ \mathrm { ( m o d ~ 9 ) } , } \\ { - 1 = 8 \ \mathrm { ( m o d ~ 9 ) } , } \\ { 1 + 1 = 2 \ \mathrm { ( m o d ~ 9 ) } , } \\ { 1 + ( - 1 ) = 0 \ \mathrm { ( m o d ~ 9 ) } , } \\ { 1 + ( - 1 ) = 0 \ \mathrm { ( m o d ~ 9 ) } , } \\ { - 1 + ( - 1 ) \equiv - 2 \ \mp \ \mathrm { ( m o d ~ 9 ) } , } \\ { 1 + 1 + 1 + 1 \equiv 3 \ \mathrm { ( m o d ~ 9 ) } , } \\ { 1 + 1 + ( - 1 ) \equiv 1 \ \mathrm { ( m o d ~ 9 ) } , } \\ { 1 + ( - 1 ) + ( - 1 ) = 1 \ \mathrm { ( m o d ~ 9 ) } , } \\ { 1 + ( - 1 ) + ( - 1 ) = - 1 = 8 \ \mathrm { ( m o d ~ 9 ) } , } \\ { - 1 + ( - 1 ) + ( - 1 ) = - 3 = 6 \ \mathrm { ( m o d ~ 9 ) } , } \\ { 1 + 1 + 1 + 1 = 4 \ \mathrm { ( m o d ~ 9 ) } . } \end{array} } \end{array}
$$

We see that the sum of four cubes can be congruent to 4 modulo 9. Therefore, the smallest t is 4.

Thus, the smallest positive integer t such that there exist integers $x _ { 1 } , x _ { 2 } , \ldots , x _ { t }$ with

$$
x _ { 1 } ^ { 3 } + x _ { 2 } ^ { 3 } + \cdot \cdot \cdot + x _ { t } ^ { 3 } = 2 0 0 2 ^ { 2 0 0 2 }
$$

is

![](images/prob01_imo_shortlist_2022.jpg)

## Problem From IMO Shortlist 2022

For a positive integer n we denote by $s ( n )$ the sum of the digits of n. Let $P ( x ) = x ^ { n } + a _ { n - 1 } x ^ { n - 1 } +$ $\cdots + a _ { 1 } x + a _ { 0 }$ be a polynomial, where $\mid n \geq 2$ and $a _ { i }$ is a positive integer for all $0 \leq i \leq n - 1$ Could it be the case that, for all positive integers $k , s ( k )$ and $s ( P ( k ) )$ have the same parity?

## Qwen2-Math-72B-Instruct Solution

To determine whether it is possible for $s ( k )$ and $s ( P ( k ) )$ to have the same parity for all positive integers $k ,$ we need to analyze the behavior of the sum of the digits function s and the polynomial $P ( \bar { x } )$ •

First, recall that the sum of the digits of a number k modulo 2 is equivalent to k mod 2. This is because the sum of the digits of k in base 10 is congruent to k mod 9, and since $9 \equiv 1$ mod 2, the sum of the digits modulo 2 is the same as k mod 2.

Given the polynomial $P ( x ) = x ^ { n } + a _ { n - 1 } x ^ { n - 1 } + \cdot \cdot \cdot + a _ { 1 } x + a _ { 0 }$ , we need to determine the parity of $P ( k )$ for any positive integer k. Specifically, we need to check if $P ( k )$ mod 2 is the same as k mod 2.

Le $\because \mathrm { \Omega s }$ consider the polynomial modulo 2:

$$
P ( x ) \equiv x ^ { n } + a _ { n - 1 } x ^ { n - 1 } + \dots + a _ { 1 } x + a _ { 0 } \mod 2 .
$$

Since $a _ { i }$ are positive integers, $a _ { i }$ mod 2 is either 0 or 1. Let $b _ { i } = a _ { i }$ mod 2. Then we can rewrite the polynomial modulo 2 as:

$$
P ( x ) \equiv x ^ { n } + b _ { n - 1 } x ^ { n - 1 } + \dots + b _ { 1 } x + b _ { 0 } \mod 2 .
$$

Now, we need to check the parity of $P ( k )$ for $k \equiv 0$ mod 2 and $k \equiv 1$ mod 2.

1. \*\*Case 1: $k \equiv 0$ mod $2 ^ { \ast \ast }$

$$
P ( 0 ) \equiv b _ { 0 } \mod 2 .
$$

For $s ( P ( 0 ) )$ to have the same parity as s(0), b0 must be 0. Therefore, $a _ { 0 }$ must be even.

2. \*\*Case $2 \colon k \equiv 1$ mod 2\*\*

$$
P ( 1 ) \equiv 1 ^ { n } + b _ { n - 1 } \cdot 1 ^ { n - 1 } + \cdot \cdot \cdot + b _ { 1 } \cdot 1 + b _ { 0 } \equiv 1 + b _ { n - 1 } + \cdot \cdot \cdot + b _ { 1 } + b _ { 0 } \mod 2 .
$$

For $s ( P ( 1 ) )$ ) to have the same parity as $s ( 1 ) , 1 + b _ { n - 1 } + \cdot \cdot \cdot + b _ { 1 } + b _ { 0 }$ must be odd. Since 1 is odd, the sum $b _ { n - 1 } + \cdot \cdot \cdot + b _ { 1 } + b _ { 0 }$ must be even.

From the above cases, we have: - a0 must be even. - The sum $b _ { n - 1 } + \cdot \cdot \cdot + b _ { 1 } + b _ { 0 }$ must be even.

However, if $a _ { 0 }$ is even, then $b _ { 0 } = 0$ . This means the sum $b _ { n - 1 } + \cdots + b _ { 1 }$ must be even. But since $b _ { i }$ are either $0 \mathrm { o r } 1 $ , the sum of $b _ { n - 1 } + \cdots + b _ { 1 }$ being even implies that there must be an even number of 1’s among $b _ { n - 1 } , \ldots , b _ { 1 }$ .

Now, consider the polynomial $P ( x ) = x ^ { n } + 1$ . For this polynomial: $\mathbf { \partial } - a _ { 0 } = 1$ (odd), which contradicts our requirement that $a _ { 0 }$ must be even. - The sum $b _ { n - 1 } + \cdot \cdot \cdot + b _ { 1 } + b _ { 0 } = 1$ (odd), which also contradicts our requirement that the sum must be even.

Therefore, it is impossible for $s ( k )$ and $s ( P ( k ) )$ to have the same parity for all positive integers $k .$

Thus, the final answer is:

No

## A.2 ALGEBRA

## Problem From IMO 2022

Let $\mathbb { R } ^ { + }$ denote the set of positive real numbers. Find all functions $f : \mathbb { R } ^ { + } \to \mathbb { R } ^ { + }$ such that for each $x \in \mathbb { R } ^ { + }$ , there is exactly one $y \in \mathbb { R } ^ { + }$ satisfying

$$
x f ( y ) + y f ( x ) \leq 2
$$

## Qwen2-Math-72B-Instruct Solution

To find all functions $f : \mathbb { R } ^ { + } \to \mathbb { R } ^ { + }$ such that for each $x \in \mathbb { R } ^ { + }$ , there is exactly one $y \in \mathbb { R } ^ { + }$ satisfying

$$
x f ( y ) + y f ( x ) \leq 2 ,
$$

we will proceed step by step.

Step 1: Analyze the given inequality

Given $x \in \mathbb { R } ^ { + }$ , there exists a unique $y \in \mathbb { R } ^ { + }$ such that

$$
x f ( y ) + y f ( x ) \leq 2 .
$$

We need to explore the implications of this condition.

Step 2: Consider the case $x = y$

Substitute $y = x$ into the inequality:

$$
x f ( x ) + x f ( x ) = 2 x f ( x ) \leq 2 .
$$

This simplifies to:

Thus, for all $x \in \mathbb { R } ^ { + }$

$$
x f ( x ) \leq 1 .
$$

$$
f ( x ) \leq { \frac { 1 } { x } } .
$$

## Step 3: Consider the uniqueness condition

For each $x \in \mathbb { R } ^ { + }$ , there is exactly one $y \in \mathbb { R } ^ { + }$ such that $x f ( y ) + y f ( x ) \leq 2$ . We need to ensure that this y is unique.

Step 4: Test the function $\textstyle f ( x ) = { \frac { 1 } { x } }$

Consider the function $\textstyle f ( x ) = { \frac { 1 } { x } }$ . Substitute $\textstyle f ( x ) = { \frac { 1 } { x } }$ and $\begin{array} { r } { f ( y ) = \frac { 1 } { y } } \end{array}$ into the inequality:

$$
x \cdot { \frac { 1 } { y } } + y \cdot { \frac { 1 } { x } } = { \frac { x } { y } } + { \frac { y } { x } } .
$$

We need:

$$
\frac { x } { y } + \frac { y } { x } \leq 2 .
$$

Using the AM-GM inequality, we know:

$$
\frac { x } { y } + \frac { y } { x } \geq 2 .
$$

Equality holds if and only if $\textstyle { \frac { x } { y } } = 1$ , which implies $x = y$

Thus, for $\textstyle f ( x ) = { \frac { 1 } { x } }$ , the inequality $x f ( y ) + y f ( x ) \leq 2$ holds if and only if $x = y$ . This satisfies the condition that there is exactly one y for each x.

## Step 5: Verify if other functions can satisfy the condition

Suppose there exists another function $g : \mathbb { R } ^ { + }  \mathbb { R } ^ { + }$ such that $\begin{array} { r } { g ( x ) \neq \frac { 1 } { x } } \end{array}$ for some x. Then, for some $\begin{array} { r } { x , g ( x ) < \frac { 1 } { x } \mathrm { o r } g ( x ) > \frac { 1 } { x } } \end{array}$

$\begin{array} { r } { - \mathrm { I f } \ g ( x ) < \frac { 1 } { x } } \end{array}$ , then $x g ( y ) + y g ( x )$ might not satisfy the inequality for all $\begin{array} { r } { y . \ - \operatorname { I f } g ( x ) > \frac { 1 } { x } } \end{array}$ , then $x g ( y ) + y g ( \overline { { x } } )$ might exceed 2 for some y.

Thus, any function other than $\textstyle f ( x ) = { \frac { 1 } { x } }$ would not satisfy the uniqueness condition.

Conclusion

$$
{ \boxed { f ( x ) = { \frac { 1 } { x } } } } .
$$

The only function $f : \mathbb { R } ^ { + } \to \mathbb { R } ^ { + }$ that satisfies the given condition is:

## Problem from International Zhautykov Olympiad 2020

Let Z be the set of all integers. Find all the function $f : Z \to Z$ such that

$$
f ( 4 x + 3 y ) = f ( 3 x + y ) + f ( x + 2 y )
$$

For all integers x, y

## Qwen2-Math-72B-Instruct Solution

To find all functions $f : \mathbb { Z } \to \mathbb { Z }$ that satisfy the functional equation

$$
f ( 4 x + 3 y ) = f ( 3 x + y ) + f ( x + 2 y )
$$

for all integers x and y, we will proceed step by step.

Step 1: Initial Substitution First, let’s substitute specific values for x and y to gain insight into the function.

SUBSTITUTION 1: $x = 0$

$$
\begin{array} { c } { f ( 4 \cdot 0 + 3 y ) = f ( 3 \cdot 0 + y ) + f ( 0 + 2 y ) } \\ { f ( 3 y ) = f ( y ) + f ( 2 y ) } \end{array}
$$

SUBSTITUTION $2 \colon y = 0$

$$
\begin{array} { c } { f ( 4 x + 3 \cdot 0 ) = f ( 3 x + 0 ) + f ( x + 2 \cdot 0 ) } \\ { f ( 4 x ) = f ( 3 x ) + f ( x ) } \end{array}
$$

Step 2: Exploring Further Substitutions We now have two equations: 1. $f ( 3 y ) = f ( y ) + f ( 2 y )$ $2 . { \bar { f } } ( 4 x ) = { \bar { f } } ( 3 x ) { \bar { + } } f ( x )$

SUBSTITUTION $3 \colon y = 1$ IN THE FIRST EQUATION

$$
\begin{array} { c } { f ( 3 \cdot 1 ) = f ( 1 ) + f ( 2 \cdot 1 ) } \\ { f ( 3 ) = f ( 1 ) + f ( 2 ) } \end{array}
$$

SUBSTITUTION 4: $x = 1$ IN THE SECOND EQUATION

$$
\begin{array} { c } { f ( 4 \cdot 1 ) = f ( 3 \cdot 1 ) + f ( 1 ) } \\ { f ( 4 ) = f ( 3 ) + f ( 1 ) } \end{array}
$$

Step 3: Using the Equations to Find a Pattern We have:

$$
\begin{array} { r } { f ( 3 ) = f ( 1 ) + f ( 2 ) } \\ { f ( 4 ) = f ( 3 ) + f ( 1 ) } \end{array}
$$

Substitute f(3) from the first equation into the second equation:

$$
\begin{array} { c } { { f ( 4 ) = ( f ( 1 ) + f ( 2 ) ) + f ( 1 ) } } \\ { { f ( 4 ) = 2 f ( 1 ) + f ( 2 ) } } \end{array}
$$

Step 4: Generalizing the Function We hypothesize that f might be a linear function. Let’s assume $f ( x ) = k x$ for some integer k.

VERIFICATION Substitute $f ( x ) = k x$ into the original functional equation:

$$
\begin{array} { c } { f ( 4 x + 3 y ) = k ( 4 x + 3 y ) } \\ { f ( 3 x + y ) = k ( 3 x + y ) } \\ { f ( x + 2 y ) = k ( x + 2 y ) } \end{array}
$$

The original equation becomes:

$$
\begin{array} { c } { { k ( 4 x + 3 y ) = k ( 3 x + y ) + k ( x + 2 y ) } } \\ { { 4 k x + 3 k y = 3 k x + k y + k x + 2 k y } } \\ { { 4 k x + 3 k y = 4 k x + 3 k y } } \end{array}
$$

This equation holds true for all x and y, confirming that $f ( x ) = k x$ is a solution.

Conclusion The only functions $f : \mathbb { Z } \to \mathbb { Z }$ that satisfy the given functional equation are of the form $f ( x ) = k x$ for some integer k.

Thus, the final answer is:

$$
\boxed { f ( x ) = k x \mathrm { f o r } \mathrm { s o m e } \mathrm { i n t e g e r } k }
$$

## Problem From Baltic Way 2023

Find all functions $f : \mathbb { R } $ R such that

$$
f ( f ( x ) + y ) + x f ( y ) = f ( x y + y ) + f ( x )
$$

for reals $x , y .$

## Qwen2-Math-72B-Instruct Solution:

To find all functions $f : \mathbb { R } $ R that satisfy the functional equation

$$
f ( f ( x ) + y ) + x f ( y ) = f ( x y + y ) + f ( x ) ,
$$

we will proceed step by step.

Step 1: Initial Substitution First, let’s substitute $y = 0$ into the equation:

$$
f ( f ( x ) + 0 ) + x f ( 0 ) = f ( x \cdot 0 + 0 ) + f ( x ) .
$$

This simplifies to:

$$
f ( f ( x ) ) + x f ( 0 ) = f ( 0 ) + f ( x ) .
$$

Rearranging terms, we get:

$$
f ( f ( x ) ) = f ( x ) + f ( 0 ) - x f ( 0 ) .
$$

Step 2: Analyzing the Simplified Equation Let $c = f ( 0 )$ . The equation becomes:

$$
f ( f ( x ) ) = f ( x ) + c - x c .
$$

Step 3: Substituting $x = 0$ Next, substitute $x = 0$ into the original equation:

$$
f ( f ( 0 ) + y ) + 0 \cdot f ( y ) = f ( 0 \cdot y + y ) + f ( 0 ) .
$$

This simplifies to:

$$
f ( c + y ) = f ( y ) + c .
$$

Step 4: Substituting $y = - c$ Substitute $y = - c$ into the equation $f ( c + y ) = f ( y ) + c \colon$

$$
f ( c - c ) = f ( - c ) + c .
$$

This simplifies to:

$$
f ( 0 ) = f ( - c ) + c .
$$

Since $f ( 0 ) = c ,$ we have:

$$
c = f ( - c ) + c .
$$

Subtracting c from both sides, we get:

$$
f ( - c ) = 0 .
$$

Step 5: Substituting $y = - f ( x )$ Substitute $y = - f ( x )$ into the original equation:

$$
f ( f ( x ) - f ( x ) ) + x f ( - f ( x ) ) = f ( x ( - f ( x ) ) - f ( x ) ) + f ( x ) .
$$

This simplifies to:

$$
f ( 0 ) + x f ( - f ( x ) ) = f ( - x f ( x ) - f ( x ) ) + f ( x ) .
$$

Since $f ( 0 ) = c ,$ we have:

$$
c + x f ( - f ( x ) ) = f ( - x f ( x ) - f ( x ) ) + f ( x ) .
$$

Step 6: Considering $f ( x ) = 0$ Assume $f ( x ) = 0$ for all x. Substitute $f ( x ) = 0$ into the original equation:

$$
f ( 0 + y ) + x f ( y ) = f ( x y + y ) + f ( x ) .
$$

This simplifies to:

$$
f ( y ) + 0 = f ( y ) + 0 ,
$$

which is always true.

Step 7: Verifying $f ( x ) = x$ Assume $f ( x ) = x$ . Substitute $f ( x ) = x$ into the original equation:

$$
f ( x + y ) + x f ( y ) = f ( x y + y ) + f ( x ) .
$$

This simplifies to:

$$
x + y + x y = x y + y + x ,
$$

which is always true.

Conclusion The only functions that satisfy the given functional equation are $f ( x ) = 0$ and $f ( x ) = x$ . Therefore, the solutions are:

$$
\boxed { f ( x ) = 0 \mathrm { ~ o r ~ } f ( x ) = x } .
$$

![](images/prob02_math_solution.jpg)

## A.3 COUNTING & PROBABILITY

## Problem From Lusophon Mathematical Olympiad 2023

A long time ago, there existed Martians with 3 different colours: red, green and blue. As Mars was devastated by an intergalactic war, only 2 Martians of each colours survived. In order to reconstruct the Martian population, they decided to use a machine that transforms two Martians of distinct colours into four Martians of colour different to the two initial ones. For example, if a red Martian and a blue Martian use the machine, they’ll be transformed into four green Martians.

a) Is it possible that, after using that machine finitely many times, we have 2022 red Martians, 2022 green Martians and 2022 blue Martians?

b) Is it possible that, after using that machine finitely many times, we have 2021 red Martians, 2022 green Martians and 2023 blue Martians?

## Qwen2-Math-72B-Instruct Solution

Let’s analyze the problem step by step.

Part (a) We start with 2 red, 2 green, and 2 blue Martians. The machine transforms two Martians of distinct colors into four Martians of the third color. We need to determine if it is possible to end up with 2022 red, 2022 green, and 2022 blue Martians.

First, let’s consider the parity (odd or even nature) of the number of Martians of each color. Initially, we have: - 2 red (even) - 2 green (even) - 2 blue (even)

Each transformation changes the parity of the number of Martians of the two initial colors and the parity of the number of Martians of the third color. Specifically: - If we transform 1 red and 1 green Martian, we get 4 blue Martians. This changes the parity of red and green Martians from even to odd, and the parity of blue Martians from even to odd. - If we transform 1 red and 1 blue Martian, we get 4 green Martians. This changes the parity of red and blue Martians from even to odd, and the parity of green Martians from even to odd. - If we transform 1 green and 1 blue Martian, we get 4 red Martians. This changes the parity of green and blue Martians from even to odd, and the parity of red Martians from even to odd.

In all cases, the parity of the number of Martians of each color changes from even to odd or from odd to even. Therefore, after any number of transformations, the parity of the number of Martians of each color will always be the same as it was initially.

Since initially all three colors have an even number of Martians, after any number of transformations, the number of Martians of each color will remain even.

Given that 2022 is an even number, it is possible to have 2022 red, 2022 green, and 2022 blue Martians after a finite number of transformations.

Thus, the answer to part (a) is:

Part (b) We start again with 2 red, 2 green, and 2 blue Martians. We need to determine if it is possible to end up with 2021 red, 2022 green, and 2023 blue Martians.

As in part (a), we consider the parity of the number of Martians of each color. Initially, we have: - 2 red (even) - 2 green (even) - 2 blue (even)

Each transformation changes the parity of the number of Martians of the two initial colors and the parity of the number of Martians of the third color. Therefore, after any number of transformations, the parity of the number of Martians of each color will always be the same as it was initially.

Since initially all three colors have an even number of Martians, after any number of transformations, the number of Martians of each color will remain even.

Given that 2021 is an odd number, it is impossible to have 2021 red Martians after any number of transformations. Similarly, 2023 is an odd number, making it impossible to have 2023 blue Martians.

Thus, the answer to part (b) is:

![](images/prob03_balkan_mo_2023.jpg)

## Problem From Balkan MO 2023

Joe and Penny play a game. Initially there are 5000 stones in a pile, and the two players remove stones from the pile by making a sequence of moves. On the k-th move, any number of stones between 1 and k inclusive may be removed. Joe makes the odd-numbered moves and Penny makes the even-numbered moves. The player who removes the very last stone is the winner. Who wins if both players play perfectly?

## Qwen2-Math-72B-Instruct Solution

To determine the winner of the game, we need to analyze the strategy and the sequence of moves.   
Let’s break down the problem step by step.

1. \*\*Understanding the Game Rules:\*\* - Initially, there are 5000 stones. - Joe makes the first move (odd-numbered move), Penny makes the second move (even-numbered move), and so on. - On the k-th move, a player can remove between 1 and k stones. - The player who removes the last stone wins.

2. \*\*Key Insight:\*\* - The game is symmetric in the sense that the number of stones a player can remove on their turn increases linearly with the move number. - The total number of moves in the game is equal to the number of stones initially in the pile, which is 5000.

3. \*\*Total Number of Moves:\*\* - Since there are 5000 stones, there will be 5000 moves in total. - Joe makes the odd-numbered moves: 1st, 3rd, 5th, ..., 4999th. - Penny makes the even-numbered moves: 2nd, 4th, 6th, ..., 5000th.

4. \*\*Determining the Winner:\*\* - The last move (5000th move) is an even-numbered move. - Therefore, Penny will make the last move.

5. \*\*Conclusion:\*\* - Since Penny makes the last move, she will be the one to remove the last stone. - Hence, Penny wins the game if both players play perfectly.

Thus, the final answer is:

Penny

## Problem From Math Odyssey

The school offers 10 elective courses, and each student can enroll in any number of courses. The director selects k students, where although each student’s combination of courses is different, any two students have at least one course in common. At this point, it is found that any student outside these k students cannot be classmates with these k students regardless of how they enroll (having one course in common is enough to be classmates). Find the maximum number of k.

## Qwen2-Math-72B-Instruct Solution

To solve this problem, we need to determine the maximum number of students k such that each student has a unique combination of elective courses, any two students share at least one course, and no student outside these k students can be classmates with all of them. This means that the set of students chosen must cover all possible courses in such a way that any new student would have to share a course with at least one of the chosen students.

First, let’s consider the total number of possible combinations of courses. Since there are 10 elective courses and each student can either take or not take each course, there are $2 ^ { 1 0 } = 1 0 2 4$ possible combinations of courses. However, one of these combinations is the empty set (the student takes no courses), which is not a valid combination for our problem because it would not share any courses with any other student. Therefore, there are 1024 − 1 = 1023 non-empty combinations of courses.

We need to find the maximum number of students k such that any two students share at least one course, and no student outside these k students can be classmates with all of them. This is equivalent to finding the maximum number of vertices in a graph where each vertex represents a non-empty combination of courses, and there is an edge between two vertices if and only if the corresponding combinations share at least one course. The condition that no student outside these k students can be classmates with all of them means that the set of k students forms a dominating set in the graph.

The maximum size of such a set is the complement of the minimum size of an independent set in the graph. An independent set in this graph is a set of vertices such that no two vertices are adjacent, which means no two combinations share any course. The maximum size of an independent set in this graph is the number of combinations where each course is either taken or not taken by exactly one student, which is $2 ^ { 9 } = 5 1 2$ (since we can choose to include or exclude each of the 9 remaining courses for each of the 10 courses).

Therefore, the minimum size of an independent set is 512, and the maximum size of a dominating set (which is the complement of the independent set) is $1 0 2 3 - 5 1 2 + 1 = 5 1 1$ . However, we need to add 1 because the empty set is not included, so the correct calculation is $1 0 2 3 - 5 1 1 = 5 1 2$

Thus, the maximum number of students k is 512

## A.4 GEOMETRY

## Problem from USAMO 2010

Let $A B C$ be a triangle with $\angle A = 9 0 ^ { \circ }$ . Points D and E lie on sides AC and AB, respectively, such that $\angle A B D = \angle D B C$ and $\angle A C E = \angle E C B$ . Segments BD and CE meet at I. Determine whether or not it is possible for segments AB, AC, BI, ID, CI, IE to all have integer lengths.

## Qwen2-Math-72B-Instruct Solution

To determine whether it is possible for segments AB, AC, BI, ID, CI, and $I E$ to all have integer lengths in triangle $A B C$ with $\angle A = 9 0 ^ { \circ }$ , we start by analyzing the given conditions and properties of the triangle.

Given: $\angle A = 9 0 ^ { \circ } - \angle A B D = \angle D B C - \angle A C E = \angle E C B - 5 \mathrm { e g m e n t s } \ B D$ and CE intersect at I

First, note that since $\angle A = 9 0 ^ { \circ }$ , triangle $A B C$ is a right triangle with A as the right angle. Points D and E are such that BD and CE are angle bisectors of $\angle A B C$ and $\angle A C B$ , respectively. Therefore, I is the incenter of triangle ABC.

Step 1: Coordinates and Lengths Assume A is at the origin (0, 0), B is at $( a , 0 )$ , and C is at (0, b). The lengths of the sides are: - $A B = a - A C = b - B C = \sqrt { a ^ { 2 } + b ^ { 2 } }$

Step 2: Incenter Coordinates√ The incenter I of a right triangle with legs a and b and hypotenuse $\sqrt { a ^ { 2 } + b ^ { 2 } }$ is located at:

$$
I = \left( { \frac { a } { 2 } } , { \frac { b } { 2 } } \right)
$$

Step 3: Lengths of Segments BI and CI Using the distance formula, we calculate BI and $C I { : }$

$$
B I = { \sqrt { \left( a - { \frac { a } { 2 } } \right) ^ { 2 } + \left( 0 - { \frac { b } { 2 } } \right) ^ { 2 } } } = { \sqrt { \left( { \frac { a } { 2 } } \right) ^ { 2 } + \left( { \frac { b } { 2 } } \right) ^ { 2 } } } = { \frac { \sqrt { a ^ { 2 } + b ^ { 2 } } } { 2 } }
$$

$$
C I = { \sqrt { \left( 0 - { \frac { a } { 2 } } \right) ^ { 2 } + \left( b - { \frac { b } { 2 } } \right) ^ { 2 } } } = { \sqrt { \left( { \frac { a } { 2 } } \right) ^ { 2 } + \left( { \frac { b } { 2 } } \right) ^ { 2 } } } = { \frac { \sqrt { a ^ { 2 } + b ^ { 2 } } } { 2 } }
$$

Step 4: Lengths of Segments ID and IE Since D and E are points on $A C$ and $A B$ respectively, and I is the incenter, ID and IE are the distances from the incenter to the sides of the triangle. For a right triangle, these distances are given by:

$$
I D = I E = r = { \frac { a + b - { \sqrt { a ^ { 2 } + b ^ { 2 } } } } { 2 } }
$$

Step 5: Integer Lengths For $A B , A C , B I , I D , C I ,$ and IE to all be integers, the following must hold: - a and b are integers - $\frac { \sqrt { a ^ { 2 } + b ^ { 2 } } } { 2 }$ is an integer - $\cdot { \frac { a + b - { \sqrt { a ^ { 2 } + b ^ { 2 } } } } { 2 } }$ is an integer

Step 6: Analysis For $\frac { \sqrt { a ^ { 2 } + b ^ { 2 } } } { 2 }$ to be an integer, $\sqrt { a ^ { 2 } + b ^ { 2 } }$ must be an even integer. Let ${ \sqrt { a ^ { 2 } + b ^ { 2 } } } =$ 2k for some integer k. Then:

$$
a ^ { 2 } + b ^ { 2 } = 4 k ^ { 2 }
$$

For $\textstyle { \frac { a + b - { \sqrt { a ^ { 2 } + b ^ { 2 } } } } { 2 } }$ to be an integer, $a + b - 2 k$ must be even. Since a and b are integers, $a + b$ must be even.

Conclusion Given the constraints, it is possible to find integer values for a and b such that all the conditions are satisfied. For example, if $a = 3$ and $b = 4 , { \mathrm { t h e n } } \colon - A B = 3 - A C = 4 - B C = 5$ $B I = C I = { \textstyle \frac { 5 } { 2 } } = 2 . 5$ (not an integer)

Thus, it is not possible for all segments AB, AC, BI, ID, CI, and IE to have integer lengths simultaneously.

## Problem from JBMO Shortlist 2011

Let $A D , B F$ and CE be the altitudes of △ ABC. A line passing through D and parallel to ABintersects the line EF at the point G. If H is the orthocenter of $\triangle \ A B C$ , find the angle ∠CGH.

## Qwen2-Math-72B-Instruct Solution

To solve for the angle ∠CGH in the given triangle △ABC with altitudes AD, BF , and CE intersecting at the orthocenter H, and a line through D parallel to AB intersecting EF at G, we will follow these steps:

1. Identify Key Points and Properties: - D is the foot of the altitude from A to $B C , - E$ is the foot of the altitude from B to $A C . - { \bar { F } }$ is the foot of the altitude from C to AB. - H is the orthocenter of $\triangle A B C . - G$ is the intersection of the line through D parallel to AB and the line EF .

2. Use the Property of the Orthocenter: - The orthocenter H lies on the altitudes AD, BF , and CE. - The points D, E, and F are collinear with H on the respective altitudes.

3. Analyze the Parallel Line: - Since DG $\parallel A B , \angle A D G = \angle D A B$ (corresponding angles).

4. Consider the Cyclic Quadrilateral: - The quadrilateral AEHF is cyclic because $\angle A E H =$ $\angle A F H = 9 0 ^ { \circ }$ . - Therefore, $\angle E H F = 1 8 0 ^ { \circ } - \bar { \angle } E A F$

5. Use the Parallel Line Property Again: - Since $D G \parallel A B , \angle D G E = \angle B A E$ (alternate interior angles).

6. Relate Angles in Cyclic Quadrilateral: - In △AEF , ∠EAF = ∠EHF because they are opposite angles in the cyclic quadrilateral AEHF .

7. Determine ∠CGH: - Since G lies on EF and DG $\parallel { } A B , \angle D G E = \angle B A E . \cdot \angle B A E =$ $\angle E A F$ (as established). - Therefore, $\angle D G E = \angle E A F$

8. Final Angle Calculation: - Since $\angle E A F = \angle E H F$ and $\angle E H F = 9 0 ^ { \circ }$ (as H is the orthocenter and E and F are feet of perpendiculars), we have:

$$
\angle C G H = \angle E H F = 9 0 ^ { \circ } .
$$

Thus, the angle $\angle C G H { \mathrm { i s } } \boxed { 9 0 ^ { \circ } }$

## B PROMPTS USED IN THE EVALUATION

Fig 5 to Fig 10 show the prompts used in evaluating the base models. Fig 11 to Fig 14 show the prompts used in evaluating the instruct models for Chain-of-Thought Reasoning and Tool-Integrated Reasoning.

![](images/fig05_prompt_gsm8k_base.jpg)  
Figure 5: The prompt used in evaluating GSM8K on the base models. For friendly presentation, we denote a line break as a ”\newline”.

![](images/fig06_prompt_math_base.jpg)  
Figure 6: The prompt used in evaluating MATH on the base models.

![](images/fig07_prompt_mmlu_stem_base.jpg)  
Figure 7: The prompt used in evaluating MMLU STEM on the base models.

![](images/fig08_prompt_cmath_base.jpg)  
Figure 8: The prompt used in evaluating CMATH on the base models.

问题：  
设数列 \$\left\{a\_{n}\right\}\$ 的前 \$n\$ 项和为 \$S\_{n}\$, 且 \$a\_{1}=-1, a\_{n+1}=S\_{n+1} S\_{n}\$, 则  
\$S\_{n}=(\quad)\$.  
解析：  
让我们写出这个数列的前n项和：  
\$S\_n = a\_1 + a\_2 + ... + a\_n\$ \newline \$S\_n = -1 + (S\_2 S\_1) + (S\_3 S\_2) + ... + (S\_{n+1} S\_n)\$ \newline \$S\_n  
= -1 + (S\_2 S\_1) + (S\_3 S\_2) + ... + (S\_n S\_{n-1}) + (S\_{n+1} S\_n)\$ \newline \$S\_n = -1 + S\_n (S\_{n+1} -  
S\_1)\$ \newline \$S\_n - S\_n S\_{n+1} = -1 - S\_n\$ \newline \$S\_n (1 - S\_{n+1}) = -1 - S\_n\$ \newline \$S\_n = -  
\frac{1}{1 - S\_{n+1}}\$ \newline因为这个数列后面的所有项都是0，我们可以看到对于所有\$n\geq 1\$，  
\$S\_{n+1} = 0\$。因此，我们有： \newline \$S\_n = -\frac{1}{1 - S\_{n+1}} = -\frac{1}{1 - 0} = -1\$ \newline这  
个数列前n项和的公式是\$S\_n = -\frac{1}{n}\$。 \newline 答案是 \$-\frac{1}{n}\$  
问题：  
若 \$\left(x+\frac{1}{x}\right)^{n}\$ 的展开式中第 3 项与第 7 项的二项式系数相等, 则该展 开式中  
\$\frac{1}{x^{2}}\$ 的系数为 \$(\quad)\$.  
解析：  
由题意可得, \$c\_{n}^{2}=c\_{n}^{6}\$ \newline \$\therefore n=8\$ \newline 展开式的通项 T\_{r+1}=C\_8^r x^{8-  
r}\left(\frac{1}{x}\right)^r=C\_8^r x^{8-2 r}\$ \newline 令 \$8-2 r=-2\$ 可得 \$r=5\$ \newline此时系数为  
\$c\_{8}^{5}=56\$ \newline 答案是 56  
问题：  
函数 \$\mathrm{f}(\mathrm{x})=\sin (\mathrm{x}+2 \phi)-2 \sin \phi \cos (\mathrm{x}+\phi)\$ 的最大值为  
\$(\quad)\$.  
解析：  
函数 \$f(x)=\sin (x+2 \phi)-2 \sin \phi \cos (x+\phi)=\sin [(x+\phi)+\phi]-\$ \$2 \sin \phi \cos (x+\phi)\$  
\$=\sin (x+\phi) \cos \phi+\cos (x+\phi) \sin \phi-2 \sin \phi \cos (x+\phi)=\sin (x+\phi) \cos \phi-\cos\$ \$(x+\phi)  
\sin \phi\$ \$=\sin [(x+\phi)-\phi]=\sin x\$ \newline 故函数 \$f(x)\$ 的最大值为 1 \newline 答案是 1  
问题：  
已知向量 \$\vec{a}=(3,1), \vec{b}=(1,0), \vec{c}=\vec{a}+k \vec{b}\$. 若 \$\vec{a} \perp \vec{c}\$, 则  
\$k=(\quad)\$  
解析：  
\because \vec{a}=(3,1), \vec{b}=(1,0), \therefore \vec{c}=\vec{a}+k \vec{b}=(3+k, 1)\$ ，  
\$\because \vec{a} \perp \vec{c}, \therefore \vec{a} \square \vec{c}=3(3+k)+1 \times 1=0\$, 解得 \$k=-  
\frac{10}{3}\$ \newline 答案是 \$-\frac{10}{3}\$  
问题：  
设向量 \$\vec{a}, \vec{b}\$ 不平行, 向量 \$\lambda \vec{a}+\vec{b}\$ 与 \$\vec{a}+2 \vec{b}\$ 平行, 则实数  
\$\lambda=(\quad)\$.  
解析：  
\$\because\$ 向量 \$\vec{a}, \vec{b}\$ 不平行, 向量 \$\lambda \vec{a}+\vec{b}\$ 与 \$\vec{a}+2 \vec{b}\$ 平行,  
\$\therefore \lambda \vec{a}+\vec{b}=t(\vec{a}+2 \vec{b})=t \vec{a}+2 t \vec{b}\$  
\$\therefore\left\{\begin{array}{c}\lambda=\mathrm{t} \\ 1=2 \mathrm{t},\end{array}\right.\$ 解得实数  
\$\lambda=\frac{1}{2}\$. \newline 答案是 \$\frac{1}{2}\$  
问题：  
{question}  
解析：  
Figure 9: The prompt used in evaluating GaoKao Math Cloze on the base models.

![](images/fig09_prompt_gaokao_cloze.jpg)  
Figure 10: The prompt used in evaluating GaoKao Math QA on the base models.

![](images/fig10_prompt_gaokao_qa.jpg)  
Figure 11: The prompt used in evaluating the zero-shot Chain of Thought Reasoning on the instruct models.

![](images/fig11_prompt_cot_instruct.jpg)  
Figure 12: The prompt used in evaluating the zero-shot Tool-Integrated Reasoning on the instruct models.

![](images/fig12_prompt_tir_instruct.jpg)  
Figure 13: The prompt used in evaluating the MMLU-STEM on the instruct models.

<table><tr><td>$alpha, \beta, \gamma$ $sin \alpha \cos \beta, \sin \beta \cos \gamma, \sin gamma \cos \alpha$, $\frac{1}{2}$ :newline() 0 newline(1 :newline newline 3 1. $alpha, \beta, \gamma$ $60^cir$∠E3 $\frac{1}{2}$ $\frac{1}{2}$\newline2.$60^circ$ $\alpha$ $\frac{1}{2}$= $180^\circ$F $\beta + gamma &lt; 120^circ$ $\beta, \gamma$ $\frac{1}{2}$F $\sin \alpha \cos \beta &gt; \frac{1}{2}, \sin \beta \cos \gamma &gt; \frac{1}{2}$\newline3. $60^\circ$, $\alpha$  $\beta$, =$180^\circ$ $\gamma &lt;60^\circ$ $\sin gamma &lt;\frac{1}{2}$ $\lalpha$ $\beta$ $\frac{1}{2}$ $\frac{1}{2}$ 4.$60cir$newline $60irc$ $\frac{1}{2}$2 E C</td></tr><tr><td>E $A BC D-A_{1} B_{1} C_{1} D_{1}$ 1, $B B_{1}$ F $ACD_{1}$  ( F: :newline(A) $\frac{\sqrt{2}} {3}$ :\newline(B) $\frac{\sqrt{3}}{3}$ :\newline(C) $\frac{2}{3}$ :\newline(D) $\frac{\sqrt{6}}{3}$ F$\mathrm{}_{1}, \mathrm{O}$ E 1,  $_{1} O$ $ACD_{1}$ F $B B_{1}$ ‡ $ACD_{1}$ F, Ep $\angle O_{1} O D_{1}$, #=# $\mathrm{O0}_{1} \mathrm{D}_{1}$ }1, $\cos \angle \mathrm{O}_{1} \mathrm{OD}_{1}=\frac{\mathrm{O}_{1} \mathrm{O}}{\mathrm{OD}_{1}}=\frac{\frac{1}{\sqrt{6}}}{2}=\frac{\sqrt{6}}{3}$. E C</td></tr><tr><td>$f(x)=\left\{\begin{array}{}1+\log _{2}(2-x), &amp; x&lt;1 \2^{x-1}, &amp; x \geqslant 1,\end{array}\right.$ $f(-2)+f\left(log _{2}12\right)=$ ( ) T : :newline(A) 3 :\newline(B) 6 :\newline(C) 9 :\newline(D) 12 ] RXi+ $f(-2)$ Fπ $f(log_2 12)$:\newline$f(-2)=1+\log_2(2-(-2))=1+\log_2 4=3$ $f(\log_2 12)=2^{\log_2 12-1}=6$\newline|π|\1t,$f(-2)+f(\log_2 12)=3+6=9$ E C</td></tr><tr><td>$f(x)=a x^{3}-3 x^{2}+1$,  $f(x)$ —j $x_{0}$,  $x_{0}&gt;$ 0 , $\mathrm{a}$ : :\newline(A) $(1,+\infty)$ :\newline(B) $(2,+\infty)$ :\newline(C) $(-infty,-1)$ :\newline) $(-\infty,-2)$ ($ $&gt;$ $f(x)$  $f(x)=3ax^2-6x$. \newline $f(x)$  $f(x)$ $x&gt;0$ $i $f(x)$ $=0$ $=\frac{2}{\sqt{a}}$ $x&gt;0$ 3 $a&lt;0$  F $f(x$  $x=0$  $1$  $a=\frac{4}{3}$ \newline$a$  $a&lt;-\frac{4}{3}$ $f(x)$  $x&gt;0$ , —$_0$$
(-infty,-2)$ E</td></tr><tr><td>$\lef\{a_{n}\right}$Δ 0#51,  &quot; $left\{a_{n}\right}$ &quot;  &quot;E # $N_{0}$,  $n&gt;N_{0}$ Hf, $a_{n}&gt;0$ &quot;j () : :newline(A):newline(B):\newline(C) 14:\newline(D) F 0, $N_{0}$,  $n&gt;N_{0}$ H,$a_{n&gt;0$. t, &quot; $lef\{a_{n}\righ$ &quot;  &quot;F $N_{0}$, $n&gt;N_{0}$H, $a_{n}&gt;0$ &quot;. \newlineT, .$N_{0}
$$n&gt;N_{0}$$
a_{n}&gt;0$∠ $lef\{a_{n}\righ$&quot;-.$a_{n}&gt;0
$$a_{n+1}- a_{n}&gt;$,0, .,. newline, (C) EC</td></tr></table>

Figure 14: The prompt used in evaluating the multiple-choice problems in GaoKao on the instruct models.