---
title: "GLM-4-Voice - MinerU 原始转换(英文)"
source_pdf: pdfs/GLM-4-Voice.pdf
converted_by: "MinerU (hybrid_auto)"
date: "2024-12"
arxiv: "2412.02612"
status: completed
---

# GLM-4-Voice: Towards Intelligent and Human-Like End-to-End Spoken Chatbot

> 🔙 **[返回 14.6-GLM 家族总览](../../14.6-GLM.md)**

Aohan Zeng et al. — Zhipu.AI, Tsinghua University

## Abstract

We introduce GLM-4-Voice, an intelligent and human-like end-to-end spoken chatbot. It supports both Chinese and English, engages in real-time voice conversations, and varies vocal nuances such as emotion, intonation, speech rate, and dialect according to user instructions. GLM-4-Voice uses an ultra-low bitrate (175bps), single-codebook speech tokenizer with 12.5Hz frame rate derived from an automatic speech recognition (ASR) model by incorporating a vector-quantized bottleneck into the encoder. To efficiently transfer knowledge from text to speech modalities, we synthesize speech-text interleaved data from existing text pre-training corpora using a text-to-token model. We continue pre-training from the pre-trained text language model GLM-4-9B with a combination of unsupervised speech data, interleaved speech-text data, and supervised speech-text data, scaling up to 1 trillion tokens, achieving state-of-the-art performance in both speech language modeling and spoken question answering. We then fine-tune the pre-trained model with high-quality conversational speech data, achieving superior performance compared to existing baselines in both conversational ability and speech quality. The open models can be accessed through https://github.com/THUDM/GLM-4-Voice and https://huggingface.co/THUDM/glm-4-voice-9b.

## 1 Introduction

The success of large language models (LLMs) has driven significant advancements in conversational AI, enabling the development of text-based chatbots and digital assistants. However, LLMs are primarily designed to process text input and generate text output, focusing on semantic and logical communication. In contrast, human communication extends beyond semantics, often conveying emotions and subtle nuances. Voice-based interaction, therefore, provides a more natural and intuitive medium for human-computer interaction, offering richer and more engaging user experiences. Traditional spoken chatbot typically rely on a pipeline combining Automatic Speech Recognition (ASR), LLM processing, and Text-to-Speech (TTS) synthesis. While functional, this approach is often hindered by high latency, compounded errors introduced during the ASR and TTS stages, and a limited capacity to capture and express emotional nuances.

Speech-language models (SpeechLMs), which process both speech input and output in an end-toend manner, offer a promising approach for building spoken chatbots. Efforts such as [24, 17] have explored pre-training on speech data in a manner similar to large language models (LLMs). Similarly, Défossez et al. [12] scaled speech data to 7 million hours for model training. However, these approaches face a significant limitation: the relative scarcity of speech data compared to the extensive text corpora available online. This data imbalance makes it challenging to fully leverage the capabilities of text-based LLMs, ultimately constraining the intelligence of SpeechLMs. Other methods aim to align speech and text modalities [15, 42] by integrating a speech encoder and a text-to-speech module into existing LLMs and fine-tuning them on spoken dialogue datasets. While this approach provides a straightforward way to develop speech-to-speech models from LLMs, it lacks the ability to deliver truly human-like speech output due to the absence of dedicated speech pre-training. This limitation hinders these models from capturing the rich nuances and expressiveness inherent in human speech.

In this paper, we introduce GLM-4-Voice, an intelligent and human-like spoken chatbot. We use a single code-book supervised speech tokenizer with 12.5Hz frame rate to efficiently represent speech. A flow-matching-based speech decoder is employed to convert speech tokens into natural-sounding speech. To bridge the gap between text and speech modalities, we conduct large-scale speech-text pre-training using 1 trillion tokens. This includes synthetic interleaved speech-text corpora derived from text pre-training data, as well as unsupervised speech data and supervised speech-text datasets (e.g., ASR and TTS). The resulting base model demonstrates strong performance across various tasks, including speech language modeling, spoken question answering, ASR, and TTS. To further enhance the chatbot’s conversational capabilities, we fine-tune the base model on high-quality conversational datasets using a "streaming thoughts" template. This template alternates between outputting text and speech tokens, improving the model’s ability to generate seamless, low-latency responses while maintaining high-quality performance.

## 2 Related Work

### 2.1 Speech Tokenization

Speech tokenizers, which transform a audio clip into discrete tokens, can be categorized into two directions. The neural acoustic codecs [44, 11, 23, 20] target at reconstructing high-quality audio at low bitrates. The semantic tokens [19, 10] are extracted from speech representations learned with self-supervised learning on speech data. Recently, SpeechTokenizer [48] and Mini [12] unify semantic and acoustic tokens as different residual vector quantization (RVQ) layers, but they also suffer from multiple tokens at the same position, leading to either parallel prediction of semantic and acoustic tokens, or degradation to semantic tokenizers for language models. CosyVoice [14] proposes the supervised semantic tokenizer derived from a speech recognition model, and successfully apply the tokenizer to text-to-speech synthesis. The application of the tokenizer on speech language modeling is not explored.

### 2.2 Speech Language Modeling

Speech language models are autoregressive models pretrained on unsupervised speech data. Lakhotia et al. [24] first proposes generative spoken language modeling (GSLM), which trains the next-token prediction objective on discrete semantic tokens produced by self-supervised learning. AudioLM [5] proposes a hybrid tokenization scheme that combines these semantic tokens with acoustic tokens from a neural audio codec [44]. TWIST [17] trains the speech language model using a warm-start from the pretrained text language model OPT [47]. Moshi [12] scales up the size of natural speech data in TWIST to 7 million hours. Spirit-LM [32] further extends TWIST by adding speech-text interleaving data curated from speech-text parallel corpus. However, the scarcity of speech-text parallel corpus restricts the scale of interleaving data.

### 2.3 End-to-End Spoken Chatbots

Early works in speech-to-speech models mainly focus on processing tasks like speech translation [8, 2]. Since success of ChatGPT in text-based chatbots, many works have explored methods to develop speech-based chatbots that can understand and respond in speech. SpeechGPT [46] proposes to combine existing large language models (LLM) with discrete speech representations to obtain speech conversational abilities. Moshi [12] proposes a full-duplex spoken dialogue framework based on their pretrained speech language model. Qwen-Audio [9] adapts pre-trained textual language models for speech understanding by aligning speech representations of the Whisper [36] encoder. The model can understand speech, but not generate speech. Llama-Omni [15] and Freeze-Omni [41] extend the method by adding a text-to-speech model after the language model to transform the text output to speech output. In this way language models can only control the content of speech, but not the styles and prosodies. Mini-Omni [42] directly fine-tunes language models to generate text and speech responses simultaneously with only instruction datasets. Without speech pre-training, the quality of both text and speech responses is severely limited, as we will show in the experiments.

## 3 Architecture

