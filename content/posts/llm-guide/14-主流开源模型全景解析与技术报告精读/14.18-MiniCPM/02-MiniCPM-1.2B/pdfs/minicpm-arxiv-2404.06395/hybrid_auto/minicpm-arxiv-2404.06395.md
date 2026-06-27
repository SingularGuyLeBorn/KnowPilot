# MiniCPM: Unveiling the Potential of Small Language Models with Scalable Training Strategies

Shengding Hu1, Yuge Tu2, Xu Han1∗, Chaoqun He1, Ganqu Cui1, Xiang Long2, Zhi Zheng2, Yewei Fang2, Yuxiang Huang1, Weilin Zhao1, Xinrong Zhang1, Zheng Leng Thai1,Kaihuo Zhang2, Chongyi Wang2, Yuan Yao1, Chenyang Zhao1, Jie Zhou2, Jie Cai2, , Zhongwu Zhai2, Ning Ding1, Chao Jia2, Guoyang Zeng2, Dahai Li2, Zhiyuan Liu1\*, Maosong Sun1\* 1Department of Computer Science and Technology, Tsinghua University. 2Modelbest Inc. shengdinghu@gmail.com

# Abstract

The burgeoning interest in developing Large Language Models (LLMs) with up to trillion parameters has been met with concerns regarding resource efficiency and practical expense, particularly given the immense cost of experimentation. This scenario underscores the importance of exploring the potential of Small Language Models (SLMs) as a resource-efficient alternative. In this context, we introduce MiniCPM, specifically the 1.2B and 2.4B non-embedding parameter variants, not only excel in their respective categories but also demonstrate capabilities on par with 7B-13B LLMs. While focusing on SLMs, our approach exhibits scalability in both model and data dimensions for future LLM research. Regarding model scaling, we employ extensive model wind tunnel experiments for stable and optimal scaling. For data scaling, we introduce a Warmup-Stable-Decay (WSD) learning rate scheduler (LRS), conducive to continuous training and domain adaptation. We present an in-depth analysis of the intriguing training dynamics that occurred in the WSD LRS. With WSD LRS, we are now able to efficiently study data-model scaling law without extensive retraining experiments on both axes of model and data, from which we derive the much higher compute optimal data-model ratio than Chinchilla Optimal. Additionally, we introduce MiniCPM family, including MiniCPM-DPO, MiniCPM-MoE and MiniCPM-128K, whose excellent performance further cementing MiniCPM’s foundation in diverse SLM applications. MiniCPM models are available publicly

# 1 Introduction

Following the revelation of the scaling law (Kaplan et al., 2020), there has been a vigorous pursuit in the field of Large Language Models (LLMs) (Hoffmann et al., 2022; Bai et al., 2023; Gemini et al., 2023; Chowdhery et al., 2023; Achiam et al., 2023), encompassing models with up to an astonishing number of parameters in the trillions (Fedus et al., 2022). These models have emerged as a pivotal driving force in the evolution of artificial intelligence.

Nonetheless, the training of such large-scale models is both financially burdensome and operationally inefficient. On one hand, the empirical understanding of the mechanisms underpinning the training of LLMs remains elusive. Given the significant economic and environmental costs, experiments on LLMs are prohibitively expensive for most researchers and corporations. On the other hand, the deployment of these colossal models in everyday scenarios, such as on personal computers or smartphones, is either inefficient or unfeasible.

Both aspects underscore the imperative to refocus efforts on comprehensively exploring smaller, yet potent, language models (SLMs). These models on the one hand provide efficient solutions to practical deployment, on the other hand, if trained with scalable strategies, they can potentially guide the development of future larger models.

Recently, a resurgence of interest has been observed in the domain of SLMs, evidenced by the advent of a series of innovative models such as the Phi series (Gunasekar et al., 2023; Li et al., 2023b; Javaheripi & Bubeck, 2023), TinyLlama (Zhang et al., 2024a), MobileLLM (Liu et al., 2024), and Gemma (Banks & Warkentin, 2024), among others. While these models have significantly contributed to the expansion and diversification of the SLM landscape, there remain two pivotal areas where these models have yet to fully satisfy prevailing interests: (1) the development of comprehensive abilities akin to those exhibited by LLMs; and (2) the formulation of transparent and scalable training methodologies that could further propel the evolution of both SLMs and LLMs.

In this paper, we introduce MiniCPM, a series of SLMs, which primarily builds on two models, endowed with 2.4B and 1.2B non-embedding parameters respectively, and they rank preeminently in their respective 2B and 1B scale categories. MiniCPM also exhibits comparable capabilities to those of 7B 13B language models, such as Llama2-7B (Touvron et al., 2023), Mistral-7B (Jiang et al., 2023), Gemma-7B (Banks & Warkentin, 2024), and Llama-13B (Touvron et al., 2023), etc. Notwithstanding their small model sizes, our training methodology is meticulously designed to facilitate seamless scaling of both model scale and data horizons. This is exemplified through our model wind tunnel experiments that encompass comprehensive hyper-parameter optimization (Section 3), and the deployment of a WSD (Warmup-Stable-Decay) learning rate scheduler (Section 4). The latter is tailored for continuous training with an un-predefined pre-training token number and makes the reusing of model intermediate checkpoints highly feasible. A detailed analysis of the training dynamics of MiniCPM is presented, suggesting that the WSD scheduler demonstrates the intriguing loss landscape of model pre-training. With the WSD scheduler, we are now also capable of studying the data-model scaling law with linear effort on the model axis and a negligible effort on the data axis, while the traditional ones need quadratic effort considering the scaling along both model and data axes. The result of the scaling law indicates a much higher data size/model size ratio compared with Chinchilla Optimal (Hoffmann et al., 2022).

Moreover, we introduce the MiniCPM family, including MiniCPM-DPO, MiniCPM-128K, and MiniCPM-MoE. We conduct evaluations of the MiniCPM family against established benchmarks and illuminate their impressive capabilities as SLMs: (1) The foundation models surpass Mistral-7B, and LLama-13B. (2) The DPO model surpasses zephyr-7B (Tunstall et al., 2023) on MTBench (Zheng et al., 2024) (3) The 2.4B MiniCPM-128K model demonstrates performance either surpassing or matching that of models like Yarn-Mistral-7B-128K (Peng et al., 2023) and ChatGLM3-6B-128K (Du et al., 2021). (4) The MiniCPM-MoE, with 4B activated parameters, is on par with Llama2-34B (Touvron et al., 2023).

In summary, MiniCPM propounds a new stage in the development of small language models, exemplifying the latent potential within SLMs and advocating for a more scientific and sustainable approach toward scaling up LLMs.

# 2 Related Work

Small Language Models. “Small Language Models” (SLMs) is an evolving concept that has undergone significant transformations over time. Presently, SLMs are generally construed as models that are smaller in scale compared to the well-known LLMs, typically not exceeding 7 billion parameters. These models are distinguished by their capacity for deployment on end-user devices, such as personal computers and smartphones, even in the absence of a GPU. Notable examples within the current landscape of SLMs include the Phi series (Gunasekar et al., 2023; Li et al., 2023b; Javaheripi & Bubeck, 2023), TinyLlama (Zhang et al., 2024a), MobileLLM (Liu et al., 2024), and Gemma (Banks & Warkentin, 2024), etc. A variety of methodologies have been explored to augment the efficacy of SLMs. These include the incorporation of high-quality data (Gunasekar et al., 2023; Li et al., 2023b; Javaheripi & Bubeck, 2023), the application of structure pruning techniques (Xia et al., 2023), and the reconfiguration of model architectures (Liu et al., 2024), among others. MiniCPM enhances the capabilities of SLMs through a meticulous amalgamation of hyper-parameter optimization, strategic training methodologies, architectural design, and high-quality data.

Scalable Pre-training Strategies. Since the discovery of scaling law (Kaplan et al., 2020; Rae et al., 2021; Aghajanyan et al., 2023), scientifically and predictably (Achiam et al., 2023; Hu et al., 2023; Du et al., 2024) scaling up the LLMs has been pursued from diverse perspectives, especially for the pre-training stage. In terms of training stability, the Tensor Program series (Yang et al., 2022; 2023) is introduced to ensure optimal hyper-parameter consistency across varying model scales, a technique employed in training CerebrasGPT (Dey et al., 2023). Furthermore, Wortsman et al. (2023) suggest leveraging smaller models to anticipate and mitigate instabilities in larger model training. From the training data standpoint, various data-centric strategies have been advocated (Xie et al., 2024; Shi et al., 2023; Ye et al., 2024). In the realm of training methodologies, prior research has delved into diverse learning rate schedulers (LRS) (Howard & Ruder, 2018; Raffel et al., 2020; Hundt et al., 2019), with the Cosine LRS (Loshchilov & Hutter, 2016) emerging as the predominant choice in LLMs. Kaplan et al. (2020) and Hoffmann et al. (2022) have meticulously examined the hyper-parameters of Cosine LRS, thereby laying a foundational groundwork for subsequent pre-training works. Of these, DeepSeek (Bi et al., 2024) bears the closest resemblance to our proposed WSD LRS. Concerning batch size scheduling, Smith et al. (2017) advocates for incrementing batch size as an alternative to diminishing learning rate, a strategy recently adopted by Yi-9B (Young et al., 2024).

# 3 Model Wind Tunnel Experiments

Although we target at training SLMs that can be quickly deployed onto end devices, we envision that many aspects of model training are universal across scales. Extensive experiments should be conducted through an SLM to explore the limit of SLM before transferring the experience into LLMs. These experiments take the spirit of wind tunnel testing in developing an aircraft, thus we name it Model Wind Tunnel Experiments (MWTE). In this paper, the MWTE contains three parts: (1) Hyper-parameters; (2) Optimal Batch-size Scaling; and (3) Optimal Learning Rate Stability.

# 3.1 Scaling Hyper-parameters Invariant LM

Hyper-parameters have a significant impact on the performance of a model. However, adjusting hyper-parameters for each model in traditional training is not feasible for LLMs. Even for SLM like MiniCPM, extensive experiments on hyper-parameters search take a lot of resources. Tensor Program (Yang et al., 2022; 2023) proposes a framework to stabilize the hyper-parameters for models with different scales. The main part of the Tensor Program is the width scaling (Yang et al., 2022) and the depth scaling (Yang et al., 2023). The former technique supports CerebrasGPT (Dey et al., 2023) to predict the loss of LLMs more accurately. In MiniCPM, we use both two scaling techniques. The specific scaling operations are listed in Table 7. We do not apply the attention softmax scaling techniques (Yang et al., 2022). Despite Yang et al. (2023) observing that depth scaling for a network with block depth larger than two is not satisfying, we find the resulting optimal learning rate is stable empirically. Details of the hyper-parameters and Tensor Program Operations are in Appendix A.1.

# 3.2 Optimal Batch Size

Batch size determines the balance between the convergence speed of the model and the consumption of computational resources. If the batch size is too large, it will result in a significant amount of data and computation costs. On the other hand, if the batch size is too small, it will require a large number of training steps and may result in a limited decrease in the loss function. We follow Kaplan et al. (2020) to determine the batchsize from expected loss, with a slight modification from their setting (see Appendix A.2). We conduct experiments on 0.009B, 0.03B, and 0.17B models, respectively, toward this goal. Each model size is trained on 6 batch sizes with a global learning rate of 0.01 and cosine learning rate scheduler. We observe the trend of the optimal batch size with loss on the C4 (Raffel et al., 2019) dataset (red line in the Figure 1).

![](images/58215e2871abd3c021df68cd8289b569bb10620a31424524106f924a86218339.jpg)

![](images/190c6cdb924ddcad20d23124952457ccafb06a056001d814a6e796bff5e62391.jpg)

<details>
<summary>line</summary>

| Loss | Batch Size |
|------|------------|
| 3.5  | 10^6       |
| 4.5  | 10^5       |
| 5.5  | 10^4       |
</details>

Figure 1: We demonstrate the loss curve of three size models trained using different batch sizes. Each vertical line formed   
by points with a gradient color represents a training curve.Figure 2: The connected op-Lighter colors denote higher loss. timal batch sizes.

As shown in Figure 1, we plot the batch size in the x-axis, and token consumption in the y-axis, the color of the points represents a loss. Thus a horizontal line formed by the color points denotes a training curve. we use parabolas to fit the equal-loss points and connect the minima of the parabolas with red lines. The lines demonstrate the optimal batch size shifts large as the loss decreases. We then connect the three lines (see Figure 2) and find that the lines connect each other well into a linear relationship in the log space, from which we obtain the following relationship between batch size bs and C4 Loss L: bs = 1.21×1096.24 . $\begin{array} { r } { L \colon b s = \frac { 1 . 2 1 \times 1 0 ^ { 9 } } { I . 6 . 2 4 } } \end{array}$ L6.24 We note that it might seem strange that the batch size should be estimated from a rough loss prediction that we can only have after training. We provide our comment in Appendix A.2.

# 3.3 Optimal Learning Rate

Due to our use of Tensor Program (Yang et al., 2022; 2023), we anticipate that the learning rate, will not undergo significant changes during model scaling. To verify this, we conduct six sets of learning rate experiments at 0.04B, 0.1B, 0.3B, and 0.5B. In Figure 3, we find that although the model size has increased by ten times, the optimal base learning rate 2 does not show a noticeable shift and remains around 0.01. We further conduct a simple validation on a scale of 2.1B and confirm that a learning rate of 0.01 indeed achieves the lowest loss.

![](images/2ba69355187f9222fce6d8b0e9cc424d6186b22326fbc68d6d9cced8ce6d09f4.jpg)

<details>
<summary>line</summary>

| Learning Rate | 0.04b | 0.1b | 0.3b | 0.5b | 2.1b |
| ------------- | ----- | ---- | ---- | ---- | ---- |
| 10⁻³          | 4.1   | 3.2  | 2.8  | 2.6  | 2.5  |
| 10⁻²          | 3.2   | 2.7  | 2.5  | 2.3  | 2.1  |
| 10⁻¹          | 6.7   | 8.0  | 6.0  | 5.8  | 2.3  |
</details>

Figure 3: Loss vs Learning Rate. After applying for the Tensor Program, the learning rate shift becomes minimal.

![](images/ffbfa8e6bfac7ee5998c5461603fed075887d713e263ce4e494255c251eb03ba.jpg)

<details>
<summary>line</summary>

| Tokens (B) | Cosine(20N) | Cosine(40N) | Cosine(60N) | Cosine(80N) | CosineLoop(20N) |
| ---------- | ----------- | ----------- | ----------- | ----------- | --------------- |
| 20N        | 4.5         | 4.5         | 4.5         | 4.5         | 4.5             |
| 40N        | 4.0         | 4.0         | 4.0         | 4.0         | 4.0             |
| 60N        | 3.8         | 3.8         | 3.8         | 3.8         | 3.8             |
| 80N        | 3.7         | 3.7         | 3.7         | 3.7         | 3.7             |
| 100N       | 3.6         | 3.6         | 3.6         | 3.6         | 3.6             |
| 120N       | 3.6         | 3.6         | 3.6         | 3.6         | 3.6             |
| 140N       | 3.6         | 3.6         | 3.6         | 3.6         | 3.6             |
| 160N       | 3.6         | 3.6         | 3.6         | 3.6         | 3.6             |
</details>

Figure 4: Cosine Learning Rate Scheduler with different periods. The Y-axis is the loss on the C4 corpus.

# 4 WSD Learning Rate Scheduler

# 4.1 Analysing Cosine LRS

The learning rate scheduler (LRS), which adjusts the learning rate used in different stages of training, is crucial for model performance. The current commonly used learning rate strategy is the Cosine LRS (Kaplan et al., 2020; Hoffmann et al., 2022; Rae et al., 2021; Touvron et al., 2023; Bai et al., 2023; Almazrouei et al., 2023), which gradually decreases the learning rate following a cosine curve after it reaches its maximum after the warmup stage.