In this section, we introduce the architecture of GLM-4-Voice. Our goal is to build a human-like, endto-end spoken chatbot with high intelligence. To achieve this, the model must 1) comprehend the user’s speech and provide a semantically accurate response, and 2) follow the user’s spoken instructions, generating speech with paralinguistic features that meet the user’s expectations. Inspired by the successful pre-training and fine-tuning paradigm used in LLMs, we believe that these capabilities for spoken chatbots can be best developed through extensive pre-training on diverse speech corpus, rather than simply fine-tuning existing LLMs with speech question-answering data, as in recent spoken chatbot approaches [15, 42].

To achieve this goal, GLM-4-Voice is designed with minimal modifications to the auto-regressive transformer architecture. For speech tokenization, we utilize a supervised speech tokenizer, which effectively captures semantic information at a ultra-low bitrate (175bps) while maintaining highquality speech reconstruction. Additionally, we adopt a single-codebook approach for speech tokenization, avoiding the complex architectural adjustments often required for multi-layer speech token generation [12, 42]. This approach helps preserve the model’s text processing capabilities while enabling efficient speech modeling. Furthermore, the model employs a unified speech representation for both input and output, enabling next-token prediction for speech data and facilitating efficient pre-training on unsupervised speech corpora.

We use the same speech tokenizer and speech decoder as described in Zeng et al. [45]. To enable low-latency interaction, we adapt the speech decoder to support streaming inference and design a streaming thought template capable of alternating between text and speech tokens during the supervised fine-tuning stage, as detailed in Section 3.3 and Section 3.2.

### 3.1 Speech Tokenizaion

The speech tokenizer converts continuous waveforms into discrete speech tokens, which reserve semantic information and a part of acoustic information. Previous methods can be categorized into two directions. Acoustic tokenizers are trained with reconstruction/adversarial objectives of speech waveform. Acoustic tokens reserve enough information to reconstruct the original audio, but to represent the additional information it relies on either high sampling rate (i.e. number of tokens per second) or residual vector quantization [44] (i.e. multiple stacked codebooks). Semantic tokens are extracted from self-supervised representations learned on auto matically discovered speech units [19]. Semantic tokens discard additional information that is unnecessary to represent semantic meaning of speech, but also result in low-quality speech synthesis and a loss of acoustic details [31]. The ideal speech tokenizer for speech-text language modeling should have several key features: 1) low sampling rate with a single codebook to support autoregressive generation. 2) aligning with texts to transfer knowledge of pretrained language models. 3) support of high-quality speech synthesis.

We adopt the 12.5Hz speech tokenizer variant described in Zeng et al. [45]. To make the paper self-contained, we briefly describe the architecture of the speech tokenizer. Inspired by the supervised semantic tokenizer in text-to-speech synthesis [14], we finetune a pretrained automatic speech recognition model (we use whisper-large-v3 in the Whisper family [36]) with an additional pooling layer and a vector quantization layer [40] in the middle of the encoder. The codebook vectors are learned with exponential moving average (EMA) and we reset vectors whose mean usage falls below a certain threshold with randomly-selected continuous representations before quantization to overcome codebook collapse following Dhariwal et al. [13].

![](images/figure_01_chart.jpg)

<details>
<summary>flowchart</summary>

```mermaid
graph TD
    A["Transcription"] --> B["ASR Decoder"]
    B --> C["Feed-forward Network"]
    B --> D["Self-Attention"]
    C --> E["×L/2"]
    D --> E
    E --> F["Speech Tokenizers"]
    F --> G["Vector Quantizer"]
    F --> H["Pooling Layer"]
    F --> I["Feed-forward Network"]
    F --> J["Block Causal Self-Attention"]
    I --> K["×L/2"]
    J --> K
    K --> L["Speech"]
    L --> M["Speech Tokenizers"]
    M --> N["Embedding"]
    N --> O["Feed-forward Network"]
    N --> P["Block Causal Self-Attention"]
    O --> Q["Noise"]
    P --> Q
    Q --> R["Conditional Flow Matching"]
    R --> S["Mel spectrograms"]
    S --> T["HiFi-GAN Vocoder"]
    T --> U["Speech"]
```
</details>

Figure 1: Architecture of the Speech Tokenizer and Speech Decoder for GLM-4-Voice.

Table 1: Evaluation results of speech tokenizers and decoders. LS stands for LibriSpeech. Evaluation on LibriSpeech (English) is measured using word error rate (WER), while AISHELL-1 (Chinese) is evaluated using character error rate (CER). We fine-tuned the ASR model whisper-large-v3 with vector quantization and various pooling layers to create tokenizers with different sampling rates. For further development of GLM-4-Voice, we selected the 12.5 Hz variant. 

<table><tr><td rowspan="2"></td><td rowspan="2">Frame Rate</td><td rowspan="2">BitRate (bps)</td><td colspan="3">ASR↓</td><td colspan="3">Reconstruction</td></tr><tr><td>LS-clean</td><td>LS-other</td><td>AISHELL-1</td><td>WER↓</td><td>VisQOL↑</td><td>MOSNet↑</td></tr><tr><td>SpeechTokenizer</td><td>50Hz</td><td>1.50K</td><td>∅</td><td>∅</td><td>∅</td><td>9.97</td><td>1.53</td><td>2.67</td></tr><tr><td>SpeechTokenizer</td><td>50Hz</td><td>4.00K</td><td>∅</td><td>∅</td><td>∅</td><td>6.32</td><td>3.07</td><td>3.10</td></tr><tr><td>Moshi (Mimi)</td><td>12.5Hz</td><td>1.10K</td><td>∅</td><td>∅</td><td>∅</td><td>8.36</td><td>2.82</td><td>2.89</td></tr><tr><td>whisper-large-v3</td><td>50Hz</td><td>-</td><td>2.50</td><td>4.53</td><td>9.31</td><td>∅</td><td>∅</td><td>∅</td></tr><tr><td>SenseVoice-Large</td><td>50Hz</td><td>-</td><td>2.57</td><td>4.28</td><td>2.09</td><td>∅</td><td>∅</td><td>∅</td></tr><tr><td rowspan="4">GLM-4-Voice-Tokenizer</td><td>12.5Hz</td><td>175</td><td>2.10</td><td>4.90</td><td>3.02</td><td>8.43</td><td>2.52</td><td>3.39</td></tr><tr><td>50Hz</td><td>600</td><td>1.85</td><td>3.78</td><td>2.70</td><td>6.24</td><td>2.67</td><td>3.38</td></tr><tr><td>25Hz</td><td>300</td><td>1.94</td><td>4.16</td><td>2.86</td><td>6.80</td><td>2.60</td><td>3.33</td></tr><tr><td>6.25Hz</td><td>100</td><td>14.41</td><td>2.34</td><td>3.24</td><td>14.41</td><td>2.34</td><td>3.24</td></tr></table>

Causality for Streaming Inference To enable streaming encoding of input speech during inference, we adapt the architecture of Whisper encoder to introduce causality [45]. Specifically, we replace the convolution layer before the encoder Transformer with causal convolution [39]. We also replace the bidirectional attention in the encoder with block causal attention.

Training Details We fine-tune the vector-quantized Whisper model with a collection of ASR datasets, including LibriSpeech [34], GigaSpeech [7], MLS-Eng [35], Wenet [43], CommonVoice [3], AISHELL-1 [6], and a proprietary Chinese ASR dataset of 10k hours. We also include 700k hours unsupervised speech data with pseudo labels generated by whisper-large-v3 [36] for English and paraformer-large [1] for Chinese. All of our speech tokenizers are fine-tuned from whisper-large-v3 for 2 epochs with batch size 4096 and learning rate 1e-5. The ratio of supervised samples to pseudo labeled samples is 1:3. The codebook vectors are updated with exponential moving average with decay coefficient 0.99 and the commitment loss coefficient is 10.0. To reduce the information loss of average pooling, we increase the codebook size as the sampling rate decreases.

Evaluation We measure the reservation of semantic information in the speech tokens by the accuracy of the finetuned ASR model. The results on LibriSpeech [34] and AISHELL-1 [6] are shown in Table 1, with whisper-large-v3 [36] and SenseVoice-Large [1] as baselines. Overall all the tokenizers reserve enough semantic information to achieve accurate ASR performance. Considering the reconstruction results in the following section, we select the 12.5Hz tokenizer for GLM-4-Voice.

### 3.2 Speech Decoder

The speech decoder synthesizes speech waveforms from discrete speech tokens and is crucial for ensuring the quality and expressiveness of generated speech. To minimize latency during speech interaction, the decoder must also support streaming inference. As in Zeng et al. [45], we adopt the decoder architecture of CosyVoice [14], which comprises a speech token encoder, a conditional flow matching model [28], and a HiFi-GAN vocoder [22].

Training Details We train the speech token encoder and the flow matching model from scratch, with a two-stage training paradigm to fully utilize the abundant speech data of varied quality. During the pre-training stage, we use all the speech samples in the unsupervised speech data of various speakers and quality. During the fine-tuning stage, we use high-quality speech samples from a single speaker.

![](images/figure_02_chart.jpg)

<details>
<summary>flowchart</summary>

```mermaid
graph TD
    A["Text Corpus"] --> B["Text-to-Token LM"]
    B --> C["Synthesize Interleaved Data"]
    C --> D["Stage I: Large-scale Speech-Text Pre-training"]
    D --> E["Speech"]
    E --> F["Q_speech"]
    F --> G["Stage II: Supervised Fine-tuning w/ &quot;Streaming Thoughts&quot; Template"]
    G --> H["Speech"]
    H --> I["Speech"]
    I --> J["Speech"]
    J --> K["GLM-4-Voice"]
    K --> L["Speech Input"]
    L --> M["Speech Tokenizer"]
    M --> N["User Input"]
    N --> O["Speech Decoder"]
    O --> P["Model Output"]
    P --> Q["Latency: ~20 tokens"]
    Q --> K
    style A fill:#f9f,stroke:#333
    style P fill:#bbf,stroke:#333
```
</details>

Figure 2: Left: Data construction of two training stage of GLM-4-Voice. Right: Model architecture of GLM-4-Voice.

Support for Streaming Inference To enable streaming inference and reduce latency, we incorporate truncated audio samples (i.e., the first $n \cdot b$ seconds of the audio, where $n = 1 , 2 , 3 , . . . _ $ , and b is the block size) during the fine-tuning stage. This prepares the model to handle streaming scenarios effectively. During inference, the decoder processes speech tokens corresponding to the first $n \cdot b$ seconds of audio. It uses the speech from the initial $( n - 1 ) b$ seconds as the prompt and predicts the speech content from $( n - 1 ) b$ to $n \cdot b$ seconds. This approach allows the model to generate speech tokens with a minimum delay of b seconds. Based on empirical studies, we set $b = 0 . 8$ for GLM-4-Voice, which implies that at least 10 speech tokens are required to generate the initial speech output.

Evaluation We take the reconstruction results from Zeng et al. [45] to demonstrate the performance of our speech decoder with low-bit-rate speech tokens. We evaluate our speech decoder on speech reconstruction of LibriSpeech [34]. and compare our tokenizer with SpeechTokenizer [48] and Mini [12]. Following Défossez et al. [12], we also evaluate a variant of SpeechTokenizer that only keeps the first 3 RVQ layers to obtain a 1.5kbps bitrate. Table 1 shows that our speech decoder performs well across various sampling rates, with the 12.5Hz variant offering an optimal balance between efficiency and quality. It maintains high quality scores (MOSNet 3.39) and content preservation (WER 8.43) while significantly reducing bitrate (175).

### 3.3 Inference

Decoupling Speech-to-Speech Task An ideal speech language model would operate solely on speech tokens for direct speech-to-speech tasks. However, given the success of large language models and the assumption that text representing the semantic content of most speech, we decouple the speech-to-speech task into two sub-tasks: speech-to-text and speech-and-text-to-speech. Given the user’s speech input $\textit { Q } _ { s } ,$ the correspond text response $A _ { t }$ , and the speech output $A _ { s }$ , these tasks are defined as follows:

• Speech-to-Text: The model generates a text response, $A _ { t } ,$ based on the user’s speech input, $Q _ { s } .$   
• Speech-and-Text-to-Speech: Leveraging both $Q _ { \varepsilon }$ and $A _ { t }$ , the model generates spoken output, $A _ { s }$ with adaptive tone and prosody to ensure conversational coherence.

We adopt the decoupling strategy for the inference process. First, the model generates the text answer $A _ { t }$ based on the user input $Q _ { s } ,$ , and then generates $A _ { s }$ using both $Q _ { s }$ and $A _ { t }$ . In this way the generation of speech response $A _ { s }$ is guided by the text response $A _ { t }$ to improve performance. However, this approach results in a high initial token delay, as it requires waiting for the complete generation of $A _ { t }$ before starting on $A _ { s } .$ . To address this, we apply a template named called Streaming Thoughts. As illustrated in Figure 2, given $Q _ { s } ,$ , the model alternates between outputting text and speech tokens at a specified ratio, which are then concatenated to form $A _ { t }$ and $A _ { s }$ , respectively. Specifically, based on our 12.5Hz tokenizer, we alternate between generating 13 text tokens and 26 speech tokens. This 1:2 ratio is chosen to ensure that text generation is consistently faster than speech. Otherwise, the generated speech tokens would lack the necessary context from the text tokens. The choice of 26 speech tokens is based on empirical observations, allowing the model to produce a coherent portion of content before synthesizing it to ensure accuracy in the synthesized speech.

Overall Latency The overall response latency for generating the first speech waveform can be calculated as follows:

• Speech Tokenization: The user’s speech input is processed in a streaming manner by the speech tokenizer, which operates on blocks of fixed size $t _ { \mathrm { b l o c k } }$ . Thanks to the streaming design, the tokenizer begins processing immediately and only requires the time to handle the current block, regardless of the total speech duration. Thus, the tokenization latency is:

$$
T _ {\text { speech\_tokenize }} = f _ {\text { speech\_tokenize }} (t _ {\text { block }})
$$

• LLM Prefilling: The number of speech tokens, $N _ { \mathrm { s p e e c h \_ t o k e n s } } ,$ generated by the tokenizer is based on the length of the user’s speech Tuser\_speech and the frame rate $f r = 1 2 . 5$ tokens per second. The prefill latency for the LLM is given by:

$$
T _ {\text { llm\_prefill }} = f _ {\text { llm\_prefill }} \left(f r \cdot T _ {\text { user\_speech }}\right)
$$