A key hyper-parameter in the Cosine LRS is the step T at which Cosine decreases to the minimum for the first time. Typically, T is set to the total training step S for training with a predefined training step. Generally, it is believed that the learning rate should be high to enable sufficient exploration. For example, Kaplan et al. (2020) demonstrate that the loss decreases when the summed learning rate over the entire training increases (see Figure 22 in their paper). This indicates setting $T < S$ is not optimal. On the other hand, Hoffmann et al. (2022) make a key observation that setting $T ^ { \bullet } > S$ results in dropped performance while setting $S = T$ results in improved training efficiency, confirming that the learning rate shouldn’t be kept high throughout the training. To reproduce these observations, we conduct experiments on the 0.036B model. We try $C o s i n e ( T )$ and CosineLoop(T) LRS, following the formula shown in Appendix B.1. The result can be seen in Figure 4. We can see that when the training step is $S \overset { \triangledown } { = } \overset { \triangledown } { 2 } 0 N , 4 0 N$ , 60N, 80N, the lowest loss is always achieved by the $C o s i n e ( T )$ where $T \stackrel { \star } { = } S$ . Both $T < S$ and $T > S$ are not optimal.

We hypothesize that the Cosine LR performs exceptionally well when $T = S$ because of the following two reasons: (1) Cosine LRS with $T = S$ has a longer duration of high learning rate training compared to $\dot { T } < S$ and other LRS such as Linear LRS. This high learning rate might help the model find a better global optimum. (2) Cosine LRS with $T = S$ has a more thorough learning rate decay phase compared to Cosine LRS with $T > S$ and Constant LRS. This learning rate decay may involve unique training dynamics that enable the model to find a better local optimum.

# 4.2 WSD LRS

In light of the above perspective, we propose to explicitly divide the training stage into the high learning rate stage and learning rate decay stage. We name it as the Warmup-Stable-Decay (WSD) LRS. Especially, the WSD LRS contains three stages: the warmup stage (whose end step is denoted by W), the stable training stage (whose end step is denoted by T), and the remaining decay stage. The function form of WSD is:

$$
W S D (T; s) = \left\{ \begin{array}{l l} \frac {s}{W} \eta , & s <   W \\ \eta , & W <   s <   T \\ f (s - T) \eta , & T <   s <   S \end{array} \right. \tag {1}
$$

where $0 < f ( s - T ) \leq 1$ is a decreasing function about s, η is the maximum learning rate. Typically, as long as the warmup stage is enough, it affects little performance, therefore, we omit W in the subsequent discussion. With an abuse of notation, we will denote WSD with a clear stop point

![](images/38139c4dc69da06d0ec89817f349fe7ca2c682b4faf1b166853411baf72257f7.jpg)

<details>
<summary>line</summary>

| Tokens (B) | WSD(40N,2N) | WSD(60N,2N) | WSD(80N,2N) | WSD(40N,4N) | WSD(60N,6N) | WSD(80N,8N) | Cosine(80N) |
| ---------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| 0          | 4.5         | 4.5         | 4.5         | 4.5         | 4.5         | 4.5         | 4.5         |
| 20N        | 4.0         | 4.0         | 4.0         | 4.0         | 4.0         | 4.0         | 4.0         |
| 40N        | 3.8         | 3.8         | 3.8         | 3.8         | 3.8         | 3.8         | 3.8         |
| 60N        | 3.7         | 3.7         | 3.7         | 3.7         | 3.7         | 3.7         | 3.7         |
| 80N        | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         |
| 100N       | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         |
| 120N       | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         |
| 140N       | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         | 3.6         |
</details>

Figure 5: Model training loss has a sudden decrease in the decay stage of WSD LRS.

![](images/959973a96280f9f009dfab58b173674f8abe71de00a2ac4314c24e05302b6f18.jpg)

<details>
<summary>line</summary>

| Compute (×10³) | WSD(20N,2N) | WSD(40N,4N) | WSD(60N,6N) | WSD(80N,8N) | WSD(160N,16N) | WSD(320N,32N) | 0.17B, WSD(40N,4N) | Optimal Loss Envelope |
| -------------- | ----------- | ----------- | ----------- | ----------- | ------------- | ------------- | ------------------- | -------------------- |
| 0.0            | 4.5         | 4.5         | 4.5         | 4.5         | 4.5           | 4.5           | 4.5                 | 3.32                 |
| 0.5            | 3.4         | 3.4         | 3.4         | 3.4         | 3.4           | 3.4           | 3.4                 | 3.32                 |
| 1.0            | 3.35        | 3.35        | 3.35        | 3.35        | 3.35          | 3.35          | 3.35                | 3.32                 |
| 1.5            | 3.32        | 3.32        | 3.32        | 3.32        | 3.32          | 3.32          | 3.32                | 3.32                 |
| 2.0            | 3.31        | 3.31        | 3.31        | 3.31        | 3.31          | 3.31          | 3.31                | 3.32                 |
| 2.5            | 3.30        | 3.30        | 3.30        | 3.30        | 3.30          | 3.30          | 3.30                | 3.32                 |
</details>

Figure 6: Continous training a 0.036B model can match the performance of 0.17B model with an acceptable increase in training compute.

# 4.3 Experiments

Next, we present several experimental findings of WSD LRS.

Loss Decreases Dramatically in Decay Stage. We try WSD LRS on 0.036B models. As shown in Figure $5 ,$ in the decay stage, as the learning rate begins to decrease, the loss experiences a significant rapid decline and quickly decreases to be equal to or lower than the Cosine LRS at step $T = { \dot { S } }$ . At the same time, we can reuse the model before decay and continue training with the previous high learning rate. After more steps of training $\check { S } ^ { \prime } ,$ , we can also perform annealing to achieve the same loss as the Cosine LRS at $C o s i n e ( \breve { S ^ { \prime } } )$ . This verifies our assumption that the training stage can be explicitly split into the stable training and decay stages.

10% Steps are Enough. From the two-stage training perspective, shortening the decay stage will greatly benefit the fast test of different model checkpoints of stable training. Therefore, we conduct experiments that start from the same stable training checkpoints and have different decay steps. Also shown in Figure 5, among all three stable training checkpoints in 40N, 60N, and 80N training data, having a decay of 10% of the total tokens is sufficient to achieve the best results, while a decay of 2.5% of total tokens falls short. Therefore, in the subsequent training experiments, we use a decay of about 10% to ensure full convergence.

Effective Data Scaling with WSD LRS. With WSD LRS, we can continuously train the LM to extreme convergence. To further demonstrate the potential of training a fixed-sized model to convergence, we compare continuously training a 0.036B LM with a 0.17B model with 40N data. In Figure 6, the green lines represent 0.036B models trained with different stable training tokens. Despite the last point of the 0.036B series being trained with many more tokens than Chinchilla Optimal (Hoffmann et al., 2022), it still has space for performance improvement.

To find the limit of continuously training this fixed-sized LM, we estimate how the model’s optimal performance changes with its computation during continuous training. By optimal performance, we mean the loss of training token D is achieved by WSD(D, 0.1D). With a series of D, the losses will form the optimal loss envelope. Due to uncertainty about the function form of the loss envelope, we try two fitting formulas: (1) exponential: $L ( C ) =$ $\alpha e ^ { - \beta C } + L _ { 0 }$ and (2) power-law: $L ( C ) = \beta C ^ { - \alpha } + L _ { 0 }$ . The fitting results for both functions are in Appendix B.2. We find that the power-law form fits better (similar to the Cosine LRS (Kaplan et al., 2020)). In Figure $^ { 6 , }$ the fitted curve is shown in green dotted lines. To intuitively estimate and comprehend the effect of continuous training such a fixed-sized model, we also trained a 0.17B model with WSD(40N, 4N), which is shown in pink in Figure 6. We can see that a 0.036B model can match the performance of a 0.17B model with an acceptable increase ( 4 times) in training compute while saving a lot of inference computation (Sardana & Frankle, 2023) (saving  5 times per inference call), indicating a better inference-compute-optimal setting (Sardana & Frankle, 2023).

# 4.4 Analysis of the Decay Stage

In this section, we provide a brief analysis of the loss drop in the decay stage, examining it through the prisms of checkpoint updates and gradient information. We calculate the maximum weight element update maxij(W(t+1)ij $c _ { i j } ( W _ { i j } ^ { ( t + 1 ) } - \mathbf { \bar { W } } _ { i j } ^ { ( t ) } )$ W(t)) across all weight matrices in the MiniCPM-2.4B (Introduced in Section 6). As depicted in Figure $^ { 7 , }$ the updates exhibit a robust correlation with the learning rate’s magnitude. Notwithstanding the illustration of the two submodules (gate proj and q proj module of the 25th layer), this pattern is prevalent across every layer and submodule within the network. This observation may not be trivial: the model checkpoints experience significant updates preceding the learning rate’s decay, yet the loss exhibits minimal reduction. Conversely, during the decay stage, despite less pronounced weight alterations, there is an accelerated decrease in loss.

Further examination of the gradient data is undertaken by training a 0.2B model, meticulously recording every step gradient information, and evaluating the differences between consecutive steps, thereby providing an approximation of second-order gradient information. We treat the gradient at step t as a flattened vector $\mathbf { g } ^ { ( t ) }$ , and the parameter (also flattened as a vector $\mathbf { x } ^ { ( t ) }$ ) update between step t and $t + 1$ is $\mathbf { v } ^ { ( t ) } = \mathbf { x } ^ { ( \hat { t } + 1 ) } - \mathbf { x } ^ { ( t ) }$ . The gradient norm take the L2 norm of the gradient $\| \bar { \mathbf { g } } ^ { ( t ) } \|$ , gradient inner product is $\mathbf { g } ^ { ( t + 1 ) } \cdot \mathbf { g } ^ { ( t ) }$ , the cosine of the gradient’s angle is given by $\frac { \mathbf { g } ^ { ( t + 1 ) } { \cdot } \mathbf { g } ^ { ( t ) } } { \| \mathbf { g } ^ { ( t + 1 ) } \| \| \mathbf { g } ^ { ( t ) } \| }$ . Imaging the optimization process as a trajectory over a high-dimension manifold, first order directional derivative along the trajectory is computed as $\begin{array} { r } { D _ { 1 } = \frac { \mathbf { g } ^ { ( t + 1 ) } \cdot \mathbf { v } ^ { ( t ) } } { \| \mathbf { v } ^ { ( t ) } \| } } \end{array}$ g(t+1) ·v(t) , and the second order directional derivative is $\begin{array} { r } { D _ { 2 } = \frac { ( \mathbf { g } ^ { ( t + 1 ) } - \mathbf { g } ^ { ( t ) } ) { \cdot } \mathbf { v } ^ { ( t ) } } { \| \mathbf { v } ^ { ( t ) } \| ^ { 2 } } . \ D _ { 1 } , D _ { 2 } } \end{array}$ (g(t+1) enables an approximate estimation of the loss curvature on the trajectory, $\begin{array} { r } { K = \frac { \left| D _ { 2 } \right| } { \left( 1 + D _ { 1 } ^ { 2 } \right) ^ { \frac { 3 } { 2 } } } } \end{array}$ The results of these statistics over time are shown in Figure 8. We can see that the gradient norm diminishes during the decay phase, and upon commencement of this stage, the cosine between gradients predominantly assumes positive values, suggesting that in the decay phase, model parameters undergo consistent changes across steps. Concerning directional derivatives, it is remarkable that the first-order directional derivative diminishes exponentially with each step, aligning closely with the learning rate, while the second-order directional derivative exhibits a slight increase in magnitude. The curvature of the loss function also increases by a magnitude, indicating the proximity to a local optimum. These findings potentially offer a deeper insight into the shape optimization space, a subject reserved for future exploration.

![](images/524726e00a4997f41d5d5b83bdeb943dcc603a42f58683489925fd40f8697c2a.jpg)

<details>
<summary>line</summary>

| Checkpoint Index | Max Element-wise Difference of Weights between Checkpoints |
| ---------------- | ---------------------------------------------------------- |
| 0                | 0.02                                                       |
| 50               | 0.08                                                       |
| 100              | 0.10                                                       |
| 150              | 0.09                                                       |
| 200              | 0.09                                                       |
| 250              | 0.09                                                       |
| 300              | 0.09                                                       |
| 350              | 0.09                                                       |
| 400              | 0.09                                                       |
| 450              | 0.14                                                       |
| 500              | 0.09                                                       |
| 550              | 0.01                                                       |
| 600              | 0.00                                                       |
| 650              | 0.00                                                       |
</details>

![](images/fe68ada6a80002389a05e31fda8cce22d8774b306e78837aa686e3210b7a8d28.jpg)

<details>
<summary>line</summary>

| Checkpoint Index | Max. Element-wise Difference of Weights between Checkpoints |
| ---------------- | ------------------------------------------------------------- |
| 0                | 0.05                                                          |
| 50               | 0.10                                                          |
| 100              | 0.10                                                          |
| 150              | 0.10                                                          |
| 200              | 0.10                                                          |
| 250              | 0.10                                                          |
| 300              | 0.10                                                          |
| 350              | 0.10                                                          |
| 400              | 0.10                                                          |
| 450              | 0.14                                                          |
| 500              | 0.12                                                          |
| 550              | 0.02                                                          |
| 600              | 0.00                                                          |
| 650              | 0.00                                                          |
</details>

Figure 7: Max Difference of Checkpoints.

![](images/5581d6676ba97d7981cb5160eacd61d10c465256945f9204412b39f7fef598a3.jpg)  
Figure 8: Gradient statistics over the training of a 0.2B model using WSD LRS. The exponen tial decay stage begins at 8000 steps.

# 4.5 Measuring the Scaling Law with WSD LRS

Scaling laws serve as a fundamental guiding principle in the development of LLMs. Although these scaling laws exhibit variability in specific coefficients due to diverse configurations across model series, the compute optimal data-to-model ratio remains a meaningful metric across different scaling law functions, which “marginalizes“ out the specific value of loss. Regarding this ratio, Kaplan et al. (2020) posit that a tenfold increase in model scale should equate to a singlefold increase in data scale. Conversely, Hoffmann et al. (2022) argue for the same scaling rate between model size and data size. What’s more, current models such as LLama $2 ^ { \circ }$ (Touvron et al., 2023), train much more data than what Hoffmann et al. (2022) claims, still yielding considerable performance gain. Indicating a higher data-to-model ratio.

This unaddressed uncertainty stems from the challenges inherent in training multiple models of varying sizes and data sizes in traditional scaling experiments. Previously, if the average cost of training one model size on one data size is C, then conducting the scaling experiments with m model sizes and m data sizes takes approximately $O ( m ^ { 2 } ) \bar { C }$ .

In this section, we introduce the utilization of the WSD scheduler as an effective approach to explore the scaling law with linear cost $( O ( m C ) )$ . Since the WSD scheduler has the advantage of arriving at the optimal loss of Cosine LRS after decaying from stable stage checkpoints of any step, we are now able to precisely measure the optimal scaling properties without re-training the models from scratch to different amounts of tokens, thus making the scaling law measurement much more efficient along the data axis.

We measure the scaling law along the data and model axes by training SLMs of 6 sizes ranging from 0.04B to 2B, each with 6 decayed models starting from the checkpoint of 10N to 60N data during the stable training stage. The final loss is evaluated on five heldout evaluation datasets. To potentially compare the loss when the model uses different tokenizers, we take the average of loss by a number of bytes instead of a number of tokens, following Achiam et al. (2023). The final loss of each pair of data size and model size is shown in the blue lines in Figure 17.

Then we fit the losses with model size N and data size D following Hoffmann et al. (2022) using scipy curvefit function:

$$
L (N, D) = C _ {N} N ^ {- \alpha} + C _ {D} D ^ {- \beta} + L _ {0} \tag {2}
$$

The fitted curve along the data axis for each dataset and each checkpoint are shown in orange lines in Figure 17. Then we have the optimal model size $\hat { N _ { o p t . } }$ , dataset size $D _ { o p t } ,$ , given a fixed amount of compute $C = 6 N D$ (Rae et al., 2021) as:

$$
\frac {N _ {o p t}}{D _ {o p t}} = K ^ {2} \left(\frac {C}{6}\right) ^ {\eta}, \tag {3}
$$

$\begin{array} { r } { K = \left( \frac { \alpha C _ { N } } { \beta C _ { D } } \right) ^ { \frac { 1 } { \alpha + \beta } } } \end{array}$ ( $\begin{array} { r } { \eta = \frac { \beta - \alpha } { \alpha + \beta } } \end{array}$ . The derivation of $N _ { o p t }$ closely follows Hoffmann et al. (2022) by substituting D with $\frac { C } { 6 N }$ in Equation $^ { 2 , }$ and minimize $L ( N )$ given C. A similar way is adopted for $D _ { o p t }$ . From Equation ${ \hat { 3 } } ,$ when $\alpha = \beta , N _ { o p t } / D _ { o p t }$ is a constant, supporting Hoffmann et al. (2022)’s claim, and when $\alpha < \beta ,$ we should emphasize more on parameter scaling (Kaplan et al., 2020), and vise versa.

In our experiments, the fitted relationship between loss and $N , D$ is shown in the contour plot of equal loss in Figure 10. The equation of fitted scaling law is shown in the first text box in each subplot. We can see that in all evaluation corpora, we have $\beta < \alpha$ . More specifically, on average, we have $\alpha = 0 . 2 9 , \beta = 0 . 2 3 , K ^ { 2 } = 0 . 0 1 , \eta = - 0 . 1 0$ . Since α is slightly larger than $\beta ,$ this result shows that as the computation scale, we should slightly emphasize more on data scaling than model scaling, which aligns with Hoffmann et al. (2022).

As for the concrete data-to-model ratio Dopt $\frac { D _ { o p t } } { N _ { o p t } }$ Nopt we notice that there is a huge gap in compute optimal regime between ours and Hoffmann et al. (2022) despite that the trend of $\frac { D _ { o p t } , } { N _ { o p t } }$ with Nopt compute C is aligned between ours and theirs. Specifically, the data size should be 192 times larger than the model size on average, as opposed to 20 times in Hoffmann et al. (2022). We note that this aligns with the observation in Section 4.3 and Figure 6.

With respect to the large deviation from Chinchilla Optimal $\frac { N _ { o p t } } { D _ { o p t } }$ , we notice that their scaling experiment was conducted in a not very recent configuration. To compare with more recent configuration such as Llama2 (Touvron et al., 2023), we extract the training loss data from Llama2 paper (left part) in Appendix Figure 18 and estimate the compute optimal $\frac { D _ { o p t } } { N _ { o p t } }$ Nopt in their paper using the right part of Figure 18. Since they use Cosine LRS, the loss is not optimal in the middle of the training, depicted by the concave curve during training in the right figure of Figure 18. We fill the concave part with a straight line to estimate the optimal loss envelope if they had used the WSD LRS. After that, the compute model size should roughly be the regime in which a model’s loss curve is about to intersect with a larger model’s loss curve. With this intuition, the 13B model is about to intersect with the 34B model at $1 0 ^ { 5 }$ EFlops $( 1 0 ^ { 1 } 8 \mathrm { F l o p s } )$ , and the 34B model is about to intersect with the 70B model at $5 \times 1 0 ^ { 5 }$ EFlops. Therefore, we estimate the $\frac { D _ { o p t } } { N _ { o p t } }$ Nopt to be roughly $\textstyle { \frac { 5 \times 1 0 ^ { 5 } } { 6 \times 3 4 ^ { 2 } } } \sim { \frac { 1 0 ^ { 5 } } { 6 \times 1 3 ^ { 2 } } }$ 10 2 , which is $7 0 \sim 1 0 0$ . Therefore, under this approximate comparison, their data-model ratio is closer to ours. And our configuration can absorb more data into a smaller model compared to previous ones. However, we note that the above estimates are only a rough one.

A larger data-to-model ratio means that we can absorb more data into a smaller model than we previously thought, which is more efficient for inference and deployment. We hope WSD LRS will help more researchers explore $L ( N , D )$ with less effort and make the relationship clearer in LLMs.

# 5 Two Stage Pre-training Strategy

Typically, the training of instruction following LLMs contains the pre-training stage and the supervised fine-tuning (SFT) stage (Zhang et al., 2023; Wei et al., 2021). In the pretraining stage, the data is composed of large-scale unlabeled data, while in the SFT stage, high-quality labeled data becomes the optimization target. In light of the pronounced loss decrease observed during the decay stage of the WSD LRS, we postulate that the integration of high-quality labeled data in this phase presents dual advantages:

• Introducing this data during the annealing phase, in addition to the SFT stage, fosters a more comprehensive model learning. Specifically, it facilitates a more pronounced loss reduction in relation to the SFT data distribution, rather than the pre-training data distribution. This approach is more congruent with actual user scenarios.   
• In contrast to a uniform distribution of high-quality data throughout the entire pre-training process, this method enhances training by concentrating on data and sustaining continuous pre-training. If we do not predetermine a training step, we will repeat a small dataset throughout an ongoing pre-training process, which could lead to negative effects.

Based on these two hypotheses, we propose the following training strategy: during the pretraining phase, only use large-scale coarse-quality pre-training data, which is abundant and can support continuous training when provided with more computational resources. During the annealing phase, we use diverse and high-quality knowledge and ability-oriented SFT data, mixed into the pre-training data.

To validate the advantages of our training strategy, we conduct comparison experiments using (A) MiniCPM-2.4B’s intermediate checkpoint in the stable stage; and (B) MiniCPM-1.2B’s last checkpoints in the stable stage. Specifically, we compare the following:

1. A-1: 2.4B model, decay using only pre-training data, followed by 4B token SFT.   
2. A-2: 2.4B model, decay using the aforementioned high-quality data unlabeled data and SFT data mixed into pre-training data, also followed by 4B token SFT.   
3. B-1: 1.2B model, decay using only pre-training data, followed by 6B token SFT.   
4. B-2: 1.2B model, decay using only pre-training data, followed by 12B token SFT.

![](images/b44f7b6a4dc67de1c05f2d929f694b2dcad335ffdcf19a18a84e0de1e2fb080d.jpg)  
Figure 9: The result of scaling experiments with WSD Scheduler (above) and the fitted scaling curve (below). The x-axis is the computation Flops $C = 6 N D ,$ , each color of the line represents the same model with different computation Flops. We can see that smaller models are better than larger models when the Flops are small and worse when the Flops are large. Thus models of different sizes will intersect with each other in the plot around the compute optimal regime.

5. B-3: 1.2B model, annealing using the aforementioned high-quality data + SFT data mixed into pre-training data, also followed by 6B token SFT.

The results of the experiments are shown in Table 1. We can see that, despite the A-2 and A-1 have undergone the same SFT distribution, adding SFT data to the decay stage pushes the boundary . Comparison between B-2 and B-3 demonstrate that the deficiency of only SFT is not due to the insufficient training tokens in SFT stage.

The results indicate that the benefits of introducing high-quality data at the beginning of the decay stage are much higher than simply adding it during the SFT phase. Therefore, we recommend that specialization and enhancement of model capabilities should start from the decay phase.

# 6 Model

In this section, we begin to introduce the MiniCPM model that aggregates the aforementioned observations and techniques.

![](images/c692ec8d229edd4faf4970522299d454298c51cb2be15396cbc0c4ce462b0571.jpg)

Figure 10: The fit result of the scaling experiment with WSD Scheduler. The black dots in a horizontal line denote the decayed checkpoints in different compute within the same model size. 

<table><tr><td></td><td>C-Eval</td><td>CMMLU</td><td>MMLU</td><td>GSM8K</td><td>MATH</td><td>HumanEval</td><td>MBPP</td></tr><tr><td>A-1</td><td>40.0</td><td>41.5</td><td>44.6</td><td>27.7</td><td>5.1</td><td>27.7</td><td>24.4</td></tr><tr><td>A-2</td><td>52.6</td><td>51.1</td><td>50.9</td><td>42.3</td><td>5.4</td><td>30.4</td><td>30.3</td></tr><tr><td>B-1</td><td>40.9</td><td>41.5</td><td>47.9</td><td>34.2</td><td>7.9</td><td>43.9</td><td>30.5</td></tr><tr><td>B-2</td><td>41.2</td><td>42.0</td><td>47.9</td><td>34.4</td><td>7.3</td><td>43.9</td><td>29.8</td></tr><tr><td>B-3</td><td>49.1</td><td>46.8</td><td>49.6</td><td>31.8</td><td>10.5</td><td>44.5</td><td>32.8</td></tr></table>

Table 1: The ablation study of different training strategies.

# 6.1 Model Details

Vocabulary. We use two tokenizers of 122,753 vocabulary size for MiniCPM-2.4B and 73,440 vocabulary for MiniCPM-1.2B. A small vocabulary for 1.2B favors efficiency without harming much performance. Details of the tokenizers are in Appendix C. Including the embedding parameters increases total parameters by 0.3B and 0.2B respectively.

Shared Input-output Layer. For SLM, the embedding takes up a large parameter space. To make the model parameters smaller, we use the Embedding Sharing techniques for both MiniCPM-2.4B and MiniCPM-1.2B.

Deep-and-thin Network. We train MiniCPM-2.4B before training MiniCPM-1.2B. When training MiniCPM-2.4B, we adopt a deeper and thinner architecture compared to Phi-

<table><tr><td>Model</td><td>N (B)</td><td> $d_m$ </td><td> $d_{ff}$ </td><td> $d_h$ </td><td> $n_q$ </td><td> $n_{kv}$ </td><td>L</td><td>Batch size (M)</td><td>Tokens (T)</td></tr><tr><td>MiniCPM-1.2B</td><td>1,247,442,432</td><td>1,536</td><td>3,840</td><td>64</td><td>24</td><td>8</td><td>52</td><td>2M → 4M</td><td>1.1T</td></tr><tr><td>MiniCPM-2.4B</td><td>2,442,057,984</td><td>2,304</td><td>5,760</td><td>64</td><td>36</td><td>36</td><td>40</td><td>4M</td><td>1.1T</td></tr></table>

Table 2: Model configurations for MiniCPM. N $( \mathrm { B } ) , d _ { m } , d _ { f f } , d _ { h } , n _ { q } , n _ { k v } , L$ , Batch size (M), Tokens (T) represents the number of non-embedding parameters of the model, model hidden dimension, feedforward layer bottleneck dimension, attention head dimension, number of queries, number key/values, number of layers, training batch size, total training tokens.

2 (Javaheripi & Bubeck, 2023) (40 layers compared to 32 layers). Recently, Liu et al. (2024) propose to train deep and thin networks for SLMs, which aligns with our perspective. Therefore, we further make the architecture deeper and thinner for MiniCPM-1.2B.

Group Query Attention. We train MiniCPM-2.4B without modification on the attention layer. Whereas we apply Group Query Attention (Ainslie et al., 2023) to MiniCPM-1.2B, inspired by Liu et al. (2024), to further reduce the parameters number.

# 6.2 Training Stages

The overall training of the MiniCPM base model includes three stages: stable training stage, decay stage, SFT stage (Zhang et al., 2023; Wei et al., 2021). Throughout the stages, we use Adam Optimizer (Kingma & Ba, 2014).

Stable Training Stage. We utilize around 1T data (see Section 11 for data distribution), with the majority of the data sourced from open datasets. We use the optimal configuration discovered during the model wind tunnel experiments, WSD LRS, with a batch size of 3.93 million and a max learning rate of 0.01.

Decay Stage. We use a mixture of the pretraining data and high-quality SFT data. For the specific annealing form of the WSD scheduler, we employ exponential annealing, i.e. $f ( s - \overline { { T } } ) = 0 . 5 ^ { ( s - S ) / T }$ , in which T is set to be 5000 steps (20B tokens).

SFT Stage. We find it still necessary to conduct a separate SFT phase. We utilize SFT data similar to the annealing phase excluding pre-training data and train with approximately 6 billion tokens. The learning rate for SFT is aligned with the one at the end of annealing, and a WSD Scheduler with exponential decay is also employed.

# 6.3 Training Data Distribution

![](images/8c6c2d9b2d2cbbffa04659b87f3f8a82c90308f18eaeb82b9a1534b0af59bdba.jpg)

<details>
<summary>pie</summary>

Data Mixture of Stable Stage
| Category | Value |
|---|---|
| Code Pretrain | 25.0 |
| Code Pretrain | 25.0 |
| Code Pretrain | 8.0 |
| Code Pretrain | 15.0 |
| Code Pretrain | 24.0 |
| CommonCrawl.Chn | 25.0 |
| Dolma | 24.0 |
| Pile | 8.0 |
| Open Web Math Archiv peS2o | 1.0 |
</details>

![](images/0c18dc9b92bd42bd09e6e73f26707f951fa1b20e79f95c307ee9759e0bdda709.jpg)  
Figure 11: Data mixture of different training stages. The stable stage is shown on the left and the decay stage is shown on the right.

We introduce our training data distribution in Figure 11. In the figure, CommonCrawl Chn in a Chinese Corpus is derived from CommonCrawl raw corpus and goes through thorough cleaning. Dolma (Soldaini et al., 2024), C4 (Raffel et al., 2019), and Pile (Gao et al., 2020; Biderman et al., 2022) are English corpora. They are deduplicated inner corpus and across corpus using MinHash algorithms (Broder, 1997). The Code Pre-train data contains the stack (Kocetkov et al., 2022) and StarCoder Li et al. (2023a), with inner deduplication and cross deduplication. In the decay stage, the data mixture contains more diverse data and proprietary data, including UltraChat (Ding et al., 2023), SlimOrca (Lian et al., 2023a;b), OssInstruct (Wei et al., 2023), EvolInstruct (Xu et al., 2023). The data with the suffix SFT is our proprietary data including LeetCode questions, Kindergarten through 12th grade (K12) textbooks and questions, etc.

# 6.4 Training Loss

The overall training loss on the C4 dataset is shown in Figure 12. We can see that as expected in the preliminary experiments, the loss decreases sharply in the decay stage. Since we use the exponential decay, the loss still drops after the learning rate drops below 10% of the max learning rate. However, since we continue to SFT the model after the decay stage, we do not utilize the final checkpoints. The checkpoints we finetune from are shown in the last checkpoint of dark green segment. The first drop in MiniCPM-1.2B is the result of enlarging batch size, which might have a similar effect as decreasing learning rate (Smith et al., 2017).

![](images/597afa3715604e50c221ab4cc56d3be98fc9ab68b9e08a92545c50670195eb81.jpg)

<details>
<summary>line</summary>

| Tokens (B) | Loss on C4 |
| ---------- | ---------- |
| 0          | 3.0        |
| 200        | 2.8        |
| 400        | 2.7        |
| 600        | 2.6        |
| 800        | 2.6        |
| 1000       | 2.6        |
| 1200       | 2.5        |
</details>

![](images/cff709d45197c87ba0a5cf2d7c7b74d789b475b2f7858d7090b67faf9411cb57.jpg)

<details>
<summary>line</summary>

| Tokens (B) | Loss on C4 |
| ---------- | ---------- |
| 0          | 3.0        |
| 200        | 2.7        |
| 400        | 2.7        |
| 600        | 2.65       |
| 800        | 2.65       |
| 1000       | 2.6        |
| 1200       | 2.4        |
</details>

Figure 12: Loss curve on C4 dataset for MiniCPM-1.2B (Left) and MiniCPM-2.4B (Right). The orange segment at the tail of the loss curve represents the remaining decay process, which is not utilized in the released version of MiniCPM.

# 6.5 Evaluation

The overall evaluation utilizes our open-source tool UltraEval3. UltraEval is an open-source framework for assessing the capabilities of foundation models. It provides a lightweight and user-friendly evaluation system, supporting performance assessment for mainstream large models, and catering to the rapid evaluation needs of model training teams. The underlying inference and acceleration use the open-source framework vLLM (Kwon et al., 2023), and the dataset includes commonly used datasets: MMLU (Hendrycks et al., 2020) for English knowledge, CMMLU (Li et al., 2024) and C-Eval (Huang et al., 2024) for Chinese knowledge, HumanEval (Chen et al., 2021) and MBPP (Austin et al., 2021) for coding, GSM8K (Cobbe et al., 2021) and MATH (Hendrycks et al., 2021) for mathematics, and HellaSwag (Zellers et al., 2019), ARC-e (Clark et al., 2018), ARC-c (Clark et al., 2018) for commonsense reasoning, and BBH (Suzgun et al., 2022) for logic reasoning.

Due to the difficulty of standardizing evaluations for large models and the lack of publicly available prompts and test codes for many models’ evaluations, we try our best to adapt the evaluation methods to suit various model types. Specifically, we start from a standardized input prompt during testing and adjust it according to each model’s appropriate inputoutput template. The evaluation scripts and prompts are also open-source in our repository, and we welcome developers to continually improve our evaluation methods.

When testing QA tasks (ARC-e, ARC-c, HellaSwag), two approaches are typically employed. The first involves using Perplexity (PPL): we extend each option as the continuation of the question and use the PPL of the option as the selection criterion. The second is direct generation, where the model directly outputs answer options. We observe significant differences in results obtained using these two methods. MiniCPM performs similarly in direct generation and PPL tests, with better performance in direct generation. On the other hand, Mistral-7B-v0.1 performs better in PPL tests but exhibits poorer performance in direct generation. To address this phenomenon, when reporting the scores for each model, we adopt the score from the evaluation method that yields the highest score, ensuring fairness in comparison.

<table><tr><td>Model</td><td>C-Eval</td><td>CMMLU</td><td>MMLU</td><td>HumanEval</td><td>MBPP</td><td>GSM8K</td><td>MATH</td></tr><tr><td>Llama2-7B</td><td>32.42</td><td>31.11</td><td>44.32</td><td>12.20</td><td>27.17</td><td>13.57</td><td>1.80</td></tr><tr><td>Qwen-7B</td><td>58.96</td><td>60.35</td><td>57.65</td><td>17.07</td><td>42.15</td><td>41.24</td><td>5.34</td></tr><tr><td>Deepseek-7B</td><td>42.82</td><td>44.45</td><td>47.82</td><td>20.12</td><td>41.45</td><td>15.85</td><td>1.53</td></tr><tr><td>Mistral-7B</td><td>46.12</td><td>42.96</td><td>62.69</td><td>27.44</td><td>45.20</td><td>33.13</td><td>5.00</td></tr><tr><td>Gemma-7B</td><td>42.57</td><td>44.20</td><td>60.83</td><td>38.41</td><td>50.12</td><td>47.31</td><td>6.18</td></tr><tr><td>Llama2-13B</td><td>37.32</td><td>37.06</td><td>54.71</td><td>17.07</td><td>32.55</td><td>21.15</td><td>2.25</td></tr><tr><td>MPT-30B</td><td>29.34</td><td>32.09</td><td>46.56</td><td>21.95</td><td>35.36</td><td>10.31</td><td>1.56</td></tr><tr><td>Falcon-40B</td><td>40.29</td><td>41.57</td><td>53.53</td><td>24.39</td><td>36.53</td><td>22.44</td><td>1.92</td></tr><tr><td>TinyLlama-1.1B</td><td>25.02</td><td>24.03</td><td>24.3</td><td>6.71</td><td>19.91</td><td>2.27</td><td>0.74</td></tr><tr><td>Qwen-1.8B</td><td>49.81</td><td>45.32</td><td>43.37</td><td>7.93</td><td>17.8</td><td>19.26</td><td>2.42</td></tr><tr><td>Qwen1.5-1.8B</td><td>55.00</td><td>50.85</td><td>43.81</td><td>5.49</td><td>24.82</td><td>26.16</td><td>3.25</td></tr><tr><td>Gemini Nano-3B</td><td>-</td><td>-</td><td>-</td><td>-</td><td>27.20</td><td>22.80</td><td>-</td></tr><tr><td>StableLM-Zephyr-3B</td><td>30.34</td><td>30.89</td><td>45.90</td><td>35.37</td><td>31.85</td><td>52.54</td><td>12.12</td></tr><tr><td>Phi-2(2B)</td><td>23.37</td><td>24.18</td><td>52.66</td><td>47.56</td><td>55.04</td><td>57.16</td><td>3.50</td></tr><tr><td>Gemma-2B</td><td>29.26</td><td>28.56</td><td>38.49</td><td>24.39</td><td>29.74</td><td>16.83</td><td>3.34</td></tr><tr><td>MiniCPM-1.2B</td><td>49.14</td><td>46.81</td><td>49.63</td><td>44.51</td><td>32.75</td><td>31.77</td><td>10.60</td></tr><tr><td>MiniCPM-2.4B</td><td>51.13</td><td>51.07</td><td>53.46</td><td>50.00</td><td>47.31</td><td>53.83</td><td>10.24</td></tr><tr><td>Model</td><td>BBH</td><td>ARC-e</td><td>ARC-c</td><td>HellaSwag</td><td>Avg</td><td> $Avg_{en}$ </td><td> $Avg_{chn}$ </td></tr><tr><td>Llama2-7B</td><td>33.23</td><td>75.25 $^{\dagger}$ </td><td>42.75</td><td>75.62 $^{\dagger}$ </td><td>35.40</td><td>36.21</td><td>31.77</td></tr><tr><td>Qwen-7B</td><td>37.75</td><td>83.42</td><td>64.76</td><td>75.32 $^{\dagger}$ </td><td>49.46</td><td>47.19</td><td>59.66</td></tr><tr><td>Deepseek-7B</td><td>33.38</td><td>74.58 $^{\dagger}$ </td><td>42.15 $^{\dagger}$ </td><td>75.45 $^{\dagger}$ </td><td>39.96</td><td>39.15</td><td>43.64</td></tr><tr><td>Mistral-7B</td><td>41.06</td><td>83.92</td><td>70.73</td><td>80.43 $^{\dagger}$ </td><td>48.97</td><td>49.96</td><td>44.54</td></tr><tr><td>Gemma-7B</td><td>39.19</td><td>89.35</td><td>76.79</td><td>79.47</td><td>52.22</td><td>54.18</td><td>43.39</td></tr><tr><td>Llama2-13B</td><td>37.92</td><td>78.87 $^{\dagger}$ </td><td>58.19</td><td>79.23 $^{\dagger}$ </td><td>41.48</td><td>42.44</td><td>37.19</td></tr><tr><td>MPT-30B</td><td>38.22</td><td>78.66 $^{\dagger}$ </td><td>46.08 $^{\dagger}$ </td><td>79.72 $^{\dagger}$ </td><td>38.17</td><td>39.82</td><td>30.72</td></tr><tr><td>Falcon-40B</td><td>36.24</td><td>81.94 $^{\dagger}$ </td><td>57.68</td><td>83.26 $^{\dagger}$ </td><td>43.62</td><td>44.21</td><td>40.93</td></tr><tr><td>TinyLlama-1.1B</td><td>28.78</td><td>60.77 $^{\dagger}$ </td><td>28.15 $^{\dagger}$ </td><td>58.33 $^{\dagger}$ </td><td>25.36</td><td>25.55</td><td>24.53</td></tr><tr><td>Qwen-1.8B</td><td>29.07</td><td>63.97 $^{\dagger}$ </td><td>43.69</td><td>59.28 $^{\dagger}$ </td><td>34.72</td><td>31.87</td><td>47.57</td></tr><tr><td>Qwen1.5-1.8B</td><td>28.82</td><td>64.86</td><td>45.56</td><td>59.39</td><td>37.09</td><td>33.57</td><td>52.93</td></tr><tr><td>Gemini Nano-3B</td><td>42.40</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr><tr><td>StableLM-Zephyr-3B</td><td>37.68</td><td>73.78</td><td>55.38</td><td>71.87 $^{\dagger}$ </td><td>43.46</td><td>46.32</td><td>30.62</td></tr><tr><td>Phi-2(2B)</td><td>43.39</td><td>86.11</td><td>71.25</td><td>73.07 $^{\dagger}$ </td><td>48.84</td><td>54.42</td><td>23.78</td></tr><tr><td>Gemma-2B</td><td>30.93</td><td>74.33</td><td>40.70</td><td>69.51</td><td>35.10</td><td>36.47</td><td>28.91</td></tr><tr><td>MiniCPM-1.2B</td><td>34.70</td><td>80.93</td><td>66.81</td><td>54.72</td><td>45.67</td><td>45.16</td><td>47.98</td></tr><tr><td>MiniCPM-2.4B</td><td>36.87</td><td>85.44</td><td>68.00</td><td>68.25</td><td>52.33</td><td>52.60</td><td>51.10</td></tr></table>

Table 3: Benchmark Score of MiniCPM-2.4B and MiniCPM-1.2B (both without RLHF). The two tables are continuous horizontally. $\mathbf { A v g }$ is over all dataset in the table, $\mathbf { A v g _ { c h n } }$ is the average of C-Eval and CMMLU while $\mathbf { \bar { A } v g _ { e n } }$ is the average of remaining datasets. † means the result is tested using PPL metrics. Bold numbers represent the best score among the SLMs. Results of Gemini Nano-3B are borrowed from Gemini et al. (2023).

The overall evaluation results are in Table 4. Overall, on the mentioned datasets, we have several observations. (1) On average, MiniCPM-2.4B ranks the highest among all the SLMs. (2) MiniCPM-2.4B performs similarly to Mistral-7B-v0.1 in English but significantly outperforms Mistral-7B-v0.1 in Chinese. (3) MiniCPM-2.4B outperforms Llama2-13B except in MMLU, BBH, and HellaSwag, while MiniCPM-1.2B outperforms Llama2-7B except in HellaSwag. (4)Generally, BBH is harder for SLMs than LLMs compared to another knowledge-oriented dataset, demonstrating that reasoning ability might be more dependent on model size than knowledge. (5) Among SLMs, Phi-2 performance is on par with MiniCPM on academic-oriented datasets. This might be because their training data mostly involves textbook-style data that emphasize educational and academic scenarios. Since our pre-training data covers more distribution, we think MiniCPM is better at knowledge and ability coverage, which can be seen in Appendix F.

# 7 MiniCPM Family

In this section, we introduce the other models that build on MiniCPM base models. Specif ically, we trained the aligned model, long-context model, and MoE model for MiniCPM 2.4B.

# 7.1 MiniCPM-DPO

After SFT, we employ DPO (Rafailov et al., 2024) for human preference alignment of the model. During this stage, UltraFeedback (Cui et al., 2023) is utilized as the primary alignment dataset, and a proprietary preference dataset is constructed to enhance the model’s code and mathematical capabilities. We conduct one epoch of DPO training with a learning rate of $1 \times 1 0 ^ { - 5 }$ and utilize a Cosine LRS since we have a pre-defined training step.

After applying DPO for preference alignment, the model’s score on MTBench (Zheng et al., 2024) increased from 6.89 after SFT to 7.25, surpassing even large models such as Llama2- 70B-Chat (see Figure 13). However, we also noticed that the performance on benchmarks is slightly compromised, which is known as the alignment tax (Askell et al., 2021).

<table><tr><td>Model</td><td>C-Eval</td><td>CMMLU</td><td>MMLU</td><td>HumanEval</td><td>MBPP</td><td>GSM8K</td><td>MATH</td></tr><tr><td>ChatGLM2-6B</td><td>52.05</td><td>49.21</td><td>45.77</td><td>10.37</td><td>9.38</td><td>22.74</td><td>5.96</td></tr><tr><td>Mistral-7B-Instruct-v0.1</td><td>38.06</td><td>36.96</td><td>53.56</td><td>29.27</td><td>39.34</td><td>28.73</td><td>3.48</td></tr><tr><td>Mistral-7B-Instruct-v0.2</td><td>42.55</td><td>41.92</td><td>60.51</td><td>36.59</td><td>48.95</td><td>40.49</td><td>4.95</td></tr><tr><td>Qwen-7B-Chat</td><td>58.57</td><td>57.23</td><td>56.03</td><td>15.85</td><td>40.52</td><td>42.23</td><td>8.3</td></tr><tr><td>Yi-6B-Chat</td><td>70.88</td><td>71.11</td><td>62.95</td><td>14.02</td><td>28.34</td><td>36.54</td><td>3.88</td></tr><tr><td>Baichuan2-7B-Chat</td><td>53.28</td><td>53.50</td><td>53.00</td><td>21.34</td><td>32.32</td><td>25.25</td><td>6.32</td></tr><tr><td>Deepseek-7B-chat</td><td>46.95</td><td>49.72</td><td>51.67</td><td>40.85</td><td>48.48</td><td>48.52</td><td>4.26</td></tr><tr><td>Llama2-7B-Chat</td><td>34.54</td><td>32.64</td><td>47.64</td><td>14.02</td><td>27.40</td><td>21.15</td><td>2.08</td></tr><tr><td>MiniCPM-2.4B-DPO</td><td>48.64</td><td>48.37</td><td>53.05</td><td>51.22</td><td>48.01</td><td>53.37</td><td>9.86</td></tr><tr><td>Model</td><td>BBH</td><td>ARC-e</td><td>ARC-c</td><td>HellaSwag</td><td>Avg</td><td> $Avg_{en}$ </td><td> $Avg_{chn}$ </td></tr><tr><td>ChatGLM2-6B</td><td>32.60</td><td>74.45</td><td>56.82</td><td> $58.48^†$ </td><td>37.98</td><td>35.17</td><td>50.63</td></tr><tr><td>Mistral-7B-Instruct-v0.1</td><td>39.52</td><td>81.61</td><td>63.99</td><td> $73.47^†$ </td><td>44.36</td><td>45.89</td><td>37.51</td></tr><tr><td>Mistral-7B-Instruct-v0.2</td><td>39.81</td><td>86.28</td><td>73.38</td><td> $84.55^†$ </td><td>50.91</td><td>52.83</td><td>42.24</td></tr><tr><td>Qwen-7B-Chat</td><td>37.34</td><td> $64.44^†$ </td><td> $39.25^†$ </td><td> $74.52^†$ </td><td>44.93</td><td>42.05</td><td>57.90</td></tr><tr><td>Yi-6B-Chat</td><td>37.43</td><td>84.89</td><td>70.39</td><td> $74.60^†$ </td><td>50.46</td><td>45.89</td><td>71.00</td></tr><tr><td>Baichuan2-7B-Chat</td><td>37.46</td><td>79.63</td><td>60.15</td><td> $69.23^†$ </td><td>44.68</td><td>42.74</td><td>53.39</td></tr><tr><td>Deepseek-7B-chat</td><td>35.70</td><td>76.85</td><td>63.05</td><td> $76.68^†$ </td><td>49.34</td><td>49.56</td><td>48.34</td></tr><tr><td>Llama2-7B-Chat</td><td>35.54</td><td>74.28</td><td>54.78</td><td> $75.65^†$ </td><td>38.16</td><td>39.17</td><td>33.59</td></tr><tr><td>MiniCPM-2.4B-DPO</td><td>36.22</td><td>85.02</td><td>68.17</td><td>65.67</td><td>51.60</td><td>52.29</td><td>48.51</td></tr></table>

Table 4: Benchmark scores for MiniCPM-2.4B-DPO compared with larger chat models.

![](images/3e9664be064ea9346ea6c63481273daf4691e260d2230dba48ee961835e5457c.jpg)

<details>
<summary>scatter</summary>

| Model | Number of Parameters (Billions) | MT-Bench Performance |
| --- | --- | --- |
| GPT-4-turbo* | >200 | 9.2 |
| Mistral-8x7B-Instruct-v0.1 | 8 | 8.3 |
| Zephyr-7B-beta | 8 | 7.2 |
| Vicuna-35B | 40 | 7.1 |
| LLaMA-2-70B-chat | 70 | 6.8 |
| MPT-7B-chat | 7 | 5.4 |
| Vicuna-7B | 7 | 6.2 |
| LLaMA-2-7B-chat | 10 | 6.6 |
| Vicuna-13B | 10 | 6.5 |
| LLaMA-2-13B-chat | 10 | 6.7 |
| MPT-30B-chat | 30 | 6.4 |
| ChatGLM2-6B | 6 | 5.0 |
| MiniCPM-2B | 2 | 7.2 |
* parameters are from unofficial sources
</details>

Figure 13: MTBench score of MiniCPM-DPO-2.4B surpasses many models of larger size.

# 7.2 MiniCPM-128K

Tasks involving lengthy contexts depend on the implicit information within these contexts, circumventing the need for the extensive knowledge often absent in SLMs. In this section, we expand the context length of MiniCPM-2.4B from 4,096 to 128,000 tokens, illustrating the capability of SLM to effectively process long contexts.

Initialization. For the initialization, we disable sharing embeddings between input and output, primarily to accommodate vocabulary parallelism essential for training with long context. The LM head is initialized from the input embedding.

Training. Similar to MiniCPM, MiniCPM-2.4B-128K utilizes the WSD as its learning rate scheduler and reuses the last checkpoint of the stable training stage of MiniCPM-2.4B. Concerning training data, we categorize the dataset distribution detailed in Section 6.3 into “short data” and “long data”. We classify books, wikis, and papers as “long data”, and the other as the “short data”. The training comprises 44% long data and 56% short data for continued training. For the extension of long contexts, we apply Adjusted Base Frequency (ABF) (Xiong et al., 2023) in the 4K to 32k range and employ NTK-Aware RoPE Scaling (bloc97, 2023) and curriculum learning from 32K to 128K. Both two stages involve future training. Furthermore, as indicated in Yi Tech Report (Young et al., 2024) and Zebra (Song et al., 2023), we use of synthetic long QA data that significantly enhances model performance in context-aware tasks.

Evaluation. We evaluate MiniCPM-2.4B-128K in ∞Bench (Zhang et al., 2024b), a pioneering benchmark for long context evaluations. The tasks in ∞Bench (Zhang et al., 2024b) extend beyond typical retrieval tasks and challenge the model with long context reasoning. We can see in Table 5, we achieve comparable results in Mistral-7B-Instruct-v0.2 (ABF1000w) and outperform ChatGLM3-6B-128K despite being 2.5 times smaller.

# 7.3 MiniCPM-MoE

We further extend the ability of MiniCPM using Mixture-of-Expert.

Initialization. MiniCPM-MoE is initialized utilizing Sparse Upcycling (Komatsuzaki et al., 2022). The dense model checkpoint, derived from the stable phase of MiniCPM, undergoes a transformation wherein each MLP layer is substituted by an MoE layer. These new MoE layers are exact replicas of the original MLP layers from the dense checkpoint. The router parameters are randomly initialized following a normal distribution with a mean of 0 and a variance of 0.01.

Routing Mechanism. The number of total non-embedding parameters of MiniCPM-MoE is 13.6B. During training and inference, two out of eight experts are activated for each token, resulting in the number of activated parameters being approximately 4B. To prevent training from collapsing, an additional load balancing loss (Fedus et al., 2022) is applied to the final training objective. This auxiliary loss is multiplied by 0.01 which is large enough to ensure a balanced distribution of tokens assigned to different experts.

<table><tr><td>Model</td><td>Passkey</td><td>Number String</td><td>KV Retrieval</td><td>Long Book Choice Eng</td><td>Long Book QA Chn</td><td>Long Book QA Eng</td><td>Long Book Sum Eng</td></tr><tr><td>LWM-Text-128K</td><td>100</td><td>97.8</td><td>0.6</td><td>28.82</td><td>15.93</td><td>14.31</td><td>9.99</td></tr><tr><td>Yarn-Mistral-7b-128K</td><td>92.71</td><td>56.61</td><td>0</td><td>27.95</td><td>15.49</td><td>9.55</td><td>9.06</td></tr><tr><td>Mistral-7B-Instruct-v0.2(ABF 1000w)</td><td>100</td><td>78.98</td><td>3.6</td><td>37.12</td><td>11.74</td><td>17.37</td><td>21.12</td></tr><tr><td>Yi-6B-200K</td><td>100</td><td>94.92</td><td>0</td><td>36.68</td><td>15.07</td><td>9.2</td><td>0.92</td></tr><tr><td>ChatGLM3-6B-128K</td><td>89.93</td><td>99.66</td><td>5.2</td><td>46.29</td><td>10.7</td><td>8.38</td><td>25.91</td></tr><tr><td>MiniCPM-2.4B-128K</td><td>98.31</td><td>99.83</td><td>9</td><td>29.69</td><td>23.06</td><td>16.33</td><td>15.73</td></tr><tr><td>Model</td><td>Long Dialogue QA Eng</td><td>Math Calc</td><td>Math Find</td><td>Code Debug</td><td>Code Run</td><td>Avg</td><td>Avg w/o Code &amp; Math</td></tr><tr><td>LWM-Text-128k</td><td>1.5</td><td>0</td><td>3.43</td><td>20.05</td><td>1</td><td>24.45</td><td>33.62</td></tr><tr><td>Yarn-Mistral-7b-128k</td><td>7.5</td><td>0</td><td>17.14</td><td>0.76</td><td>1.25</td><td>19.84</td><td>27.36</td></tr><tr><td>Mistral-7B-Instruct-v0.2(ABF 1000w)</td><td>9.5</td><td>0</td><td>29.43</td><td>17.51</td><td>0</td><td>27.75</td><td>36.9</td></tr><tr><td>Yi-6B-200K</td><td>3.5</td><td>0</td><td>4.29</td><td>0.51</td><td>0.75</td><td>22.15</td><td>32.54</td></tr><tr><td>ChatGLM3-6B-128K</td><td>6.5</td><td>0</td><td>8</td><td>5.33</td><td>1</td><td>25.58</td><td>36.57</td></tr><tr><td>MiniCPM-2.4B-128K</td><td>9.5</td><td>0</td><td>4.29</td><td>22.08</td><td>0</td><td>27.32</td><td>37.68</td></tr></table>

Table 5: MiniCPM-2.4B-128K result in ∞Bench (Zhang et al., 2024b)

Training. Similar to MiniCPM, we employ WSD as our learning rate scheduler. Regarding the training data, we adhere strictly to the distribution specified in Section 6.3. The training batch size is maintained at 4M tokens during the stable training and decay stages and is reduced to 2M tokens during the SFT stage. The pre-training phase (including continue pretrain and decay stage) spans 130K steps, after which we notice diminishing improvement. The benchmark results are detailed in Table 6.

<table><tr><td>Model</td><td>C-Eval</td><td>CMMLU</td><td>MMLU</td><td>HumanEval</td><td>MBPP</td><td>GSM8K</td><td>MATH</td><td>BBH</td></tr><tr><td>Llama2-34B</td><td>-</td><td>-</td><td>62.6</td><td>22.6</td><td> $33.0^†$ </td><td>42.2</td><td>6.24</td><td>44.1</td></tr><tr><td>Deepseek-MoE (16B)</td><td>40.6</td><td>42.5</td><td>45.0</td><td>26.8</td><td>39.2</td><td>18.8</td><td>4.3</td><td>-</td></tr><tr><td>Mistral-7B</td><td>46.12</td><td>42.96</td><td>62.69</td><td>27.44</td><td>45.20</td><td>33.13</td><td>5.0</td><td>41.06</td></tr><tr><td>Gemma-7B</td><td>42.57</td><td>44.20</td><td>60.83</td><td>38.41</td><td>50.12</td><td>47.31</td><td>6.18</td><td>39.19</td></tr><tr><td>MiniCPM-2.4B</td><td>51.13</td><td>51.07</td><td>53.46</td><td>50.00</td><td>47.31</td><td>53.83</td><td>10.24</td><td>36.87</td></tr><tr><td>MiniCPM-MoE (13.6B)</td><td>58.11</td><td>58.80</td><td>58.90</td><td>56.71</td><td>51.05</td><td>61.56</td><td>10.52</td><td>39.22</td></tr></table>

Table 6: Benchmark results of MiniCPM-MoE. † means evaluation results on the full set of MBPP, instead of the hand-verified set (Austin et al., 2021). The evaluation results of Llama2-34B and Qwen1.5-7B are taken from their technical reports.

# 8 Conclusion

This paper introduces MiniCPM, comprising two SLMs with 2.4 B and 1.2 B non-embedding parameters, respectively. These models demonstrate superior performance compared to their larger counterparts. Our training methodologies are scalable both in terms of model and data size, offering potential applicability in the development of LLMs. The introduction of our WSD scheduler is notable for promoting continuous training, exhibiting compelling training dynamics, and enabling efficient study of scaling law. We further introduce the MiniCPM family, including DPO, long context, and MoE versions. Future directions include in-depth analysis of the loss decrease in the decay stage, and enhancing the capability of MiniCPM by scaling in both model size and data size.

# Author Contributions

All authors contribute substantially to the MiniCPM project. Shengding Hu lead and participated in all aspects of the projects. This included the scaling experiments (conducted alongside Yuge Tu), babysitting the training of MiniCPM base models, and contributing to various other parts of the research. Shengding Hu wrote the paper. Chaoqun He was responsible for evaluating MiniCPM, while Ganqu Cui handled the RLHF training. Xiang Long, Zhi Zheng, Xinrong Zhang and Shengding Hu extended the context window to 128K. The MoE research was conducted by Yewei Fang and Zhi Zheng. Weilin Zhao and Kaihuo Zhang contributed to the training and inference infrastructure. The open-sourcing of MiniCPM was prepared by Yuxiang Huang and Shengding Hu. Shengding Hu, along with Chenyang Zhao, also provided analysis on the WSD scheduler’s training dynamics. Zheng Leng Thai developed the tokenizer. The development of MiniCPM-V was carried out by Chongyi Wang and Yuan Yao. The training corpus of MiniCPM was prepared by Jie Zhou, Jie Cai, Shengding Hu, Zhi Zheng, and Zhongwu Zhai. The paper was proofread by Xingrong Zhang and Chaoqun He. Insightful instructions on training MiniCPM were provided by Xu Han, Ning Ding, and Zhiyuan Liu. Finally, Zhiyuan Liu, Maosong Sun, Guoyang Zeng, Chao Jia, and Dahai Li offered essential resources for the training of MiniCPM.

# Limitations

Although we have proposed a thorough study of the scaling law with SLMs, this paper does not extend to training an LLM to validate the scaling law. The application of WSD LRS on LLMs has not been fully explored to date. However, we remain optimistic about its potential advantages.

# Acknowledgement

MiniCPM was initially published as a technical blog on February 1st, 2024. Since then, we have received numerous insightful feedback from the community, significantly contributing to the development of this paper. We extend our gratitude to Chunting Zhou and Armen Aghajanyan for their valuable discussions. Special thanks go to Peiqin Sun and Yan Wang for their meticulous feedback on clarifying ambiguities in the blog. Additionally, we appreciate the open-source community’s efforts in integrating MiniCPM into inference frameworks like llama.cpp, etc.

# References

Josh Achiam, Steven Adler, Sandhini Agarwal, Lama Ahmad, Ilge Akkaya, Florencia Leoni Aleman, Diogo Almeida, Janko Altenschmidt, Sam Altman, Shyamal Anadkat, et al. Gpt-4 technical report. arXiv preprint arXiv:2303.08774, 2023.   
Armen Aghajanyan, Lili Yu, Alexis Conneau, Wei-Ning Hsu, Karen Hambardzumyan, Susan Zhang, Stephen Roller, Naman Goyal, Omer Levy, and Luke Zettlemoyer. Scaling laws for generative mixed-modal language models. In International Conference on Machine Learning, pp. 265–279. PMLR, 2023.   
Joshua Ainslie, James Lee-Thorp, Michiel de Jong, Yury Zemlyanskiy, Federico Lebron, and Sumit Sanghai. GQA: Training generalized multi-query transformer models from multi-head checkpoints. In Houda Bouamor, Juan Pino, and Kalika Bali (eds.), Proceedings of the 2023 Conference on Empirical Methods in Natural Language Processing, pp. 4895–4901, Singapore, December 2023. Association for Computational Linguistics. doi: 10.18653/v1/ 2023.emnlp-main.298. URL https://aclanthology.org/2023.emnlp-main.298.   
Ebtesam Almazrouei, Hamza Alobeidli, Abdulaziz Alshamsi, Alessandro Cappelli, Ruxandra Cojocaru, Merouane Debbah, ´ Etienne Goffinet, Daniel Hesslow, Julien Launay,´ Quentin Malartic, et al. The falcon series of open language models. arXiv preprint arXiv:2311.16867, 2023.   
Amanda Askell, Yuntao Bai, Anna Chen, Dawn Drain, Deep Ganguli, Tom Henighan, Andy Jones, Nicholas Joseph, Ben Mann, Nova DasSarma, et al. A general language assistant as a laboratory for alignment. arXiv preprint arXiv:2112.00861, 2021.   
Jacob Austin, Augustus Odena, Maxwell Nye, Maarten Bosma, Henryk Michalewski, David Dohan, Ellen Jiang, Carrie Cai, Michael Terry, Quoc Le, and Charles Sutton. Program synthesis with large language models, 2021.   
Jinze Bai, Shuai Bai, Yunfei Chu, Zeyu Cui, Kai Dang, Xiaodong Deng, Yang Fan, Wenbin Ge, Yu Han, Fei Huang, et al. Qwen technical report. arXiv preprint arXiv:2309.16609, 2023.   
Jeanine Banks and Tris Warkentin. Gemma: Introducing new state-of-the-art open models. https://blog.google/technology/developers/gemma-open-models/, 2024. Accessed: date-of-access.   
Xiao Bi, Deli Chen, Guanting Chen, Shanhuang Chen, Damai Dai, Chengqi Deng, Honghui Ding, Kai Dong, Qiushi Du, Zhe Fu, et al. Deepseek llm: Scaling open-source language models with longtermism. arXiv preprint arXiv:2401.02954, 2024.   
Stella Biderman, Kieran Bicheno, and Leo Gao. Datasheet for the pile. arXiv preprint arXiv:2201.07311, 2022.   
bloc97. NTK-Aware Scaled RoPE allows LLaMA models to have extended (8k+) context size without any fine-tuning and minimal perplexity degradation. https://www.reddit.com/r/LocalLLaMA/comments/14lz7j5/ntkaware\_scaled\_ rope\_allows\_llama\_models\_to\_have/, 2023. Accessed: [Insert Date of Access].   
Andrei Z Broder. On the resemblance and containment of documents. In Proceedings. Compression and Complexity of SEQUENCES 1997 (Cat. No. 97TB100171), pp. 21–29. IEEE, 1997.   
Mark Chen, Jerry Tworek, Heewoo Jun, Qiming Yuan, Henrique Ponde de Oliveira Pinto, Jared Kaplan, Harri Edwards, Yuri Burda, Nicholas Joseph, Greg Brockman, et al. Evaluating large language models trained on code. arXiv preprint arXiv:2107.03374, 2021.   
Aakanksha Chowdhery, Sharan Narang, Jacob Devlin, Maarten Bosma, Gaurav Mishra, Adam Roberts, Paul Barham, Hyung Won Chung, Charles Sutton, Sebastian Gehrmann, et al. Palm: Scaling language modeling with pathways. Journal of Machine Learning Research, 24(240):1–113, 2023.

Peter Clark, Isaac Cowhey, Oren Etzioni, Tushar Khot, Ashish Sabharwal, Carissa Schoenick, and Oyvind Tafjord. Think you have solved question answering? try arc, the ai2 reasoning challenge. arXiv preprint arXiv:1803.05457, 2018.   
Karl Cobbe, Vineet Kosaraju, Mohammad Bavarian, Mark Chen, Heewoo Jun, Lukasz Kaiser, Matthias Plappert, Jerry Tworek, Jacob Hilton, Reiichiro Nakano, et al. Training verifiers to solve math word problems. arXiv preprint arXiv:2110.14168, 2021.   
Ganqu Cui, Lifan Yuan, Ning Ding, Guanming Yao, Wei Zhu, Yuan Ni, Guotong Xie, Zhiyuan Liu, and Maosong Sun. Ultrafeedback: Boosting language models with highquality feedback, 2023.   
Nolan Dey, Gurpreet Gosal, Hemant Khachane, William Marshall, Ribhu Pathria, Marvin Tom, Joel Hestness, et al. Cerebras-gpt: Open compute-optimal language models trained on the cerebras wafer-scale cluster. arXiv preprint arXiv:2304.03208, 2023.   
Ning Ding, Yulin Chen, Bokai Xu, Yujia Qin, Zhi Zheng, Shengding Hu, Zhiyuan Liu, Maosong Sun, and Bowen Zhou. Enhancing chat language models by scaling high-quality instructional conversations, 2023.   
Zhengxiao Du, Yujie Qian, Xiao Liu, Ming Ding, Jiezhong Qiu, Zhilin Yang, and Jie Tang. Glm: General language model pretraining with autoregressive blank infilling. arXiv preprint arXiv:2103.10360, 2021.   
Zhengxiao Du, Aohan Zeng, Yuxiao Dong, and Jie Tang. Understanding emergent abilities of language models from the loss perspective. arXiv preprint arXiv:2403.15796, 2024.   
William Fedus, Barret Zoph, and Noam Shazeer. Switch transformers: Scaling to trillion parameter models with simple and efficient sparsity. Journal of Machine Learning Research, 23(120):1–39, 2022.   
Elias Frantar, Saleh Ashkboos, Torsten Hoefler, and Dan Alistarh. GPTQ: accurate posttraining quantization for generative pre-trained transformers. CoRR, abs/2210.17323, 2022. doi: 10.48550/ARXIV.2210.17323. URL https://doi.org/10.48550/arXiv.2210.17323.   
Leo Gao, Stella Biderman, Sid Black, Laurence Golding, Travis Hoppe, Charles Foster, Jason Phang, Horace He, Anish Thite, Noa Nabeshima, et al. The Pile: An 800GB dataset of diverse text for language modeling. arXiv preprint arXiv:2101.00027, 2020.   
Team Gemini, Rohan Anil, Sebastian Borgeaud, Yonghui Wu, Jean-Baptiste Alayrac, Jiahui Yu, Radu Soricut, Johan Schalkwyk, Andrew M Dai, Anja Hauth, et al. Gemini: a family of highly capable multimodal models. arXiv preprint arXiv:2312.11805, 2023.   
Suriya Gunasekar, Yi Zhang, Jyoti Aneja, Caio Cesar Teodoro Mendes, Allie Del Giorno,´ Sivakanth Gopi, Mojan Javaheripi, Piero Kauffmann, Gustavo de Rosa, Olli Saarikivi, et al. Textbooks are all you need. arXiv preprint arXiv:2306.11644, 2023.   
Dan Hendrycks, Collin Burns, Steven Basart, Andy Zou, Mantas Mazeika, Dawn Song, and Jacob Steinhardt. Measuring massive multitask language understanding. arXiv preprint arXiv:2009.03300, 2020.   
Dan Hendrycks, Collin Burns, Saurav Kadavath, Akul Arora, Steven Basart, Eric Tang, Dawn Song, and Jacob Steinhardt. Measuring mathematical problem solving with the math dataset. arXiv preprint arXiv:2103.03874, 2021.   
Alex Henry, Prudhvi Raj Dachapally, Shubham Shantaram Pawar, and Yuxuan Chen. Querykey normalization for transformers. In Trevor Cohn, Yulan He, and Yang Liu (eds.), Findings of the Association for Computational Linguistics: EMNLP 2020, pp. 4246–4253, Online, November 2020. Association for Computational Linguistics. doi: 10.18653/v1/2020. findings-emnlp.379. URL https://aclanthology.org/2020.findings-emnlp.379.

Jordan Hoffmann, Sebastian Borgeaud, Arthur Mensch, Elena Buchatskaya, Trevor Cai, Eliza Rutherford, Diego de Las Casas, Lisa Anne Hendricks, Johannes Welbl, Aidan Clark, et al. Training compute-optimal large language models. arXiv preprint arXiv:2203.15556, 2022.   
Jeremy Howard and Sebastian Ruder. Universal language model fine-tuning for text classification. arXiv preprint arXiv:1801.06146, 2018.   
Shengding Hu, Xin Liu, Xu Han, Xinrong Zhang, Chaoqun He, Weilin Zhao, Yankai Lin, Ning Ding, Zebin Ou, Guoyang Zeng, et al. Unlock predictable scaling from emergent abilities. arXiv preprint arXiv:2310.03262, 2023.   
Yuzhen Huang, Yuzhuo Bai, Zhihao Zhu, Junlei Zhang, Jinghan Zhang, Tangjun Su, Junteng Liu, Chuancheng Lv, Yikai Zhang, Yao Fu, et al. C-eval: A multi-level multi-discipline chinese evaluation suite for foundation models. Advances in Neural Information Processing Systems, 36, 2024.   
Andrew Hundt, Varun Jain, and Gregory D Hager. sharpdarts: Faster and more accurate differentiable architecture search. arXiv preprint arXiv:1903.09900, 2019.   
Mojan Javaheripi and Sebastien Bubeck.´ Phi-2: The surprising power of small language models. https://www.microsoft.com/en-us/research/blog/ phi-2-the-surprising-power-of-small-language-models/, 2023. Accessed: date-ofaccess.   
Albert Q Jiang, Alexandre Sablayrolles, Arthur Mensch, Chris Bamford, Devendra Singh Chaplot, Diego de las Casas, Florian Bressand, Gianna Lengyel, Guillaume Lample, Lucile Saulnier, et al. Mistral 7b. arXiv preprint arXiv:2310.06825, 2023.   
Jared Kaplan, Sam McCandlish, Tom Henighan, Tom B Brown, Benjamin Chess, Rewon Child, Scott Gray, Alec Radford, Jeffrey Wu, and Dario Amodei. Scaling laws for neural language models. arXiv preprint arXiv:2001.08361, 2020.   
Diederik P Kingma and Jimmy Ba. Adam: A method for stochastic optimization. arXiv preprint arXiv:1412.6980, 2014.   
Denis Kocetkov, Raymond Li, Loubna Ben Allal, Jia Li, Chenghao Mou, Carlos Munoz Fer- ˜ randis, Yacine Jernite, Margaret Mitchell, Sean Hughes, Thomas Wolf, Dzmitry Bahdanau, Leandro von Werra, and Harm de Vries. The stack: 3 tb of permissively licensed source code. Preprint, 2022.   
Aran Komatsuzaki, Joan Puigcerver, James Lee-Thorp, Carlos Riquelme Ruiz, Basil Mustafa, Joshua Ainslie, Yi Tay, Mostafa Dehghani, and Neil Houlsby. Sparse upcycling: Training mixture-of-experts from dense checkpoints. arXiv preprint arXiv:2212.05055, 2022.   
Woosuk Kwon, Zhuohan Li, Siyuan Zhuang, Ying Sheng, Lianmin Zheng, Cody Hao Yu, Joseph Gonzalez, Hao Zhang, and Ion Stoica. Efficient memory management for large language model serving with pagedattention. In Proceedings of the 29th Symposium on Operating Systems Principles, pp. 611–626, 2023.   
Haonan Li, Yixuan Zhang, Fajri Koto, Yifei Yang, Hai Zhao, Yeyun Gong, Nan Duan, and Timothy Baldwin. Cmmlu: Measuring massive multitask language understanding in chinese, 2024.   
Raymond Li, Loubna Ben Allal, Yangtian Zi, Niklas Muennighoff, Denis Kocetkov, Chenghao Mou, Marc Marone, Christopher Akiki, Jia Li, Jenny Chim, et al. Starcoder: may the source be with you! arXiv preprint arXiv:2305.06161, 2023a.   
Yuanzhi Li, Sebastien Bubeck, Ronen Eldan, Allie Del Giorno, Suriya Gunasekar, and Yin Tat´ Lee. Textbooks are all you need ii: phi-1.5 technical report. arXiv preprint arXiv:2309.05463, 2023b.

Wing Lian, Guan Wang, Bleys Goodson, Eugene Pentland, Austin Cook, Chanvichet Vong, and ”Teknium”. Slimorca: An open dataset of gpt-4 augmented flan reasoning traces, with verification, 2023a. URL https://https://huggingface.co/Open-Orca/SlimOrca.   
Wing Lian, Guan Wang, Bleys Goodson, Eugene Pentland, Austin Cook, Chanvichet Vong, ”Teknium”, and Nathan Hoos. Slimorca dedup: A deduplicated subset of slimorca, 2023b. URL https://huggingface.co/datasets/Open-Orca/SlimOrca-Dedup/.   
Zechun Liu, Changsheng Zhao, Forrest Iandola, Chen Lai, Yuandong Tian, Igor Fedorov, Yunyang Xiong, Ernie Chang, Yangyang Shi, Raghuraman Krishnamoorthi, et al. Mobilellm: Optimizing sub-billion parameter language models for on-device use cases. arXiv preprint arXiv:2402.14905, 2024.   
Ilya Loshchilov and Frank Hutter. Sgdr: Stochastic gradient descent with warm restarts. arXiv preprint arXiv:1608.03983, 2016.   
Ilya Loshchilov and Frank Hutter. Decoupled weight decay regularization. arXiv preprint arXiv:1711.05101, 2017.   
Bowen Peng, Jeffrey Quesnelle, Honglu Fan, and Enrico Shippole. Yarn: Efficient context window extension of large language models. arXiv preprint arXiv:2309.00071, 2023.   
Jack W Rae, Sebastian Borgeaud, Trevor Cai, Katie Millican, Jordan Hoffmann, Francis Song, John Aslanides, Sarah Henderson, Roman Ring, Susannah Young, et al. Scaling language models: Methods, analysis & insights from training gopher. arXiv preprint arXiv:2112.11446, 2021.   
Rafael Rafailov, Archit Sharma, Eric Mitchell, Christopher D Manning, Stefano Ermon, and Chelsea Finn. Direct preference optimization: Your language model is secretly a reward model. Advances in Neural Information Processing Systems, 36, 2024.   
Colin Raffel, Noam Shazeer, Adam Roberts, Katherine Lee, Sharan Narang, Michael Matena, Yanqi Zhou, Wei Li, and Peter J. Liu. Exploring the limits of transfer learning with a unified text-to-text transformer. arXiv e-prints, 2019.   
Colin Raffel, Noam Shazeer, Adam Roberts, Katherine Lee, Sharan Narang, Michael Matena, Yanqi Zhou, Wei Li, and Peter J Liu. Exploring the limits of transfer learning with a unified text-to-text transformer. Journal of machine learning research, 21(140):1–67, 2020.   
Nikhil Sardana and Jonathan Frankle. Beyond chinchilla-optimal: Accounting for inference in language model scaling laws. arXiv preprint arXiv:2401.00448, 2023.   
Rico Sennrich, Barry Haddow, and Alexandra Birch. Neural machine translation of rare words with subword units. In Katrin Erk and Noah A. Smith (eds.), Proceedings of the 54th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pp. 1715–1725, Berlin, Germany, August 2016. Association for Computational Linguistics. doi: 10.18653/v1/P16-1162. URL https://aclanthology.org/P16-1162.   
Weijia Shi, Sewon Min, Maria Lomeli, Chunting Zhou, Margaret Li, Victoria Lin, Noah A Smith, Luke Zettlemoyer, Scott Yih, and Mike Lewis. In-context pretraining: Language modeling beyond document boundaries. arXiv preprint arXiv:2310.10638, 2023.   
Samuel L Smith, Pieter-Jan Kindermans, Chris Ying, and Quoc V Le. Don’t decay the learning rate, increase the batch size. arXiv preprint arXiv:1711.00489, 2017.   
Luca Soldaini, Rodney Kinney, Akshita Bhagia, Dustin Schwenk, David Atkinson, Russell Authur, Ben Bogin, Khyathi Chandu, Jennifer Dumas, Yanai Elazar, Valentin Hofmann, Ananya Harsh Jha, Sachin Kumar, Li Lucy, Xinxi Lyu, Nathan Lambert, Ian Magnusson, Jacob Morrison, Niklas Muennighoff, Aakanksha Naik, Crystal Nam, Matthew E. Peters, Abhilasha Ravichander, Kyle Richardson, Zejiang Shen, Emma Strubell, Nishant Subramani, Oyvind Tafjord, Pete Walsh, Luke Zettlemoyer, Noah A. Smith, Hannaneh Hajishirzi, Iz Beltagy, Dirk Groeneveld, Jesse Dodge, and Kyle Lo. Dolma: An Open Corpus of Three Trillion Tokens for Language Model Pretraining Research. arXiv preprint, 2024. URL https://arxiv.org/abs/2402.00159.

Kaiqiang Song, Xiaoyang Wang, Sangwoo Cho, Xiaoman Pan, and Dong Yu. Zebra: Extending context window with layerwise grouped local-global attention. arXiv preprint arXiv:2312.08618, 2023.   
Mirac Suzgun, Nathan Scales, Nathanael Scharli, Sebastian Gehrmann, Yi Tay, Hyung Won¨ Chung, Aakanksha Chowdhery, Quoc V. Le, Ed H. Chi, Denny Zhou, and Jason Wei. Challenging big-bench tasks and whether chain-of-thought can solve them, 2022.   
LLMFarm team. LLMFarm, 2023a. URL https://github.com/guinmoon/LLMFarm.   
MLC team. MLC-LLM, 2023b. URL https://github.com/mlc-ai/mlc-llm.   
Hugo Touvron, Thibaut Lavril, Gautier Izacard, Xavier Martinet, Marie-Anne Lachaux, Timothee Lacroix, Baptiste Rozi ´ ere, Naman Goyal, Eric Hambro, Faisal Azhar, et al.\` Llama: Open and efficient foundation language models. arXiv preprint arXiv:2302.13971, 2023.   
Lewis Tunstall, Edward Beeching, Nathan Lambert, Nazneen Rajani, Kashif Rasul, Younes Belkada, Shengyi Huang, Leandro von Werra, Clementine Fourrier, Nathan Habib,´ Nathan Sarrazin, Omar Sanseviero, Alexander M. Rush, and Thomas Wolf. Zephyr: Direct distillation of lm alignment, 2023.   
Jason Wei, Maarten Bosma, Vincent Y Zhao, Kelvin Guu, Adams Wei Yu, Brian Lester, Nan Du, Andrew M Dai, and Quoc V Le. Finetuned language models are zero-shot learners. arXiv preprint arXiv:2109.01652, 2021.   
Yuxiang Wei, Zhe Wang, Jiawei Liu, Yifeng Ding, and Lingming Zhang. Magicoder: Source code is all you need. arXiv preprint arXiv:2312.02120, 2023.   
Mitchell Wortsman, Peter J Liu, Lechao Xiao, Katie Everett, Alex Alemi, Ben Adlam, John D Co-Reyes, Izzeddin Gur, Abhishek Kumar, Roman Novak, et al. Small-scale proxies for large-scale transformer training instabilities. arXiv preprint arXiv:2309.14322, 2023.   
Mengzhou Xia, Tianyu Gao, Zhiyuan Zeng, and Danqi Chen. Sheared llama: Accelerating language model pre-training via structured pruning. arXiv preprint arXiv:2310.06694, 2023.   
Sang Michael Xie, Hieu Pham, Xuanyi Dong, Nan Du, Hanxiao Liu, Yifeng Lu, Percy S Liang, Quoc V Le, Tengyu Ma, and Adams Wei Yu. Doremi: Optimizing data mixtures speeds up language model pretraining. Advances in Neural Information Processing Systems, 36, 2024.   
Wenhan Xiong, Jingyu Liu, Igor Molybog, Hejia Zhang, Prajjwal Bhargava, Rui Hou, Louis Martin, Rashi Rungta, Karthik Abinav Sankararaman, Barlas Oguz, et al. Effective long-context scaling of foundation models. arXiv preprint arXiv:2309.16039, 2023.   
Can Xu, Qingfeng Sun, Kai Zheng, Xiubo Geng, Pu Zhao, Jiazhan Feng, Chongyang Tao, and Daxin Jiang. Wizardlm: Empowering large language models to follow complex instructions. arXiv preprint arXiv:2304.12244, 2023.   
Greg Yang, Edward J Hu, Igor Babuschkin, Szymon Sidor, Xiaodong Liu, David Farhi, Nick Ryder, Jakub Pachocki, Weizhu Chen, and Jianfeng Gao. Tensor programs v: Tuning large neural networks via zero-shot hyperparameter transfer. arXiv preprint arXiv:2203.03466, 2022.   
Greg Yang, Dingli Yu, Chen Zhu, and Soufiane Hayou. Tensor programs vi: Feature learning in infinite-depth neural networks. arXiv preprint arXiv:2310.02244, 2023.   
Jiasheng Ye, Peiju Liu, Tianxiang Sun, Yunhua Zhou, Jun Zhan, and Xipeng Qiu. Data mixing laws: Optimizing data mixtures by predicting language modeling performance. arXiv preprint arXiv:2403.16952, 2024.   
Alex Young, Bei Chen, Chao Li, Chengen Huang, Ge Zhang, Guanwei Zhang, Heng Li, Jiangcheng Zhu, Jianqun Chen, Jing Chang, et al. Yi: Open foundation models by 01. ai. arXiv preprint arXiv:2403.04652, 2024.

Rowan Zellers, Ari Holtzman, Yonatan Bisk, Ali Farhadi, and Yejin Choi. Hellaswag: Can a machine really finish your sentence? arXiv preprint arXiv:1905.07830, 2019.   
Peiyuan Zhang, Guangtao Zeng, Tianduo Wang, and Wei Lu. Tinyllama: An open-source small language model. arXiv preprint arXiv:2401.02385, 2024a.   
Shengyu Zhang, Linfeng Dong, Xiaoya Li, Sen Zhang, Xiaofei Sun, Shuhe Wang, Jiwei Li, Runyi Hu, Tianwei Zhang, Fei Wu, et al. Instruction tuning for large language models: A survey. arXiv preprint arXiv:2308.10792, 2023.   
Xinrong Zhang, Yingfa Chen, Shengding Hu, Zihang Xu, Junhao Chen, Moo Khai Hao, Xu Han, Zhen Leng Thai, Shuo Wang, Zhiyuan Liu, et al. ∞bench: Extending long context evaluation beyond 100k tokens. arXiv preprint arXiv:2402.13718, 2024b.   
Lianmin Zheng, Wei-Lin Chiang, Ying Sheng, Siyuan Zhuang, Zhanghao Wu, Yonghao Zhuang, Zi Lin, Zhuohan Li, Dacheng Li, Eric Xing, et al. Judging llm-as-a-judge with mt-bench and chatbot arena. Advances in Neural Information Processing Systems, 36, 2024.

# A Additional Results in Model Wind Tunnel Experiments

# A.1 µP hyper-parameter search

We conduct an extensive Bayesian search over a set of predefined parametric spaces. For effi ciency, we search for the $N \dot { = } 0 . 0 0 9 B$ model. In our pilot experiments, we confirm that when hyper-parameter optimization is conducted using datasets scaled at magnitudes of 10N and 20N, there is a consistency observed in the efficacy of hyper-parameters. Therefore, we train the models with $| D | = 1 \dot { 0 } N = 0 . 0 9 B$ tokens. Meanwhile, we also try QK-Norm (Henry et al., 2020) and independent weight decay (Loshchilov & Hutter, 2017) as well to stabilize the learning rate. The overall results are shown in Figure 14. After applying the QK-norm, we observe a significant decrease in the learning rate sensitivity similar to Wortsman et al. (2023). However, as the MiniCPM project itself is an SLM, we do not require low learning rate sensitivity as long as we find the best learning rate with TensorProgram (Yang et al., 2022; 2023). Therefore, we do not introduce QK-norm and independent weight decay in later experiments of MiniCPM. In Figure 14, we identify the best hyper-parameters for scale depth = 1.4, scale emb = 12, init std = 0.1, and $l r = \mathrm { \dot { 0 } } . 0 1$ .

![](images/7682e0054e89abf64a4ec0a347ce764a0357ae607dc8c06ab6fb4a78fb08ebc5.jpg)

<details>
<summary>scatter</summary>

| scale_depth | scale_romb | init_std | loss | loss |
| ----------- | ---------- | -------- | ---- | ---- |
| 1.0         | 2.5        | 0.025    | 7.0  | 5.0  |
| 2.0         | 5.0        | 0.050    | 6.5  | 5.5  |
| 3.0         | 7.5        | 0.075    | 6.0  | 5.0  |
| 4.0         | 10.0       | 0.100    | 5.5  | 5.0  |
| 5.0         | 12.5       | 0.125    | 5.0  | 5.0  |
| 6.0         | 15.0       | 0.150    | 5.0  | 5.0  |
| 7.0         | 17.5       | 0.175    | 5.0  | 5.0  |
| 8.0         | 20.0       | 0.200    | 5.0  | 5.0  |
</details>

Figure 14: Grid search over the µP parameterization spaces.

<table><tr><td>Name</td><td>Specific Operation</td></tr><tr><td>Embedding Output Scaling</td><td>Multiply the output of the embedding by scale_emb</td></tr><tr><td>Residual Connection Scaling</td><td>Scale the output tensor of a block before adding to each residual connection in each layer by scale_depth/√num_layers</td></tr><tr><td>Initialization of Tensors</td><td>Set the initialization standard deviation of each two-dimensional tensor parameter to init_std/√dm/dbase, and set other parameters&#x27; initialization to 0.1</td></tr><tr><td>Learning Rate Scaling of Tensors</td><td>Adjust the learning rate of each two-dimensional tensor parameter to 1/(dm/dbase) times the learning rate of other parts (or the overall learning rate)</td></tr><tr><td>LM Head Scaling</td><td>Adjust the output logits to 1/(dm/dbase) times the original value</td></tr></table>

Table 7: List of operations used when applying tensor program techniques.

# A.2 Comment on Optimal Batchsize

In Kaplan et al. (2020), OpenAI studies the relationship between the loss function and the number of tokens. In their experiments, they assume that consuming more steps is equivalent to consuming more time. Under this assumption, OpenAI defines a critical batch size that achieves a certain loss without consuming too many steps or tokens. This rationale is valid if the experiments are provided with unlimited GPUs (at least within the scope of the experiments). Since GPUs are unlimited, enlarging batch size will not increase the single-step duration but will decrease the total number of steps. However, in our experiment, since we have a fixed resource (number of GPUs), we observe that doubling the batch size almost equals doubling the single-step time. Therefore, enlarging batch size to decrease total training steps has minimal effect on the total training time. In light of this observation, we drop the goal of “not consuming too many steps” and turn towards minimizing the token quantity to achieve the lowest loss, instead.

The observation regarding the estimation of optimal batch size in relation to loss resembles the ”Chicken-and-egg” paradox. Practically, there’s often a preliminary estimate of the achievable loss for a given model size, informed by prior knowledge of preliminary experiments. However, there is potential for the development of more refined estimation procedures in the future.

The optimal batch size and optimal learning rate are likely to be not independent. To overcome this correlation, we do a preliminary study on the learning rate first, then choose an optimal learning rate to do a batch size experiment, and use batch size scaling to do the learning rate again. This is a bit like the Coordinate Descent optimization method. However, more rigorous methods are welcomed in future work.

# A.3 Model Architecture in Model Wind Tunnel Experiments

We list the model configuration used in the model wind tunnel experiments in Table 8. The “shape” of the model, i.e., model width compared to model depth is kept as similar as possible to avoid any potential performance variation.

<table><tr><td>Name</td><td>N (B)</td><td> $d_m$ </td><td> $d_{ff}$ </td><td> $d_h$ </td><td> $n_h$ </td><td>L</td></tr><tr><td>9M</td><td>0.009</td><td>320</td><td>800</td><td>64</td><td>5</td><td>8</td></tr><tr><td>30M</td><td>0.036</td><td>512</td><td>1280</td><td>64</td><td>8</td><td>12</td></tr><tr><td>70M</td><td>0.066</td><td>640</td><td>1600</td><td>64</td><td>10</td><td>14</td></tr><tr><td>0.1B</td><td>0.109</td><td>768</td><td>1920</td><td>64</td><td>12</td><td>16</td></tr><tr><td>0.17B</td><td>0.166</td><td>896</td><td>2240</td><td>64</td><td>14</td><td>18</td></tr><tr><td>0.2B</td><td>0.241</td><td>1024</td><td>2560</td><td>64</td><td>16</td><td>20</td></tr><tr><td>0.5B</td><td>0.499</td><td>1344</td><td>3360</td><td>64</td><td>21</td><td>24</td></tr></table>

Table 8: Model configurations and training configurations of the models in the scaling curve. N(B) represents the number of non-embedding parameters of the models, measured in billions.

# B Additional Illustration on WSD LRS

# B.1 Learning Rate Paradigm for Different LRSs

In this paper, we describe three kinds of LRSs, Cosine(T), CosineLoop(T), and WSD(T, D). Cosine and Cosine Loop take the form of the following:

An illustrative learning rate diagram for WSD and Cosine Scheduler is shown in Figure 15.

$$
\operatorname{Cosine} (T; s) =
$$

$$
\left\{ \begin{array}{l l} & \frac {s}{W} \eta , \quad s <   W \\ & 0. 9 \eta \cos (\pi \frac {s}{T}) + 0. 1 \eta , \quad W <   s <   T \\ & 0. 1 \eta , \quad s > T \end{array} \right.
$$

$$
\text { CosineLoop } (T; s) =
$$

$$
\left\{ \begin{array}{l l} & \frac {s}{W} \eta , \quad s <   W \\ & 0. 9 \eta c o s (\pi \frac {s}{T}) + 0. 1 \eta , \quad W <   s \end{array} \right.
$$

![](images/1928a6cb7bd26ee91ec3f99f8025f4a04528b61b75a25e4e8a0d880b1e4f0059.jpg)

<details>
<summary>line</summary>

| Iteration | Cosine(40N) | WSD(40N,4N) | WSD(80N,8N) |
| --------- | ----------- | ----------- | ----------- |
| 0         | 0.0200      | 0.0200      | 0.0200      |
| 2000      | 0.0150      | 0.0200      | 0.0200      |
| 4000      | 0.0050      | 0.0200      | 0.0200      |
| 6000      | 0.0025      | 0.0025      | 0.0200      |
| 8000      | 0.0025      | 0.0025      | 0.0200      |
| 10000     | 0.0025      | 0.0025      | 0.0025      |
</details>

![](images/0b84c2157c689d4d9a77a81fce33f87cff9d54b758e3bffafeb039ce5ede10cd.jpg)

<details>
<summary>line</summary>

| Compute (×10^15) | Loss (L = 0.980 - (C * 10^-17)^(-0.543) + 3.274) | Loss (L = 0.880 - e^(-0.284 * 10^-14) + 3.472) |
|---|---|---|
| 0.0 | 4.05 | 4.05 |
| 0.25 | 3.82 | 3.82 |
| 0.5 | 3.70 | 3.70 |
| 0.75 | 3.62 | 3.62 |
| 1.0 | 3.55 | 3.55 |
| 1.5 | 3.50 | 3.50 |
| 2.0 | 3.48 | 3.48 |
| 2.5 | 3.47 | 3.47 |
</details>

Figure 15: Illustrative comparison be-Figure 16: We use two different function tween Cosine LRS and WSD LRS. The forms to fit the data scaling law achieved WSD LRS with different end steps share by WSD LRS and choose power law as the same stable training stage. the best fit.

# B.2 Fitting the Data Scaling Law

In this section, we describe the fitted data scaling law for continue training with WSD LRS. Each point in Figure 16 is the end of the decay stage in WSD LRS with a different end step. We try two function forms: exponential and polynomial. The fitted result shows that the polynomial scaling law is still the best for continue training.

# B.3 Individual Figure for Model-Data Scaling Law

For each task and model, the scaling law L(N, D)’s fitness with real loss values along the data axis is plotted in Figure 17.

# B.4 Analysis of Llama2’s Data-to-Model Ratio

As mentioned in Section 4.5, we analyze Llama2’s Data-to-Model Ratio based on their training loss curve. The extracted loss is plotted on the left of Figure 18. We convert the x-axis to computation Flops to compare the computed optimal regime on the right part of the Figure.

# C MiniCPM’s Vocabulary

Despite being small in parameter size, MiniCPM targets modeling diverse data distribution, excelling in English and Chinese. Therefore, our vocabulary is relatively large. For the 2.4B model, we use a tokenizer consisting of 122,753 tokens (denoted by MiniCPMTokenizer-120K). This vocabulary is constructed from extensive and diverse language data, utilizing the sentencepiece library 4 for Byte Pair Encoding (BPE) (Sennrich et al., 2016), and includes special symbols like traditional Chinese characters, rare characters, emojis, and special symbols such as Greek letters, Cyrillic letters, etc.

For the SLM, the embedding parameters will take up a lot of parameter space if the vocabu lary is large. Therefore, for our 1.2B model, we use a smaller vocab MiniCPMTokenizer-70K.

![](images/0bd0df776a13cd6ce584b039277abbc73b91e69bb42e9fc16bdf7d9a2b07d1b8.jpg)

Figure 17: The fitted scaling law plotted along the data amount axis for each model and each task. The fitted result is satisfying except for the last checkpoints of the 0.11B and 0.25B model.   
![](images/3cc5816ccc0569768d71a5a9f65be7b72006da5edd91b3e803b1c538f7b626a6.jpg)

<details>
<summary>line</summary>

| Token (B) | 7B    | 13B   | 3dB   | 7dB   |
| --------- | ----- | ----- | ----- | ----- |
| 0         | 2.2   | 2.2   | 2.2   | 2.2   |
| 250       | 1.9   | 1.85  | 1.8   | 1.75  |
| 500       | 1.85  | 1.8   | 1.75  | 1.7   |
| 750       | 1.8   | 1.75  | 1.7   | 1.65  |
| 1000      | 1.75  | 1.7   | 1.65  | 1.6   |
| 1250      | 1.7   | 1.65  | 1.6   | 1.55  |
| 1500      | 1.65  | 1.6   | 1.55  | 1.5   |
| 1750      | 1.6   | 1.55  | 1.5   | 1.45  |
| 2000      | 1.55  | 1.5   | 1.45  | 1.4   |
</details>

![](images/0c03c310c62b734ac1a67fea8bf3e53c7d90f3906d8b505cbcd39a2c46a50aab.jpg)

<details>
<summary>line</summary>

| Compute (10^6 FLOPs) | 7B    | 13B   | 34B   | 74B   |
| --------------------- | ----- | ----- | ----- | ----- |
| 10^4                  | 2.2   | 2.1   | 2.0   | 1.9   |
| 10^5                  | 1.7   | 1.6   | 1.5   | 1.4   |
| 10^6                  | 1.5   | 1.4   | 1.3   | 1.2   |
</details>

Figure 18: We extract the training loss data from Llama2 paper (left part) and estimate the compute optima l DoptN in their paper using the right part. The straight lines are plotted to $\frac { D _ { o p t } } { N _ { o p t } }$ opt estimate the optimal loss envelope assuming using WSD Scheduler.

Compared to the MiniCPMTokenizer-120K tokenizer, we have re-trained the tokenization on the same documents, while setting the max number of vocabs to 64,000. For the special characters, we only add the traditional Chinese characters, emojis, and special symbols, but leave out the rare characters in Chinese.

We conduct evaluations on 300,000 documents in Chinese, English, code, and academic papers that are not in the training set of the Tokenizer. The MiniCPM-120K tokenizer achieves the highest compression ratio (Bytes/Tokens).

<table><tr><td></td><td>Baichuan2</td><td>ChatGLM2</td><td>Llama2</td><td>MiniCPM-120K</td><td>MiniCPM-70K</td></tr><tr><td>Vocab Size</td><td>125,696</td><td>64,794</td><td>32,000</td><td>122,753</td><td>73,440</td></tr><tr><td colspan="6">Compression Rate (Bytes/Tokens)</td></tr><tr><td>Chinese</td><td>3.64</td><td>3.54</td><td>1.87</td><td>3.73</td><td>3.56</td></tr><tr><td>English</td><td>4.12</td><td>4.02</td><td>3.78</td><td>4.14</td><td>4.02</td></tr><tr><td>Code</td><td>2.71</td><td>2.71</td><td>2.74</td><td>2.81</td><td>2.76</td></tr><tr><td>Paper</td><td>2.74</td><td>2.88</td><td>2.97</td><td>2.93</td><td>2.88</td></tr><tr><td>Average</td><td>3.30</td><td>3.29</td><td>2.84</td><td>3.40</td><td>3.31</td></tr></table>

Table 9: Compression ratio comparison.

# D Quantization

We conduct 4-bit quantization on our model. We do not quantize the parameters of embedding and layer normalization, since the performance of the model is sensitive to these parameters. Therefore, we only need to quantify each weight matrix. Denote the weight matrix as $\pmb { W } \in \mathbb { R } ^ { d _ { o u t } \times d _ { i n } }$ . We group every G consecutive parameter at the $d _ { i n }$ dimension and form $d _ { i n } / G$ group. Then we quantize each group of the parameters separately. For each group parameter $\mathbf { w } ,$ we calculate the quantization scale and zero point as follows:

$$
\text { scale } = \frac {\max (\mathbf {w}) - \min (\mathbf {w})}{2 ^ {4} - 1}, \text { zero } = - \frac {\min (\mathbf {w})}{\text { scale }} - 2 ^ {3}.
$$

Group parameter w are then quantized to

$$
\hat {w} = \text { quant } (w) = \text { round } (\frac {w}{\text { scale }} + \text { zero }),
$$

where round operation round a floating point to nearest integer. The dequantization opera tion is approximately the reverse of the quantization method, which is

$$
\operatorname{dequant} (\hat {w}) = \operatorname{scale} (\hat {w} - \text { zero }).
$$

Finally, matrix $\pmb { W } \in \mathbb { R } ^ { d _ { o u t } \times d _ { i n } }$ is quantized to int4 $\hat { \mathbf { W } } \in \mathbb { R } ^ { d _ { o u t } \times d _ { i n } }$ , float scale $\in \mathbb { R } ^ { d _ { o u t } \times \frac { d _ { i n } } { G } }$ and float zero $\in \mathbb { R } ^ { d _ { o u t } \times \frac { d _ { i n } } { G } }$ .

To reduce the quantization loss, we adopt GPTQ (Frantar et al., 2022) to apply weight calibration. We sample calibration data X from a similar distribution of SFT data. The quantization objective is to minimize the disturbance of the quantization $\| \mathbf { W } \pmb { \mathrm { X } } - d e q u a n t ( \hat { \mathbf { W } } ) \pmb { \mathrm { X } } \| _ { 2 } ^ { 2 }$ . We follow GPTQ to quantize weight iteratively and update the remaining non-quantized weight by

$$
\delta_ {F} = - \frac {w _ {q} - d e q u a n t (q u a n t (w _ {q}))}{[ H _ {F} ^ {- 1} ] _ {q q}} \cdot (H _ {F} ^ {- 1}) _ {:, q},
$$

where q is the quantization position in the current iteration while F denotes the remaining non-quantized weights. $H _ { F }$ is the hessian matrix of the objective function.

<table><tr><td>SmartPhone</td><td>Operating System</td><td>Processor</td><td>Phone Memory (GB)</td><td>Inference Throughput (token/s)</td></tr><tr><td>OPPO Find N3</td><td>Android 13</td><td>snapdragon 8 Gen2</td><td>12</td><td>6.5</td></tr><tr><td>Samsung S23 Ultra</td><td>Android 14</td><td>snapdragon 8 Gen2</td><td>12</td><td>6.4</td></tr><tr><td>Meizu M182Q</td><td>Android 11</td><td>snapdragon 888Plus</td><td>8</td><td>3.7</td></tr><tr><td>Xiaomi 12 Pro</td><td>Android 13</td><td>snapdragon 8 Gen1</td><td>8+3</td><td>3.7</td></tr><tr><td>Xiaomi Redmi K40</td><td>Android 11</td><td>snapdragon 870</td><td>8</td><td>3.5</td></tr><tr><td>Oneplus LE 2100</td><td>Android 13</td><td>snapdragon 870</td><td>12</td><td>3.5</td></tr><tr><td>Oneplus HD1900</td><td>Android 11</td><td>snapdragon 865</td><td>8</td><td>3.2</td></tr><tr><td>Oneplus HD1900</td><td>Android 11</td><td>snapdragon 855</td><td>8</td><td>3.0</td></tr><tr><td>Oneplus HD1905</td><td>Android 10</td><td>snapdragon 855</td><td>8</td><td>3.0</td></tr><tr><td>Oneplus HD1900</td><td>Android 11</td><td>snapdragon 855</td><td>8</td><td>3.0</td></tr><tr><td>Xiaomi MI 8</td><td>Android 9</td><td>snapdragon 845</td><td>6</td><td>2.3</td></tr><tr><td>Huawei Nova 11SE</td><td>Harmony 4.0.0</td><td>snapdragon 778</td><td>12</td><td>1.9</td></tr><tr><td>Xiaomi MIX 2</td><td>Android 9</td><td>snapdragon 835</td><td>6</td><td>1.3</td></tr><tr><td>iPhone 15 Pro</td><td>iOS 17.2.1</td><td>A17 pro</td><td>8</td><td>18.0</td></tr><tr><td>iPhone 15</td><td>iOS 17.2.1</td><td>A16</td><td>6</td><td>15.0</td></tr><tr><td>iPhone 12 Pro</td><td>iOS 16.5.1</td><td>A14</td><td>6</td><td>5.8</td></tr><tr><td>iPhone 12</td><td>iOS 17.2.1</td><td>A14</td><td>4</td><td>5.8</td></tr><tr><td>iPhone 11</td><td>iOS 16.6</td><td>A13</td><td>4</td><td>4.6</td></tr></table>

Table 10: Speed of MiniCPM-2.4B on different end devices.

# E Edge Device Benchmarking

After Int4 quantization in Appendix D, MiniCPM-2.4B’s footprint is reduced to 2GB, facilitating deployment on mobile edge devices. We adapted the model for Android and HarmonyOS using MLC-LLM (team, 2023b) and employed LLMFarm (team, 2023a) for adaptation to the iPhone system. This adaptation was tested on various edge mobile devices.

It is important to emphasize that our efforts did not focus on optimization for mobile deployment, but rather on demonstrating the practicality of MiniCPM’s inference capabilities on mobile platforms. We encourage further optimization and updates by the developer community to enhance the performance of large models like MiniCPM in mobile contexts.

The result is shown in Table 10, we can see that on the most advanced smartphone iPhone 15 Pro, the inference throughput is as high as 18 tokens per second. In other devices, the inference throughput is also acceptable.

# F Case Demonstration

A notable feature distinguishing the MiniCPM series from other robust SLMs like Phi (Li et al., 2023b) by Microsoft is that we train MiniCPM on general-purpose corpora, which guarantees the models’ versatility and generalization across a variety of tasks. In this section, we present several intriguing generation instances, typically achievable only by larger models, to demonstrate the capabilities of MiniCPM. Although we do not conduct extensive checks on whether specific cases exist in the training set, due to the diverse ways they can be expressed, we ensure that no data similar to the test cases is intentionally added.

# Translation

Prompt: Translate this sentence into French: ”I am a freshman on Chinese, do you know how this sentence is translated: 何 Python创建一个 单的网 ？” (How to create a simple web crawler in Python?)

# MiniCPM-1.2B:

Je suis un homme nouveau en chinois, vous etes-vousˆ au courant de la maniere dont cette phrase est traduite :\` Comment creer un petit scraper web simple ´ a Python ?\`

# MiniCPM-2.4B-DPO:

Je suis un nouveau-ne en chinois, sais-tu comment on cr´ ee´ un simple web crawler en Python ? Translation: ”Je suis un nouveau-ne en chinois, sais-tu comment on cr ´ ee un ´ simple web crawler en Python ?”

Figure 19: Examples on translation. We notice that MiniCPM-2.4B-DPO performs better in translating the technical part, but both models are unnatural in expressing ”just starting to learn Chinese.”. However, both models successfully understand the instruction with traps and generate French despite we do not include French corpus intentionally.

# Math and Reasoning

Prompt: 果以下 中减号均表示加号，而加号实际上是减号，给出 的计 结果15-25-12+34=

(If in the following equation, minus signs represent addition, and plus signs represent subtraction, give the result of the calculation: 15-25-12+34=)

# MiniCPM-1.2B:

果减号表示加号，那么 们可以 改写为：15 + 25如+ 12 - 34

首先计 前两个数的和：15 + 25 = 40

算然后计 前三个数的和：40 + 12 = 52

算最后计 最后一个数减去前三个数的和：52 - 34 = 18

以， 的计 结果为18。

所 算式 算(If the minus sign represents a plus sign, then we canrewrite the equation as: 15 + 25 + 12 - 34.

First, calculate the sum of the first two numbers: 15 + 25 = 40.

Then, calculate the sum of the first three numbers: 40 + 12 = 52.

Finally, calculate the difference between the last number and the sum of the first three numbers: 52 - 34 = 18.

Therefore, the result of the equation is 18.)

# MiniCPM-2.4B-DPO:

果减号均表示加号，而加号实际上是减号，那么 可如以 新表示为：

重15+25+12-34

现在 们可以按照加减法的 序进行计 ：

我 顺(15+25)+12-34=40+12-34=52-34=18

以，最终的计 结果是18。

所 算(If minus signs all represent addition, and plus signs actually represent subtraction, then the equation can be re-expressed as:

15+25+12-34.

Now we can calculate according to the order of addition and subtraction:

(15+25)+12-34 = 40+12-34 = 52-34 = 18

So, the final result of the calculation is 18.)

Figure 20: Examples on math and reasoning. Both models are successful in symbolic substitution and math calculation.

# Instruction Following

Prompt: 写藏 诗，藏 是龙年 吉

(Writing an acrostic poem, with the hidden message ”Good luck in the Year of the Dragon.”)

# MiniCPM-1.2B:

龙池春水涨，

凤阙日初长。

吉庆何时 ，

至平有 藏。

太 象(The spring water in the dragon’s pool rises,

The sun rises at the phoenix gate.

When will good fortune arrive,

Peace and prosperity are hidden in signs.)

# MiniCPM-2.4B-DPO:

龙 万 气 ，

腾 里 如虹年 新来乐事浓。

岁吉良辰堪共赏，

大吉祥 意 红。

如 笑颜(Dragons soar for thousands of miles, their energy like a rainbow,

As the new year begins, joyous occasions abound.

Auspicious days are worth enjoying together,

Good fortune and happiness bring rosy smiles.)

Figure 21: Examples on instruction following. MiniCPM-2.4B-DPO successfully follows the instructions and generates a poem with the correct tonal pattern and the first character of each sentence. However, MiniCPM-1.2B only generates the correct tonal pattern.

# Emoji

Prompt: 请给 一个json， 个key是一个emoji， 个value是这个emoji对应的意思，给出10个左右

(Please give me a JSON object where each key is an emoji and each value is the meaning of that emoji, providing around 10 examples.)

# MiniCPM-1.2B:

然可以，这是一 个包含10个左右emoji及其含义当的JSON：

![](images/b593f196491be241550a711cbbcdc0cb1df1fd1700d4b0799e7d6b7201db1b0e.jpg)

”: ” 容”,

![](images/2b08a68aca91aa0cd1f330d09126ee3b121c17c92fa0f3c062b96306f7202a32.jpg)

” ”: ” ”,

![](images/d111987439b308485c2b6b93e40f232f09e70735d491b1b216aac5f43b1fa8f1.jpg)

”: ”惊叹”,

![](images/7f6593b851e1e78685d583413dfbce91dabc691cd02d114d41ebee32cce99019.jpg)

”: ”亲吻”,

![](images/4473276952c4812dbf062d9cb2da24df2f1a9dcba19aa2585e750626acf95fdb.jpg)

”: ”恶作剧”,

![](images/d90c60d1b6e3ec4a11753dae038360710280aba983d300403eab6f1d28935365.jpg)

”: ” 望”,

![](images/d0a90e0caa0abf7393a4e793d8387cf0cb9267b8593717da824787580c6014fb.jpg)

”:”思考”,

![](images/71e47c99a10afd43d178f8fd2bd0cc48716a9a3d174c8d0c0c7095d4104a3f94.jpg)

,M ”: ” 钱”,

![](images/e0f416de012250339d53e7dcb449a12ffd085bb0f0286aa4b5f0b550f4013500.jpg)

” ”: ”帮助”,

![](images/42d1007e03c31a829ae9ef8dc184b1a94834ba6cd44efde6c865a8d2646de0b5.jpg)

”: ”废 ”

希望这个 对你有帮助！

(Of course, this is a JSON file containing around 10 emojis and their meanings:

![](images/8101e1677ed4b849f65a39b5fdf252248d96d325ed3fd9ae2a01b153fd89342e.jpg)

”: ”smiling”,

![](images/50ab08796c6d9cd9428de5e12da4ea8f3b17fdeafe0c9e2688066559be3b8c5b.jpg)

”: ”laughing”,

![](images/a73fc1e40f53f0b01576a93c7e52a1f26a81b97e3e8fe9bfa301829efc2c0761.jpg)

”: ”amazing”,

![](images/f167598284daa2748a73497f0d6a47775ff29145be80764b4eb3a0a803b7ac47.jpg)

”: ”kissing”,

![](images/b6b64d865d349d083dd823fdd858e9c81390bd0b0fb206c57ad56b85dbe6343f.jpg)

”: ”mischief”,

![](images/b712ab087038a8f8fd9bcec8b193d5f2a5845011cc2f88ad7d294e8ac94f311e.jpg)

”: ”disappointment”,

![](images/a050cf15762eb0af8043ef8947b83aadc946c9d4bb568cf1377f0353d9405f02.jpg)

”:”thinking”,

![](images/8267fd6ff497d71ebde89ba23215fc902316484795a214fce708579f2ae95671.jpg)

”: ”money”,

![](images/3dd75e249d04fec97de7a16594bb51ae23d80ba0730b7931451b5d89bdd7642e.jpg)

”: ”help”,

![](images/f7a191b61a0f4954ec4af4bd12ca42520d7803c53c9ec1320f3c5dfaeee98537.jpg)

”rubbish”

Hope you found this JSON useful!)

# MiniCPM-2.4B-DPO:

然可以！以 下是一 个包含10个emoi及其对应意义当的JSON对 ：

![](images/71e5d10adca58f5f59be00525d9ba3fda6e8e7ccef5bfb1bfacd84ba0f8db282.jpg)

表示愉 满意，通常 于表达 和喜悦。

![](images/eff96df8e556812c33a6474f79f31b5e155cc341228f549fd24962f5b3ba4dc6.jpg)

”: ”表示愤怒 不满，通常 于表达情绪的激动。”,

![](images/a57ef9dd59d95d64811b437b254ea3550c562982cbf399a9d1ef5848e6e07388.jpg)

表示 ，通常 于表达 声和 乐。

![](images/943b9fbdd2c548e0be0c6eab67d62ac0a7f441d36e1fb0a48b00a105b91b58cf.jpg)

”: ”表示 ，通常 于表达 的场景情况。”,

![](images/f3dc480df244d2d4fd1615db40802fb666b0810434994dce6cdc2849e82c1a1a.jpg)

”: ”表示惊讶 震惊，通常 于表达对某个事件 情烈反应。”,

![](images/820be14fc81739a36098af49aad096b676ded8ea4f140377c24b01645dc7343f.jpg)

”: ”表示 望 沮丧，通常 于表达对某事 某人失 或趣 信 的情绪。”,

![](images/d34b76a75c4e504b311d3c251276f0fad573bf0654d7b6bd19876f1a22fc8477.jpg)

”:”表示 伤 ，通常 于表达对某事 某人造心痛或的 烈感受。

![](images/d55c540f39a297f7c5e96d168efef8414fd0e654d0322316c5f392e124a92f36.jpg)

”: ”表示惊喜 兴 ，通常 于表达对某事 某人的或发现的情绪。”,

![](images/6024728e13959ea807e5236fe3da2ffe408dcbde9bda7b3f679bccfd6275363c.jpg)

”: ”表示 时 ，通常 于表达 信、 和潮流度。”,

![](images/a4729857efc37fb364d087233c81567583eac0686f85820a1f1f12e6a7a1d1d4.jpg)

”: ”表示喜 赏，通常 于表达对某 某人的之情。”

这个 对 能满足您的需求！ 果您有任何问象请随时告诉 。

题 我(Of course! Here is a JSON object containing 10 emojis and their corresponding meanings:

![](images/dd16ae5c0ef5eb85ec920ad8f7a04a84ba335ce4be3353c100bb1206f7989c0d.jpg)

”: ”It means happy or satisfied, typically used to exs smiling and joy.”,

![](images/1f05a610ba7deeb56daf33abbc66caf317937bb3f858c0b0b315854fb6a3667c.jpg)

”: ”It means anger or dissatisfaction, typically used to ress intense emotions.”,

![](images/c7efef9619e330270ff0df91cbc14875495cd99d610ee19e731d3a65527efd39.jpg)

”: ”It means laughing or happy, typically used to exs laughter and joy.”,

![](images/ebbf3360058d389658e23792381755f1c8fb8624c30201d53fae3e22b86073e5.jpg)

”: ”It means funny or awkward, typically used to exs humorous situations or awkwardness.”,

![](images/010e51c5a14d65da9001eb4fc4f294d9d5333eea2ea489ca31f35ac1de5dce0a.jpg)

”: ”It means surprise or shock, typically used to exs a strong reaction to an event or situation.”,

![](images/12957159764bfb91a1266d24e22a77c58d366c8a681e14b16b606bf9a0096e49.jpg)

”: ”It means disappointment or discouragement, typ y used to express a loss of interest or confidence in ething or someone.”,

![](images/835861aef21cd35294ba968dc4d6a705c2f65becbbb0a26dedd611d226819390.jpg)

”: ”It means heartache or sadness, typically used to ress intense feelings of pain caused by something or eone.”,

![](images/34af78b343b1c54dfde0ac1749a97da92096b0350c3b5a93947d70f2642c44e8.jpg)

”: ”It means surprise or excitement, typically used to ess the emotion of discovery or finding something or eone.”,

![](images/210c23e456fbfa5b1a83b14e2d7f3c2b990cefbd3175fdc30d231f935f6cacb2.jpg)

”: ”It means cool or stylish, typically used to express nfident, independent, and trendy attitude.”,

![](images/78297511d4352042d0f6c37172eeca4819a21c77aa3c2484315e353bff2d87d0.jpg)

”: ”It means like or appreciate, typically used to exs affection or admiration for something or someone.”

I hope this JSON object meets your needs! If you have any questions, please feel free to let me know.)

Figure 22: Examples on emoji. Both models understand emojis and structured data well, and accurately control the number of items implicitly. The DPO model tends to generate more words.