• LLM Decoding: For the initial audio response, the LLM generates 13 text tokens and 10 speech tokens, resulting in a total of $N _ { \mathrm { f i r s t \_ s p e e c h } } = 1 3 + 1 0 = 2 3$ tokens. The decoding latency for this step is:

$$
T _ {\text { llm\_decode }} = f _ {\text { llm\_decode }} \left(N _ {\text { first\_speech }}\right)
$$

• Speech Decoding: The $N _ { \mathrm { s p e e c h } } = 1 0$ audio tokens are processed by the speech decoder to generate the first audio chunk. The latency for this step is:

$$
T _ {\text { speech\_decode }} = f _ {\text { speech\_decode }} \left(N _ {\text { speech }}\right)
$$

The total response latency is then:

$$
T _ {\text { total }} = T _ {\text { speech\_tokenize }} + T _ {\text { llm\_prefill }} + T _ {\text { llm\_decode }} + T _ {\text { speech\_decode }}
$$

## 4 Training Procedure

### 4.1 Stage 1: Joint Speech-Text Pre-training

We adopt the same pre-training data and procedure in Zeng et al. [45]. The primary objective of this stage is to extend speech modeling ability to LLM through large-scale speech pre-training. We utilize three types of speech data:

• Interleaved speech-text data: Synthesized from text pre-training data as described in Zeng et al. [45], these datasets facilitate cross-modal knowledge transfer between text and speech.   
• Unsupervised speech data: Comprising 700k hours of speech data, this dataset encourages the model to learn from real-world speech.   
• Supervised speech-text data: Including both ASR and TTS data, this dataset improves the model’s capabilities in basic speech tasks.

We also mix text pre-training datasets to maintain text performance. The statistics of training data is shown in Table 2.

#### 4.1.1 Hyper-parameters

We initialize GLM-4-Voice from GLM-4-9B-Base [16] and expand its vocabulary to include speech tokens. We perform pre-training on 1 trillion tokens, with a fixed sampling ratio of 30% text data, one epoch each of unsupervised speech and supervised speech-text data, and the remainder composed of interleaved speech-text data. The composition of the training corpora is detailed in Table 2.

We use the AdamW [27] optimizer with $\beta _ { 1 } = 0 . 9$ and $\beta _ { 2 } = 0 . 9 5$ . The model is trained with a sequence length of 8192 and a learning rate that linearly decays from $6 \times 1 0 ^ { - 5 } \mathrm { t o } 6 \times 1 0 ^ { - 6 }$ .

Table 2: Statistics of training data. 

<table><tr><td rowspan="2"></td><td colspan="2"># Tokens</td><td rowspan="2">Epochs</td></tr><tr><td>Speech</td><td>Text</td></tr><tr><td>Speech-Text</td><td>455B</td><td>279B</td><td>0.90</td></tr><tr><td>Speech-Only</td><td>31B</td><td>-</td><td>2.10</td></tr><tr><td>ASR + TTS</td><td>11B</td><td>3.5B</td><td>2.07</td></tr><tr><td>Text-only</td><td>-</td><td>10T</td><td>0.03</td></tr></table>

### 4.2 Stage 2: Supervised Fine-tuning

#### 4.2.1 Data Construction

To create a human-like spoken chatbot, we utilize the following two types of data:

• Multi-turn conversational spoken dialogues: These dialogues are primarily derived from textbased data, carefully filtered to ensure quality. Code and math-related content are excluded to focus on conversational material suitable for spoken interactions. Responses are refined by shortening lengthy texts and avoiding outputs unsuitable for verbal delivery. Corresponding speech outputs are synthesized to align with the refined dialogues. To enhance speech input diversity in real-world voice chat scenarios, annotators read and record a variety of speech inputs.   
• Speech style-controlled spoken dialogues: This category contains high-quality multi-turn spoken dialogues tailored to specific speech style requirements, such as speed, emotion, or dialect.

#### 4.2.2 Training Details

As described in Section 3.3, we decouple the speech-to-speech task into two subtasks and employ the streaming thoughts template to reduce latency. Each conversational turn consists of a user speech input $Q _ { s } ,$ , the corresponding text input $Q _ { t }$ , a text output $A _ { t } ,$ and the corresponding speech output $A _ { s }$ .

We observed differing learning curves for the two subtasks. Specifically, given a user speech input $\textit { Q } _ { s } ,$ the model learns the text output $A _ { t }$ more quickly and compared to the speech output $A _ { s }$ . To address this discrepancy, we split each training sample into two components: one focuses on learning the text output from the speech input by masking the loss for the speech output, while the other focuses on learning the speech output from both the speech input and text output by masking the loss for the text output.

The model is fine-tuned for 20 epochs on speech output and 4 epochs on text output. The learning rate is gradually reduced from $1 \times 1 \mathrm { { \dot { 0 } ^ { - 5 } } } \mathrm { { t o } } 1 \times 1 0 ^ { - 6 }$ . To mitigate overfitting, we apply a weight decay of 0.1, set a dropout rate of 0.5 for hidden layers, and clip gradients to a maximum value of 1.0.

## 5 Evaluation

### 5.1 Base Model Evaluation

We evaluate the base model with two speech-text tasks, speech language modeling [5] and spoken question answering [30]. For both tasks we consider two different settings: from speech context to speech generation (denoted as S S), and from speech context to text generation, denoted as S T. For all the tasks we synthesis the contexts and continuations with the multi-speaker TTS API provided by VolcEngine1.

Table 3: Speech Language Modeling results. Results for Spirit-LM are taken from Nguyen et al. [32] and other results are from Défossez et al. [12]. 

<table><tr><td></td><td>Modality</td><td># Params</td><td>Topic-StoryCloze</td><td>StoryCloze</td></tr><tr><td>TWIST</td><td>S→S</td><td>7B</td><td>66.6</td><td>53.3</td></tr><tr><td>Spirit-LM</td><td>S→S</td><td>7B</td><td>82.9</td><td>61.0</td></tr><tr><td>Spirit-LM</td><td>S→T</td><td>7B</td><td>88.6</td><td>64.6</td></tr><tr><td>Moshi</td><td>S→S</td><td>7B</td><td>83.0</td><td>60.8</td></tr><tr><td>GLM-4-Voice</td><td>S→T</td><td>9B</td><td>93.6</td><td>76.3</td></tr><tr><td>GLM-4-Voice</td><td>S→S</td><td>9B</td><td>82.9</td><td>62.4</td></tr></table>

Speech Language Modeling This tasks evaluates the pretrained model’s ability to model interleaved speech and texts. The model is given a context and required to select the correct continuation according to the predicted likelihood. We use two datasets proposed by Hassid et al. [17], spoken StoryCloze and spokeh Topic-StoryCloze. Both datasets are transformed from the the StoryCloze textual benchmark [29]. The spoken Topic-StoryCloze is easier than spoken StoryCloze. The baseline results are taken from Défossez et al. [12].

Table 4: Spoken Question Answering results. Results for baselines are taken from Défossez et al. [12]. 

<table><tr><td></td><td>Modality</td><td># Params</td><td>Web Questions</td><td>Llama Questions</td><td>TriviaQA</td></tr><tr><td>TWIST</td><td>S→S</td><td>7B</td><td>1.5</td><td>4.0</td><td>-</td></tr><tr><td>SpeechGPT</td><td>S→T</td><td>7B</td><td>6.5</td><td>21.6</td><td>14.8</td></tr><tr><td>Spectron</td><td>S→T</td><td>1B</td><td>6.1</td><td>21.9</td><td>-</td></tr><tr><td>Moshi</td><td>S→T</td><td>7B</td><td>26.6</td><td>62.3</td><td>22.8</td></tr><tr><td>Moshi</td><td>S→S</td><td>7B</td><td>9.2</td><td>21.0</td><td>7.3</td></tr><tr><td>GLM-4-Voice</td><td>S→T</td><td>9B</td><td>32.2</td><td>64.7</td><td>39.1</td></tr><tr><td>GLM-4-Voice</td><td>S→S</td><td>9B</td><td>15.9</td><td>50.7</td><td>26.5</td></tr></table>

Table 5: ASR and TTS results. The LibriSpeech (English) is measured with word-error-rate (WER) and AISHELL-1 (Chinese) is measured with character-error-rate (CER). The TTS tasks are measured with WER. We use  to indicate tasks and modalities not supported by the model. 

<table><tr><td></td><td colspan="2">LibriSpeech</td><td>AISHELL-1</td><td>LibriTTS</td><td colspan="2">Seed-TTS</td></tr><tr><td></td><td>test-clean</td><td>test-other</td><td>test</td><td>test-clean</td><td>test-en</td><td>test-zh</td></tr><tr><td>CosyVoice</td><td>∅</td><td>∅</td><td>∅</td><td>3.17</td><td>3.39</td><td>3.10</td></tr><tr><td>whisper-large-v3</td><td>2.50</td><td>4.53</td><td>9.31</td><td>∅</td><td>∅</td><td>∅</td></tr><tr><td>GLM-4-Voice</td><td>2.82</td><td>7.66</td><td>2.46</td><td>5.64</td><td>2.91</td><td>2.10</td></tr></table>

Spoken Question Answering Similar to closed-book question answering in NLP, spoken question answering requires the speech language model to answer spoken questions about broad factual knowledge without access to external knowledge base. We evaluate our model on 3 datasets used in Défossez et al. [12], Web Questions [4], Llama Questions [30], and TriviaQA [21]. The baseline results are taken from Défossez et al. [12].

Results The results for speech language modeling are shown in Table 3 and those for spoken question answering are shown in Table 4. We can observe that GLM-4-Voice outperforms baselines on all the evaluated tasks in both S S and S T settings, except Topic-StoryCloze in the S S setting. Compared with Moshi [12], which also supports both speech and text modalities, our model excels in spoken question answering, whether the answers are textual or spoken. Another observation is that the accuracy in the S→T setting is always better than that in the S→S setting, especially for spoken question answering. Therefore textual guidance is still necessary for intelligent speech chatbots. However, our method significantly reduces the gap between spoken answers and textual answers on spoken question answering, especially on Llama Questions, with the potential to develop direct speech-to-speech chatbots.

ASR / TTS We prompt the base model with the same prompt format used for the ASR / TTS task in pre-training. Whisper-Large-V3 [36] and Paraformer-Large [38] are employed to generate the text prediction for English and Chinese recognition in the TTS task respectively. Before computing the error rate, the text prediction is normalized respectively with tokenizer of whisper-large-v3 and CosyVoice [14] pipeline for ASR and TTS tasks. The results are summarized in Table 5. GLM-4-Voice achieve similar ASR and TTS ability compared with whisper-large-v3[36] and CosyVoice [14] baselines.

### 5.2 Chat Model Evaluation

ChatGPT Score To evaluate the question answering ability and knowledge memorization of the fine-tuned chat model, we use GPT-4o [33], specifically gpt-4o-2024-05-13, to evaluate quality or correctness of the model response. For the General QA task, we adopt the questions from the helpful base and vicuna subset of AlpacaEval [25] with math-related questions removed, which follows the chat evaluation dateset of Llama-Omni [15]. We ask GPT-4o to evaluate response quality and score the response in a range from 1 to 10 following the evaluation method of MT-Bench [49]. For the Knowledge task, we select 100 questions from Web Questions, Llama Questions, and TriviaQA. We provide GPT-4o with ground-truth answer and ask it to judge whether the response of the model is correct. The score reported in Table 6 is the answer accuracy normalized to a scale of 0 (0%) to 10 (100%). All texts used for judging are audio transcriptions produced by Whisper-Large-V3 [36] and the prompts used for scoring are included in Appendix A.1.

Table 6: Chat model evaluation results. The baseline results are taken from Zeng et al. [45] 

<table><tr><td></td><td colspan="2">ChatGPT Score ↑</td><td>UTMOS ↑</td><td>ASR-WER ↓</td></tr><tr><td></td><td>General QA</td><td>Knowledge</td><td></td><td></td></tr><tr><td>SpeechGPT [46]</td><td>1.40</td><td>2.20</td><td>3.86</td><td>66.57</td></tr><tr><td>Mini-Omni [42]</td><td>2.44</td><td>1.10</td><td>3.17</td><td>25.28</td></tr><tr><td>Llama-Omni [15]</td><td>3.50</td><td>3.90</td><td>3.92</td><td>9.18</td></tr><tr><td>Moshi [12]</td><td>2.42</td><td>3.60</td><td>3.90</td><td>7.95</td></tr><tr><td>GLM-4-Voice</td><td>5.40</td><td>5.20</td><td>4.45</td><td>5.74</td></tr></table>

Speech Quality We use the UTMOS [37] model to predict the mean opinion score (MOS) to evaluate the naturalness of the generated speech.

Speech-Text Alignment To evaluate the correspondence between the generated text responses and speech responses, we transcribe the speech responses for the General QA task into text with whipser-large-v3 [36]. Then, the word error rate (WER) is calculated between the transcription and the text response, which is referred to as ASR-WER(%) in Table 6. GLM-4-Voice is a bilingual model and sometimes answers the English query with a Chinese response, whose WER cannot be calculated directly. For a fair comparison with the English-only baseline models, we restrict the output of GLM-4-Voice to English tokens when evaluating the tasks reported in Table 6.

## 6 Conclusion

In this paper, we introduced GLM-4-Voice, an end-to-end spoken chatbot designed for natural and expressive voice interactions. By integrating a 12.5Hz supverised speech tokenizer, a flow-matching based speech decoder, and large-scale pre-training on 1 trillion tokens of speech-text data, GLM-4- Voice effectively bridges text and speech modalities. It achieves strong performance across tasks like speech language modeling, ASR, TTS, and spoken question answering. Fine-tuning with high-quality conversational datasets further enhances its ability to generate fluent, low-latency, and nuanced responses. The open availability of GLM-4-Voice encourages further exploration in building practical and accessible spoken AI systems.

## References

[1] Keyu An, Qian Chen, Chong Deng, Zhihao Du, Changfeng Gao, Zhifu Gao, Yue Gu, Ting He, Hangrui Hu, Kai Hu, Shengpeng Ji, Yabin Li, Zerui Li, Heng Lu, Haoneng Luo, Xiang Lv, Bin Ma, Ziyang Ma, Chongjia Ni, Changhe Song, Jiaqi Shi, Xian Shi, Hao Wang, Wen Wang, Yuxuan Wang, Zhangyu Xiao, Zhijie Yan, Yexin Yang, Bin Zhang, Qinglin Zhang, Shiliang Zhang, Nan Zhao, and Siqi Zheng. Funaudiollm: Voice understanding and generation foundation models for natural interaction between humans and llms. CoRR, abs/2407.04051, 2024. URL https://doi.org/10.48550/arXiv.2407.04051.   
[2] Junyi Ao, Rui Wang, Long Zhou, Chengyi Wang, Shuo Ren, Yu Wu, Shujie Liu, Tom Ko, Qing Li, Yu Zhang, et al. Speecht5: Unified-modal encoder-decoder pre-training for spoken language processing. In Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pages 5723–5738, 2022.   
[3] Rosana Ardila, Megan Branson, Kelly Davis, Michael Kohler, Josh Meyer, Michael Henretty, Reuben Morais, Lindsay Saunders, Francis M. Tyers, and Gregor Weber. Common voice: A massively-multilingual speech corpus. In Proceedings of The 12th Language Resources and Evaluation Conference, LREC 2020, Marseille, France, May 11-16, 2020, pages 4218–4222. European Language Resources Association, 2020.   
[4] Jonathan Berant, Andrew Chou, Roy Frostig, and Percy Liang. Semantic parsing on freebase from question-answer pairs. In Proceedings of the 2013 Conference on Empirical Methods in Natural Language Processing, EMNLP 2013, 18-21 October 2013, Grand Hyatt Seattle, Seattle, Washington, USA, A meeting of SIGDAT, a Special Interest Group of the ACL, pages 1533–1544. ACL, 2013.   
[5] Zalán Borsos, Raphaël Marinier, Damien Vincent, Eugene Kharitonov, Olivier Pietquin, Matthew Sharifi, Dominik Roblek, Olivier Teboul, David Grangier, Marco Tagliasacchi, and Neil Zeghidour. Audiolm: A language modeling approach to audio generation. IEEE ACM Trans. Audio Speech Lang. Process., 31:2523–2533, 2023.   
[6] Hui Bu, Jiayu Du, Xingyu Na, Bengu Wu, and Hao Zheng. AISHELL-1: an open-source mandarin speech corpus and a speech recognition baseline. In 20th Conference of the Oriental Chapter of the International Coordinating Committee on Speech Databases and Speech I/O Systems and Assessment, O-COCOSDA 2017, Seoul, South Korea, November 1-3, 2017, pages 1–5. IEEE, 2017.   
[7] Guoguo Chen, Shuzhou Chai, Guan-Bo Wang, Jiayu Du, Wei-Qiang Zhang, Chao Weng, Dan Su, Daniel Povey, Jan Trmal, Junbo Zhang, Mingjie Jin, Sanjeev Khudanpur, Shinji Watanabe, Shuaijiang Zhao, Wei Zou, Xiangang Li, Xuchen Yao, Yongqing Wang, Zhao You, and Zhiyong Yan. Gigaspeech: An evolving, multi-domain ASR corpus with 10, 000 hours of transcribed audio. In 22nd Annual Conference of the International Speech Communication Association, Interspeech 2021, Brno, Czechia, August 30 - September 3, 2021, pages 3670–3674. ISCA, 2021.   
[8] Yi-Chen Chen, Po-Han Chi, Shu-wen Yang, Kai-Wei Chang, Jheng-hao Lin, Sung-Feng Huang, Da-Rong Liu, Chi-Liang Liu, Cheng-Kuang Lee, and Hung-yi Lee. Speechnet: A universal modularized model for speech processing tasks. arXiv preprint arXiv:2105.03070, 2021.   
[9] Yunfei Chu, Jin Xu, Xiaohuan Zhou, Qian Yang, Shiliang Zhang, Zhijie Yan, Chang Zhou, and Jingren Zhou. Qwen-audio: Advancing universal audio understanding via unified large-scale audio-language models. CoRR, abs/2311.07919, 2023.   
[10] Yu-An Chung, Yu Zhang, Wei Han, Chung-Cheng Chiu, James Qin, Ruoming Pang, and Yonghui Wu. w2v-bert: Combining contrastive learning and masked language modeling for self-supervised speech pre-training. In IEEE Automatic Speech Recognition and Understanding Workshop, ASRU 2021, Cartagena, Colombia, December 13-17, 2021, pages 244–250. IEEE, 2021.   
[11] Alexandre Défossez, Jade Copet, Gabriel Synnaeve, and Yossi Adi. High fidelity neural audio compression. Trans. Mach. Learn. Res., 2023, 2023.

[12] Alexandre Défossez, Laurent Mazaré, Manu Orsini, Amélie Royer, Patrick Pérez, Hervé Jégou, Edouard Grave, and Neil Zeghidour. Moshi: a speech-text foundation model for real-time dialogue. Technical report, Kyutai, September 2024. URL http://kyutai.org/Moshi.pdf.   
[13] Prafulla Dhariwal, Heewoo Jun, Christine Payne, Jong Wook Kim, Alec Radford, and Ilya Sutskever. Jukebox: A generative model for music. CoRR, abs/2005.00341, 2020.   
[14] Zhihao Du, Qian Chen, Shiliang Zhang, Kai Hu, Heng Lu, Yexin Yang, Hangrui Hu, Siqi Zheng, Yue Gu, Ziyang Ma, Zhifu Gao, and Zhijie Yan. Cosyvoice: A scalable multilingual zero-shot text-to-speech synthesizer based on supervised semantic tokens, 2024. URL https: //arxiv.org/abs/2407.05407.   
[15] Qingkai Fang, Shoutao Guo, Yan Zhou, Zhengrui Ma, Shaolei Zhang, and Yang Feng. Llamaomni: Seamless speech interaction with large language models, 2024. URL https://arxiv. org/abs/2409.06666.   
[16] Team GLM, Aohan Zeng, Bin Xu, Bowen Wang, Chenhui Zhang, Da Yin, Dan Zhang, Diego Rojas, Guanyu Feng, Hanlin Zhao, Hanyu Lai, Hao Yu, Hongning Wang, Jiadai Sun, Jiajie Zhang, Jiale Cheng, Jiayi Gui, Jie Tang, Jing Zhang, Jingyu Sun, Juanzi Li, Lei Zhao, Lindong Wu, Lucen Zhong, Mingdao Liu, Minlie Huang, Peng Zhang, Qinkai Zheng, Rui Lu, Shuaiqi Duan, Shudan Zhang, Shulin Cao, Shuxun Yang, Weng Lam Tam, Wenyi Zhao, Xiao Liu, Xiao Xia, Xiaohan Zhang, Xiaotao Gu, Xin Lv, Xinghan Liu, Xinyi Liu, Xinyue Yang, Xixuan Song, Xunkai Zhang, Yifan An, Yifan Xu, Yilin Niu, Yuantao Yang, Yueyan Li, Yushi Bai, Yuxiao Dong, Zehan Qi, Zhaoyu Wang, Zhen Yang, Zhengxiao Du, Zhenyu Hou, and Zihan Wang. Chatglm: A family of large language models from glm-130b to glm-4 all tools, 2024. URL https://arxiv.org/abs/2406.12793.   
[17] Michael Hassid, Tal Remez, Tu Anh Nguyen, Itai Gat, Alexis Conneau, Felix Kreuk, Jade Copet, Alexandre Défossez, Gabriel Synnaeve, Emmanuel Dupoux, Roy Schwartz, and Yossi Adi. Textually pretrained speech language models. In Advances in Neural Information Processing Systems 36: Annual Conference on Neural Information Processing Systems 2023, NeurIPS 2023, New Orleans, LA, USA, December 10 - 16, 2023, 2023.   
[18] Andrew Hines, Jan Skoglund, Anil Kokaram, and Naomi Harte. Visqol: an objective speech quality model. EURASIP Journal on Audio, Speech, and Music Processing, 2015 (13):1–18, 2015.   
[19] Wei-Ning Hsu, Benjamin Bolte, Yao-Hung Hubert Tsai, Kushal Lakhotia, Ruslan Salakhutdinov, and Abdelrahman Mohamed. Hubert: Self-supervised speech representation learning by masked prediction of hidden units. IEEE ACM Trans. Audio Speech Lang. Process., 29:3451–3460, 2021.   
[20] Shengpeng Ji, Ziyue Jiang, Xize Cheng, Yifu Chen, Minghui Fang, Jialong Zuo, Qian Yang, Ruiqi Li, Ziang Zhang, Xiaoda Yang, Rongjie Huang, Yidi Jiang, Qian Chen, Siqi Zheng, Wen Wang, and Zhou Zhao. Wavtokenizer: an efficient acoustic discrete codec tokenizer for audio language modeling. CoRR, abs/2408.16532, 2024.   
[21] Mandar Joshi, Eunsol Choi, Daniel S. Weld, and Luke Zettlemoyer. Triviaqa: A large scale distantly supervised challenge dataset for reading comprehension. In Proceedings of the 55th Annual Meeting of the Association for Computational Linguistics, ACL 2017, Vancouver, Canada, July 30 - August 4, Volume 1: Long Papers, pages 1601–1611. Association for Computational Linguistics, 2017.   
[22] Jungil Kong, Jaehyeon Kim, and Jaekyoung Bae. Hifi-gan: Generative adversarial networks for efficient and high fidelity speech synthesis. In H. Larochelle, M. Ranzato, R. Hadsell, M.F. Balcan, and H. Lin, editors, Advances in Neural Information Processing Systems, volume 33, pages 17022–17033. Curran Associates, Inc., 2020. URL https://proceedings.neurips.cc/ paper\_files/paper/2020/file/c5d736809766d46260d816d8dbc9eb44-Paper.pdf.   
[23] Rithesh Kumar, Prem Seetharaman, Alejandro Luebs, Ishaan Kumar, and Kundan Kumar. High-fidelity audio compression with improved RVQGAN. In Advances in Neural Information Processing Systems 36: Annual Conference on Neural Information Processing Systems 2023, NeurIPS 2023, New Orleans, LA, USA, December 10 - 16, 2023, 2023.

[24] Kushal Lakhotia, Eugene Kharitonov, Wei-Ning Hsu, Yossi Adi, Adam Polyak, Benjamin Bolte, Tu-Anh Nguyen, Jade Copet, Alexei Baevski, Abdelrahman Mohamed, and Emmanuel Dupoux. On generative spoken language modeling from raw audio. Transactions of the Association for Computational Linguistics, 9:1336–1354, 2021.   
[25] Xuechen Li, Tianyi Zhang, Yann Dubois, Rohan Taori, Ishaan Gulrajani, Carlos Guestrin, Percy Liang, and Tatsunori B. Hashimoto. Alpacaeval: An automatic evaluator of instruction-following models. https://github.com/tatsu-lab/alpaca\_eval, 5 2023.   
[26] Chen-Chou Lo, Szu-Wei Fu, Wen-Chin Huang, Xin Wang, Junichi Yamagishi, Yu Tsao, and Hsin-Min Wang. Mosnet: Deep learning-based objective assessment for voice conversion. In Gernot Kubin and Zdravko Kacic, editors, 20th Annual Conference of the International Speech Communication Association, Interspeech 2019, Graz, Austria, September 15-19, 2019, pages 1541–1545. ISCA, 2019. doi: 10.21437/INTERSPEECH.2019-2003. URL https: //doi.org/10.21437/Interspeech.2019-2003.   
[27] Ilya Loshchilov and Frank Hutter. Decoupled weight decay regularization, 2019. URL https: //arxiv.org/abs/1711.05101.   
[28] Shivam Mehta, Ruibo Tu, Jonas Beskow, Éva Székely, and Gustav Eje Henter. Matcha-TTS: A fast TTS architecture with conditional flow matching. In Proc. ICASSP, 2024.   
[29] Nasrin Mostafazadeh, Nathanael Chambers, Xiaodong He, Devi Parikh, Dhruv Batra, Lucy Vanderwende, Pushmeet Kohli, and James F. Allen. A corpus and evaluation framework for deeper understanding of commonsense stories. CoRR, abs/1604.01696, 2016.   
[30] Eliya Nachmani, Alon Levkovitch, Roy Hirsch, Julian Salazar, Chulayuth Asawaroengchai, Soroosh Mariooryad, Ehud Rivlin, R. J. Skerry-Ryan, and Michelle Tadmor Ramanovich. Spoken question answering and speech continuation using spectrogram-powered LLM. In The Twelfth International Conference on Learning Representations, ICLR 2024, Vienna, Austria, May 7-11, 2024. OpenReview.net, 2024.   
[31] Tu Anh Nguyen, Wei-Ning Hsu, Antony D’Avirro, Bowen Shi, Itai Gat, Maryam Fazel-Zarandi, Tal Remez, Jade Copet, Gabriel Synnaeve, Michael Hassid, Felix Kreuk, Yossi Adi, and Emmanuel Dupoux. Expresso: A benchmark and analysis of discrete expressive speech resynthesis. In Naomi Harte, Julie Carson-Berndsen, and Gareth Jones, editors, 24th Annual Conference of the International Speech Communication Association, Interspeech 2023, Dublin, Ireland, August 20-24, 2023, pages 4823–4827. ISCA, 2023.   
[32] Tu Anh Nguyen, Benjamin Muller, Bokai Yu, Marta R. Costa-jussa, Maha Elbayad, Sravya Popuri, Paul-Ambroise Duquenne, Robin Algayres, Ruslan Mavlyutov, Itai Gat, Gabriel Synnaeve, Juan Pino, Benoit Sagot, and Emmanuel Dupoux. Spirit-lm: Interleaved spoken and written language model, 2024. URL https://arxiv.org/abs/2402.05755.   
[33] OpenAI. Hello gpt-4o, 2024. URL https://openai.com/index/hello-gpt-4o/.   
[34] Vassil Panayotov, Guoguo Chen, Daniel Povey, and Sanjeev Khudanpur. Librispeech: An asr corpus based on public domain audio books. In 2015 IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP), pages 5206–5210, 2015. doi: 10.1109/ ICASSP.2015.7178964.   
[35] Vineel Pratap, Qiantong Xu, Anuroop Sriram, Gabriel Synnaeve, and Ronan Collobert. MLS: A large-scale multilingual dataset for speech research. In 21st Annual Conference of the International Speech Communication Association, Interspeech 2020, Virtual Event, Shanghai, China, October 25-29, 2020, pages 2757–2761. ISCA, 2020.   
[36] Alec Radford, Jong Wook Kim, Tao Xu, Greg Brockman, Christine McLeavey, and Ilya Sutskever. Robust speech recognition via large-scale weak supervision. In Andreas Krause, Emma Brunskill, Kyunghyun Cho, Barbara Engelhardt, Sivan Sabato, and Jonathan Scarlett, editors, International Conference on Machine Learning, ICML 2023, 23-29 July 2023, Honolulu, Hawaii, USA, volume 202 of Proceedings of Machine Learning Research, pages 28492–28518. PMLR, 2023.

[37] Takaaki Saeki, Detai Xin, Wataru Nakata, Tomoki Koriyama, Shinnosuke Takamichi, and Hiroshi Saruwatari. Utmos: Utokyo-sarulab system for voicemos challenge 2022. Interspeech 2022, 2022.   
[38] Xian Shi, Yexin Yang, Zerui Li, and Shiliang Zhang. Seaco-paraformer: A non-autoregressive asr system with flexible and effective hotword customization ability. arXiv preprint arXiv:2308.03266 (accepted by ICASSP2024), 2023.   
[39] Aäron van den Oord, Sander Dieleman, Heiga Zen, Karen Simonyan, Oriol Vinyals, Alex Graves, Nal Kalchbrenner, Andrew W. Senior, and Koray Kavukcuoglu. Wavenet: A generative model for raw audio. In The 9th ISCA Speech Synthesis Workshop, SSW 2016, Sunnyvale, CA, USA, September 13-15, 2016, page 125. ISCA, 2016.   
[40] Aäron van den Oord, Oriol Vinyals, and Koray Kavukcuoglu. Neural discrete representation learning. In Isabelle Guyon, Ulrike von Luxburg, Samy Bengio, Hanna M. Wallach, Rob Fergus, S. V. N. Vishwanathan, and Roman Garnett, editors, Advances in Neural Information Processing Systems 30: Annual Conference on Neural Information Processing Systems 2017, December 4-9, 2017, Long Beach, CA, USA, pages 6306–6315, 2017.   
[41] Xiong Wang, Yangze Li, Chaoyou Fu, Lei Xie, Ke Li, Xing Sun, and Long Ma. Freezeomni: A smart and low latency speech-to-speech dialogue model with frozen llm, 2024. URL https://arxiv.org/abs/2411.00774.   
[42] Zhifei Xie and Changqiao Wu. Mini-omni: Language models can hear, talk while thinking in streaming, 2024. URL https://arxiv.org/abs/2408.16725.   
[43] Zhuoyuan Yao, Di Wu, Xiong Wang, Binbin Zhang, Fan Yu, Chao Yang, Zhendong Peng, Xiaoyu Chen, Lei Xie, and Xin Lei. Wenet: Production oriented streaming and non-streaming end-to-end speech recognition toolkit. In 22nd Annual Conference of the International Speech Communication Association, Interspeech 2021, Brno, Czechia, August 30 - September 3, 2021, pages 4054–4058. ISCA, 2021.   
[44] Neil Zeghidour, Alejandro Luebs, Ahmed Omran, Jan Skoglund, and Marco Tagliasacchi. Soundstream: An end-to-end neural audio codec. IEEE ACM Trans. Audio Speech Lang. Process., 30:495–507, 2022. doi: 10.1109/TASLP.2021.3129994. URL https://doi.org/ 10.1109/TASLP.2021.3129994.   
[45] Aohan Zeng, Zhengxiao Du, Mingdao Liu, Lei Zhang, Shengmin Jiang, Yuxiao Dong, and Jie Tang. Scaling speech-text pre-training with synthetic interleaved data, 2024. URL https: //arxiv.org/abs/2411.17607.   
[46] Dong Zhang, Shimin Li, Xin Zhang, Jun Zhan, Pengyu Wang, Yaqian Zhou, and Xipeng Qiu. Speechgpt: Empowering large language models with intrinsic cross-modal conversational abilities, 2023. URL https://arxiv.org/abs/2305.11000.   
[47] Susan Zhang, Stephen Roller, Naman Goyal, Mikel Artetxe, Moya Chen, Shuohui Chen, Christopher Dewan, Mona T. Diab, Xian Li, Xi Victoria Lin, Todor Mihaylov, Myle Ott, Sam Shleifer, Kurt Shuster, Daniel Simig, Punit Singh Koura, Anjali Sridhar, Tianlu Wang, and Luke Zettlemoyer. OPT: open pre-trained transformer language models. CoRR, abs/2205.01068, 2022.   
[48] Xin Zhang, Dong Zhang, Shimin Li, Yaqian Zhou, and Xipeng Qiu. Speechtokenizer: Unified speech tokenizer for speech language models. In The Twelfth International Conference on Learning Representations, ICLR 2024, Vienna, Austria, May 7-11, 2024. OpenReview.net, 2024.   
[49] Lianmin Zheng, Wei-Lin Chiang, Ying Sheng, Siyuan Zhuang, Zhanghao Wu, Yonghao Zhuang, Zi Lin, Zhuohan Li, Dacheng Li, Eric P. Xing, Hao Zhang, Joseph E. Gonzalez, and Ion Stoica. Judging llm-as-a-judge with mt-bench and chatbot arena, 2023. URL https://arxiv.org/ abs/2306.05685.

## A Appendix

### A.1 Prompt for Evaluating Spoken Chatbots

## General QA

[Instruction]

Please act as an impartial judge and evaluate the quality of the response provided by an AI assistant to the user question displayed below. Your evaluation should consider factors such as the helpfulness, relevance, accuracy, depth, creativity, and level of detail of the response. Begin your evaluation by providing a short explanation. Be as objective as possible. After providing your explanation, you must rate the response on a scale of 1 to 10 by strictly following this format: "[[rating]]", for example: "Rating: [[5]]".

[Question]

{instruction}

[The Start of Assistant’s Answer]

{response}

[The End of Assistant’s Answer]

## Knowledge

Your will be given a question, the reference answers to that question, and an answer to be judged. Your tasks is to judge whether the answer to be judged is correct, given the question and reference answers. An answer considered correct expresses or contains the same meaning as at least \*\*one of\*\* the reference answers. The format and the tone of the response does not matter.

You should respond in JSON format. First provide a one-sentence concise analysis for the judgement in field ‘analysis‘, then your judgment in field ‘judgment‘. For example, ‘‘‘json {{"analysis": <a one-sentence concise analysis for the judgement>, "judgment": < your final judgment, "correct" or "incorrect">}}

\# Question

{instruction}

\# Reference Answer

{targets}

\# Answer To Be Judged

{answer\_to\_be\_judged}