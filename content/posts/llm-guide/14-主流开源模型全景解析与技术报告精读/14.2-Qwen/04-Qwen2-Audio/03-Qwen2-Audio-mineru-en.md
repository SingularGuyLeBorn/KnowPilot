---
title: "04-Qwen2-Audio Technical Report (MinerU EN)"
source_pdf: pdfs/Qwen2-Audio.pdf
converted_by: MinerU (re-processed)
date: 2026-05-23
---

> 🔙 **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**


# Qwen2-Audio Technical Report

Yunfei Chu∗† Jin Xu∗† Qian Yang∗ Haojie Wei Xipin Wei Zhifang Guo Yichong Leng Yuanjun Lv Jinzheng He Junyang Lin Chang Zhou† Jingren Zhou Qwen Team, Alibaba Group

Code & Demo & Models: https://github.com/QwenLM/Qwen2-Audio

## Abstract

We introduce the latest progress of Qwen-Audio, a large-scale audio-language model called Qwen2-Audio, which is capable of accepting various audio signal inputs and performing audio analysis or direct textual responses with regard to speech instructions. In contrast to complex hierarchical tags, we have simplified the pre-training process by utilizing natural language prompts for different data and tasks, and have further expanded the data volume. We have boosted the instruction-following capability of Qwen2-Audio and implemented two distinct audio interaction modes for voice chat and audio analysis. In the voice chat mode, users can freely engage in voice interactions with Qwen2-Audio without text input. In the audio analysis mode, users could provide audio and text instructions for analysis during the interaction. Note that we do not use any system prompts to switch between voice chat and audio analysis modes. Qwen2-Audio is capable of intelligently comprehending the content within audio and following voice commands to respond appropriately. For instance, in an audio segment that simultaneously contains sounds, multi-speaker conversations, and a voice command, Qwen2-Audio can directly understand the command and provide an interpretation and response to the audio. Additionally, DPO has optimized the model’s performance in terms of factuality and adherence to desired behavior. According to the evaluation results from AIR-Bench, Qwen2-Audio outperformed previous SOTAs, such as Gemini-1.5-pro, in tests focused on audio-centric instruction-following capabilities. Qwen2-Audio is open-sourced with the aim of fostering the advancement of the multi-modal language community.

## 1 Introduction

Audio serves as a crucial medium for interaction and communication among humans and other living beings, carrying rich information content. A comprehensive understanding of various forms of audio signals is paramount to achieving Artificial General Intelligence (AGI). Recently, significant advancements have been made in the development of large audio-language models (LALMs) (Chu et al., 2023; Das et al., 2024; Kong et al., 2024; Tang et al., 2024; OpenAI, 2024), demonstrating remarkable achievements in comprehending diverse speech signals, performing speech signal analysis, and complex reasoning.

In this report, we develop Qwen2-Audio, with a primary focus on enhancing its instruction-following capabilities. Qwen2-Audio is a Large Audio-Language Model (LALM) designed to process both audio and text inputs to generate textual outputs. Compared to previous models, Qwen2-Audio significantly scales up the training dataset. To reduce the gap between pre-training and post-training stages, we simplify the pre-training process by directly using natural language prompts for various data and tasks, as illustrated in figure 2. Following the practices in Large Language Models (LLMs) (OpenAI, 2023; Qwen, 2023), we further conduct instruction tuning and direct preference optimization to align the model’s outputs with human preferences.

![](./images/figure_01_benchmark_radar.jpg)

<details>
<summary>radar</summary>

| Model                  | Previous Top-tiers | Qwen-Audio | Qwen2-Audio |
| ---------------------- | ------------------ | ---------- | ----------- |
| Librispeech            | 94.0               | 96.0       | 96.0        |
| Aishell2               | 96.0               | 96.0       | 96.0        |
| CoVoST2                | 94.0               | 96.0       | 96.0        |
| Meld                   | 96.0               | 96.0       | 96.0        |
| VocalSound             | 94.0               | 96.0       | 96.0        |
| FLUERS-ZH              | 94.0               | 96.0       | 96.0        |
| AIR-Bench-Chat-Sound   | 94.0               | 96.0       | 96.0        |
| AIR-Bench-Chat-Music   | 94.0               | 96.0       | 96.0        |
| AIR-Bench-Chat-Mixed  | 94.0               | 96.0       | 96.0        |
</details>

Figure 1: Performance of Qwen2-Audio, Qwen-Audio and previous top-tiers from LALMs such as SpeechT5 (Ao et al., 2021), SpeechNet (Chen et al., 2021), SpeechLLaMA (Wu et al., 2023a), SALMONN (Tang et al., 2024), Whisper (Radford et al., 2023) Pengi (Deshmukh et al., 2023), and SpeechVerse (Das et al., 2024). We demonstrate the test set results across the 10 datasets covering Automatic Speech Recognition (ASR), Speech-to-Text Translation (S2TT), Speech Emotion Recognition (SER), Vocal Sound Classification (VSC), and instruction-following benchmark (Yang et al., 2024). The results of ASR datasets, such as Librispeech and Aishell2 refer to 1 - WER%. The results of CoVoST2 is the average BLEU score of seven translation directions (en-de, de-en, en-zh, zh-en, es-en, fr-en and it-en). The results of the AIR-Bench chat benchmark encompass four dimensions: speech, sound, music, and mixed. Scores for each dimension are automatically assessed by GPT-4, with values ranging from 0 to 10. Qwen2-Audio achieves remarkable performance without requiring any task-specific fine-tuning, surpassing its counterparts.

Qwen2-Audio operates in two distinct modes: Audio Analysis and Voice Chat. These two modes are differentiated by their functionality, but there is no need for users to distinguish between them during use. In the audio analysis mode, users can leverage Qwen2-Audio to analyze a diverse range of audio types, including speech, sound, music, or various mixed audio forms. Commands can be issued either through audio or text, and Qwen2-Audio will autonomously discern the command segments within the audio. Conversely, in voice chat mode, users can interact with Qwen2-Audio as if it were a conversational agent, engaging in unrestricted dialogue. Audio interaction is available, and users can switch to text interaction at any moment they choose. For instance, if a user inputs an audio clip where the initial part is the sound of typing on a keyboard, followed by the user asking "What is this sound?" in spoken language, Qwen2-Audio is expected to respond directly with "This is the sound of a keyboard."

As shown in Figure 1, extensive evaluation demonstrates that Qwen2-Audio, without any task-specific fine-tuning, outperforms previous LALMs across a diverse range of tasks. Among them, Qwen2-Audio achieves state-of-the-art performance on the test set of Aishell2, FLUERS-zh, VocalSound and AIR-Bench chat benchmark.

![](./images/figure_02_training_pipeline.jpg)

<details>
<summary>flowchart</summary>

Multi-task pre-training architecture flowchart integrating audio encoding, QwenLM, voice chat, and DPO components with feedback loops and preference scores.
</details>

Figure 2: The overview of three-stage training process of Qwen2-Audio.

## 2 Methodology

### 2.1 Model Architecture

The training process of Qwen2-Audio is depicted in Figure 2, which contains an audio encoder and a large language model. Given the paired data (a, x), where a and x denote the audio sequences and text sequences, the training objective is to maximize the next text token probability as

$$
\mathcal {P} _ {\theta} (x _ {t} | \boldsymbol {x} _ {<   t}, \text { Encoder } _ {\phi} (\boldsymbol {a})), \tag {1}
$$

conditioning on audio representations and previous text sequences $\boldsymbol{x}_{<t}$, where $\theta$ and $\phi$ denote the trainable parameters of the LLM and audio encoder respectively.

Different from Qwen-Audio, the initialization of the audio encoder of Qwen2-Audio is based on the Whisper-large-v3 model (Radford et al., 2023). To preprocess the audio data, we resample it to a frequency of 16 kHz and convert the raw waveform into a 128-channel mel-spectrogram using a window size of 25 ms and a hop size of 10 ms. Additionally, a pooling layer with a stride of two is incorporated to reduce the length of the audio representation. As a result, each frame of the encoder output approximately corresponds to a 40 ms segment of the original audio signal. Qwen2-Audio still incorporates the large language model Qwen-7B (Bai et al., 2023) as its foundational component. The total size of Qwen2-Audio is 8.2B parameters.

### 2.2 Pre-training

At the pre-training stage, we replace the hierarchical tags (Chu et al., 2023) with natural language prompts, as shown in Figure 2. We find that using language prompts can improve both generalization ability and instruction-following ability.

### 2.3 Supervised Fine-tuning

The thorough pre-training of Qwen2-Audio has equipped the model with a comprehensive understanding of audio content. Building upon this, we employ instruction-based fine-tuning techniques to improve the ability of the model to align with human intent, resulting in an interactive chat model. Our preliminary study emphasizes the critical influence of the quality and complexity of SFT data on the model's performance. Accordingly, a meticulously curated set of high-quality SFT data was collected, with rigorous quality control procedures implemented.

![](./images/chart_03_pretraining_hours.jpg)

<details>
<summary>bar</summary>

| Category | Value (k) |
|---|---|
| Speech | 370 |
| Sound | 10 |
| Music | 140 |
</details>

Figure 3: Statistics (hours) of pre-training dataset.

We consider two distinct modes for human interactions:

• Audio Analysis: In the audio analysis mode, users are afforded the flexibility to have Qwen2-Audio analyze a diverse array of audio. User instructions can be given either through audio or text. This mode is often used for offline analysis of audio files.

• Voice Chat: In the voice chat mode, users are encouraged to engage in voice conversations with Qwen2-Audio, asking a wide range of questions. Please feel free to consider it your voice chat assistant. This mode is often used for online interaction with LALMs.

For consistency and model uniformity, both interaction modes were jointly trained, thus users will not experience mode differentiation during use, nor is it necessary to switch between different modes using separate system prompts. The two modes are seamlessly integrated in actual use.

### 2.4 Direct Preference Optimization

We employ DPO (Rafailov et al., 2024) to further optimize models to follow human preferences. By obtaining the dataset $\mathcal{D}$ with the triplet data $(\boldsymbol{x}, \boldsymbol{y_w}, \boldsymbol{y_l})$, where x is the input sequence with input audio, and $\boldsymbol{y_w}$ and $\boldsymbol{y_l}$ are the human-annotated good and bad responses respectively, we optimize the model $\mathcal{P}_\theta$ as follows:

$$
\mathcal {L} _ {\mathrm{DPO}} \left(\mathcal {P} _ {\theta}; \mathcal {P} _ {\text { ref }}\right) = - \mathbb {E} _ {\left(\boldsymbol {x}, \boldsymbol {y} _ {\boldsymbol {w}}, \boldsymbol {y} _ {\boldsymbol {l}}\right) \sim \mathcal {D}} \left[ \log \sigma \left(\beta \log \frac {\mathcal {P} _ {\theta} \left(\boldsymbol {y} _ {\boldsymbol {w}} \mid \boldsymbol {x}\right)}{\mathcal {P} _ {\text { ref }} \left(\boldsymbol {y} _ {\boldsymbol {w}} \mid \boldsymbol {x}\right)} - \beta \log \frac {\mathcal {P} _ {\theta} \left(\boldsymbol {y} _ {\boldsymbol {l}} \mid \boldsymbol {x}\right)}{\mathcal {P} _ {\text { ref }} \left(\boldsymbol {y} _ {\boldsymbol {l}} \mid \boldsymbol {x}\right)}\right) \right], \tag {2}
$$

where $\mathcal { P } _ { \mathrm { r e f } }$ denotes the reference model initialized with $\mathcal { P } _ { \theta }$, $\sigma$ represents the sigmoid function and $\beta$ is a hyperparameter. Figure 2 illustrates the three-stage training process of Qwen2-Audio.

Table 1: Summary of Evaluation Benchmarks for Qwen2-Audio.

<table><tr><td>Task</td><td>Description</td><td>Dataset</td><td>Split</td><td>Metric</td></tr><tr><td>ASR</td><td>Automatic Speech Recognition</td><td>Fleurs (Conneau et al., 2022)Aishell2 (Du et al., 2018)Librispeech (Panayotov et al., 2015)Common Voice (Ardila et al., 2020)</td><td>dev | test testdev | testdev | test</td><td>WER</td></tr><tr><td>S2TT</td><td>Speech-to-Text Translation</td><td>CoVoST2 (Wang et al., 2020)</td><td>test</td><td>BLEU $^{1}$  (Papineni et al., 2002)</td></tr><tr><td>SER</td><td>Speech Emotion Recognition</td><td>Meld (Poria et al., 2019)</td><td>test</td><td>ACC</td></tr><tr><td>VSC</td><td>Vocal Sound Classification</td><td>VocalSound (Gong et al., 2022)</td><td>test</td><td>ACC</td></tr><tr><td rowspan="4">AIR-Bench (Yang et al., 2024)</td><td>Chat-Benchmark-Speech</td><td>Fisher (Cieri et al., 2004)SpokenWOZ (Si et al., 2023)IEMOCAP (Si et al., 2023)Common voice (Ardila et al., 2020)</td><td>dev | test</td><td>GPT-4 Eval</td></tr><tr><td>Chat-Benchmark-Sound</td><td>Clotho (Drossos et al., 2020)</td><td>dev | test</td><td>GPT-4 Eval</td></tr><tr><td>Chat-Benchmark-Music</td><td>MusicCaps (Agostinelli et al., 2023)</td><td>dev | test</td><td>GPT-4 Eval</td></tr><tr><td>Chat-Benchmark-Mixed-Audio</td><td>Common voice (Ardila et al., 2020)AudioCaps (Kim et al., 2019)MusicCaps (Agostinelli et al., 2023)</td><td>dev | test</td><td>GPT-4 Eval</td></tr></table>

## 3 Experiments

### 3.1 Evaluation

In practice, we have found that many previous test datasets are highly limited and cannot adequately reflect performance in real-world scenarios, such as some SLU (Spoken Language Understanding) and SER (Speech Emotion Recognition) datasets. Therefore, we mainly evaluated performance directly on AIR-Bench. We discovered that the scores from AIR-Bench align more closely with the actual user interaction experience. Meanwhile, in order to assess the universal understanding capabilities of Qwen2-Audio, as shown in Table 1, we still perform a comprehensive evaluation that encompasses various tasks, namely Automatic Speech Recognition (ASR), Speech-to-Text Translation (S2TT), Speech Emotion Recognition (SER), Vocal Sound Classification (VSC). The evaluation is conducted across 13 datasets. The evaluation datasets are rigorously excluded from the training data to avoid data leakage. The models we compare include open-source models and callable APIs, such as Gemini.

### 3.2 Main Results

In this section, we present a comprehensive evaluation of the Qwen2-Audio model, assessing its performance across various tasks without any task-specific fine-tuning. We begin by examining its English Automatic Speech Recognition (ASR) results, as depicted in Table 2, where Qwen2-Audio exhibits superior performance compared to previous multi-task learning models. Specifically, it achieves a 1.6% and 3.6% WER on the librispeech test-clean and test-other datasets, respectively. Compared with Whisper-large-v3 on Fleurs zh subset, we achieve better results than Whisper-large-v3. One point to note is that Qwen2-Audio is not evaluated in a zero-shot manner on the Common Voice 15 dataset, whereas Whisper’s results are obtained in a zero-shot fashion. However, on the Fleurs dataset, both Qwen2-Audio and Whisper are evaluated in a zero-shot manner. Furthermore, we evaluate Qwen2-Audio’s speech translation performance on the CoVoST2 dataset. The results reveal that Qwen2-Audio outperforms the baselines by a substantial margin across all seven translation directions. For sound, we analyze the performance of Qwen2-Audio on SER, and VSC, as summarized in Table 2. Across these tasks, Qwen2-Audio consistently outperforms the baselines by a significant margin.

Lastly, to objectively evaluate the chat capabilities of Qwen2-Audio, we measured its performance on the chat benchmark of the AIR-Bench (Yang et al., 2024). Note that since Gemini-1.5 (Reid et al., 2024)2 cannot correctly return some test samples due to its SAFETY reasons during testing, the number of samples of Gemini-1.5 on AIR-Bench-chat has been reduced by about 1/5. As shown in table 2, Qwen2-Audio demonstrates state-of-the-art (SOTA) instruction-following capabilities across speech, sound music and mixed-Audio subsets. It shows substantial improvements compared to Qwen-Audio and significantly outperforms other LALMs.

Table 2: The results of Automatic Speech Recognition (ASR), Speech-to-Text Translation (S2TT), Speech Emotion Recognition (SER), Vocal Sound Classification (VSC), and AIR-Bench chat benchmark. Note that for Qwen2-Audio, the results for Fleurs are zero-shot, whereas the results for Common Voice are not zero-shot.

<table><tr><td rowspan="2">Task</td><td rowspan="2">Dataset</td><td rowspan="2">Model</td><td colspan="2">Performance</td></tr><tr><td>Metrics</td><td>Results</td></tr><tr><td rowspan="4">ASR</td><td>Librispeechdev-clean | dev-other | test-clean | test-other</td><td>SpeechT5 (Ao et al., 2021)SpeechNet (Chen et al., 2021)SLM-FT (Wang et al., 2023b)SALMONN (Tang et al., 2024)SpeechVerse (Das et al., 2024)Qwen-Audio (Chu et al., 2023)Qwen2-Audio</td><td>WER ↓</td><td>2.1 | 5.5 | 2.4 | 5.8- | - | 30.7 | -- | - | 2.6 | 5.0- | - | 2.1 | 4.9- | - | 2.1 | 4.41.8 | 4.0 | 2.0 | 4.21.3 | 3.4 | 1.6 | 3.6</td></tr><tr><td>Common Voice 15en | zh | yue | fr</td><td>Whisper-large-v3 (Radford et al., 2023)Qwen2-Audio</td><td>WER ↓</td><td>9.3 | 12.8 | 10.9 | 10.88.6 | 6.9 | 5.9 | 9.6</td></tr><tr><td>Fleurszh</td><td>Whisper-large-v3 (Radford et al., 2023)Qwen2-Audio</td><td>WER ↓</td><td>7.77.5</td></tr><tr><td>Aishell2Mic | iOS | Android</td><td>MMSpeech-base (Zhou et al., 2022)Paraformer-large (Gao et al., 2023)Qwen-Audio (Chu et al., 2023)Qwen2-Audio</td><td>WER ↓</td><td>4.5 | 3.9 | 4.0- | 2.9 | -3.3 | 3.1 | 3.33.0 | 3.0 | 2.9</td></tr><tr><td rowspan="2">S2TT</td><td>CoVoST2en-de | de-en |en-zh | zh-en</td><td>SALMONN (Tang et al., 2024)SpeechLLaMA (Wu et al., 2023a)BLSP (Wang et al., 2023a)Qwen-Audio (Chu et al., 2023)Qwen2-Audio</td><td>BLEU ↑</td><td>18.6 | - | 33.1 | -- | 27.1 | - | 12.314.1 | - | - | -25.1 | 33.9 | 41.5 | 15.729.9 | 35.2 | 45.2 | 24.4</td></tr><tr><td>CoVoST2es-en | fr-en | it-en |</td><td>SpeechLLaMA (Wu et al., 2023a)Qwen-Audio (Chu et al., 2023)Qwen2-Audio</td><td>BLEU ↑</td><td>27.9 | 25.2 | 25.939.7 | 38.5 | 36.040.0 | 38.5 | 36.3</td></tr><tr><td>SER</td><td>Meld</td><td>WavLM-large (Chen et al., 2022)Qwen-Audio (Chu et al., 2023)Qwen2-Audio</td><td>ACC ↑</td><td>0.5420.5570.553</td></tr><tr><td>VSC</td><td>VocalSound</td><td>CLAP (Elizalde et al., 2022)Pengi (Deshmukh et al., 2023)Qwen-Audio (Chu et al., 2023)Qwen2-Audio</td><td>ACC ↑</td><td>0.49450.60350.92890.9392</td></tr><tr><td>AIR-Bench(Yang et al., 2024)</td><td>Chat BenchmarkSpeech | Sound |Music | Mixed-Audio</td><td>SALMONN (Tang et al., 2024)BLSP (Wang et al., 2023a)Pandagpt (Su et al., 2023)Macaw-LLM (Lyu et al., 2023)SpeechGPT (Zhang et al., 2023)Next-gpt (Wu et al., 2023b)Qwen-Audio (Chu et al., 2023)Gemini-1.5-pro (Reid et al., 2024)Qwen2-Audio</td><td>GPT-4 ↑</td><td>6.16 | 6.28 | 5.95 | 6.086.17 | 5.55 | 5.08 | 5.333.58 | 5.46 | 5.06 | 4.250.97 | 1.01 | 0.91 | 1.011.57 | 0.95 | 0.95 | 4.133.86 | 4.76 | 4.18 | 4.136.47 | 6.95 | 5.52 | 6.086.97 | 5.49 | 5.06 | 5.277.18 | 6.99 | 6.79 | 6.77</td></tr></table>

## 4 Cases

Here, we present a part of cases to illustrate Qwen2-Audio’s audio-based interaction capabilities. For more impressive examples, please refer to https://github.com/QwenLM/Qwen2-Audio.

![](./images/figure_04_voice_chat_case.jpg)

<details>
<summary>text_image</summary>

"I heard that you can understand what people say and even know their age and gender. So, can you guess my age and gender?"
0:00 / 0:07
Yes, the speaker is female and in her twenties.
"I have an exam coming up, but I'm not well prepared. I can't sleep well every night."
0:00 / 0:09
I'm sorry to hear that you're feeling stressed about your exam. It's completely normal to feel anxious when you're preparing for an important test. Here are some tips that might help you:
1. Start studying early: Don't leave everything until the last minute. Break up your study sessions into smaller chunks of time, and try to stick to a regular schedule.
2. Find a quiet place to study: A quiet environment can help you concentrate better. If possible, find a library or a study room where you can work without distractions.
3. Take breaks: It's important to take breaks during your study sessions. This will give your brain a chance to rest and recharge. Try taking short breaks every hour or so.
4. Get enough sleep: Lack of sleep can make it harder to focus and retain information. Make sure you're getting enough sleep each night, ideally around 7–8 hours.
5. Practice relaxation techniques: Deep breathing exercises, meditation, or yoga can all help you relax and reduce stress.
Remember, it's okay if you're not feeling well-prepared. Just do your best, and trust yourself. Good luck with your exam!
</details>

Figure 4: Example showing Qwen2-Audio’s capability in free chat around speech.

## 5 Conclusion

In this paper, we present Qwen2-Audio, which builds upon Qwen-Audio’s capability to analyze various types of audio while also being endowed with voice interaction abilities. During the pre-training stage, we utilized natural language prompts for different data and tasks and have further expanded the data volume. In the SFT phase, we enhanced Qwen2-Audio’s alignment with human interaction by increasing the quantity, quality, and complexity of SFT data, thereby enabling seamless voice and text interactions. Additionally, we improved Qwen2-Audio’s response quality through the DPO stage. Objective metrics tested on diverse benchmarks demonstrate Qwen2-Audio’s proficiency in audio understanding and dialogue capabilities. The cases presented within the paper also illustrate Qwen2-Audio’s fluent and flexible voice interaction capability.

![](./images/figure_05_speech_translation_case.jpg)

<details>
<summary>text_image</summary>

"Help me translate the sentence into Chinese. Everyone wants to be appreciated, so if you appreciate someone, don't keep it a secret."
▶ 0:00 / 0:07
每个人都希望被欣赏，所以如果你欣赏某人，不要把它保密。
"Translate it into German."
▶ 0:00 / 0:03
Jeder möchte geschätzt werden, also wenn du jemanden schätzt, lass es nicht als Geheimnis verbergen.
"How about into French?"
▶ 0:00 / 0:03
Chacun veut être apprécié, alors si tu apprécies quelqu'un, ne le gardes pas secret.
"给我生成一些类似这句话意思的，其他说法的句子，用中文生成."
▶ 0:00 / 0:05
1. 每个人都喜欢被赞美，所以如果你喜欢一个人，不要隐藏你的赞赏。
2. 所有人都渴望得到认可，因此如果你欣赏某人，请不要独自享用这种感觉。
3. 欣赏他人是一种美德，所以不要让别人知道你对他们的赞赏是秘密的。
4. 人们都希望受到赞扬，所以如果你欣赏某人，不妨公开表达出来。
5. 如果你喜欢某人，不要犹豫告诉他们，因为每个人都有权利享受他人的赞赏。
</details>

Figure 5: Example showing Qwen2-Audio’s capability in free chat around speech.

![](./images/figure_06_noise_and_nature_case.jpg)

<details>
<summary>text_image</summary>

(with renovation noise) "Oh no, how can I study quiet like this?"
▶ 0:00 / 0:05
Use headphones to block out external noise and find a quiet place to study.
Prioritize your tasks and set realistic goals for yourself. Use active learning
techniques such as summarizing, note-taking, and quizzing to help you
retain information. Take breaks and practice self-care to avoid burnout.
(with renovation noise) "In this situation, can I negotiate with them?"
▶ 0:00 / 0:05
Yes, you can try negotiating with them to reach a mutually beneficial
agreement. You could also consider seeking help from a mediator or
professional negotiator if needed.
(雨声)“哎呀，真喜欢在这种场景下睡觉啊睡的真香，你能猜猜为什么我喜欢在这种场景
下睡觉吗？”
▶ 0:00 / 0:07
因为这种场景让你感到放松和舒适，有助于提高睡眠质量。
</details>

Figure 6: Example showing Qwen2-Audio’s capability in free chat around speech and nature sound.

![](./images/figure_07_speech_analysis_case.jpg)

<details>
<summary>text_image</summary>

"Please transcribe the content of the next audio clip."
(Then a piece of audio is played)

The original content of this audio is: 'Stop all the clocks, cut off the telephone, prevent the dog from barking, silence the pianos and with muffled drum bring out the coffin, let the mourners come.'

No less than 50 words and no more than 200 words, add scenes such as rain and thunder to the poem. Finally, give the verses you created in lines.

In the midst of an eerie stormy night, With raindrops falling heavy and bright, The world seemed to hush its voice, As winds howled through the darkened space.
Stop all the clocks, the time stood still, As the lightning flashed through the sky, The telephone's ring was drowned out, By the roaring thunder that shook the ground.
Prevent the dog from barking, its cries were silenced, By the fear that gripped it in the night, Silence the pianos, their keys were muted, As the mournful sound of raindrops beat on wood.
With muffled drums, a slow march began, A solemn procession through the storm, The coffin was carried, heavy and solemn, Let the mourners come, to pay their final respects.
As the storm slowly passed, the world emerged, A new day dawned, but memories lingered, Of the night when time stood still, And the mourners came, to say goodbye.
</details>

Figure 7: Example showing Qwen2-Audio’s capability in speech analysis.

![](./images/figure_08_sound_analysis_case.jpg)

<details>
<summary>text_image</summary>

What do you hear?
I heard the sound of an alarm and a truck's air brake mixed with the noise of a heavy engine running and shifting gears.
Under what circumstances can you hear such sounds?
These types of sounds might be commonly heard in industrial settings like construction sites or factories where machinery is operated, or during emergency situations like traffic accidents where sirens are triggered.
"I am so scared! What should I do?"
It's understandable to feel scared under any situation that makes you feel uncomfortable. It's important to remember that it's okay to be scared. Here are some things you can do:
1. Take deep breaths: Inhale deeply through your nose and exhale slowly through your mouth. This can help calm your mind and body.
2. Find a safe place: If possible, move to a safe location away from the source of the fear. If you're in a car, pull over to a parking lot or a safe spot on the side of the road.
3. Stay informed: If you have access to information about the situation, stay informed but don't overdo it. Too much information can create more anxiety.
4. Talk to someone: Talking to someone you trust can help you process your feelings and gain perspective. You can call a friend, family member, or even a professional counselor if needed.
5. Practice relaxation techniques: Listening to music, doing yoga or meditation, or engaging in other relaxing activities can help reduce stress and anxiety.
Remember, it's okay to take time for yourself to process your emotions and come up with a plan that works best for you.
</details>

Figure 8: Example showing Qwen2-Audio’s capability in sound analysis.

![](./images/figure_09_music_analysis_case.jpg)

<details>
<summary>text_image</summary>

(play a piece of music without asking anything)
► 0:00 / 0:30
This is a pop punk music piece. There is a male vocalist singing melodically in the lead. The tune is being played by the guitar with the bass guitar playing in the background. The rhythmic background consists of loud and aggressive sounding drums. The atmosphere is rebellious. This piece could be used in the soundtrack of a high school drama movie or TV show during scenes where the characters are rebelling against authority.
"What's the tempo of this music?"
► 0:00 / 0:03
The tempo of this music is 104.17 bpm.
"What's the time signature of this music"
► 0:00 / 0:03
The time signature of this music is 4/4.
"What's the key of this music"
► 0:00 / 0:03
The key of this music piece is F# major.
</details>

Figure 9: Example showing Qwen2-Audio’s capability in music analysis.

![](./images/figure_10_mixed_audio_case.jpg)

<details>
<summary>text_image</summary>

"What are the lyrics of the singing?"
(Then a song is played.)
0:00 / 0:20
The lyrics are 'Waiting for my favorite song.'
"What are the lyrics of the singing?"
(Then a song mixed with a sound is played.
0:00 / 0:20
The lyrics are 'Waiting for my favorite song.'
"What are the lyrics of the singing?"
(Then a song mixed with a speech(man speaking) is played.
0:00 / 0:20
The lyrics are 'Waiting for my favorite song.'
"What does the person say?"
(Then a speech is played.
0:00 / 0:10
The old man laid down his hand to light a cigar.
"What does the person say?"
(Then a speech mixed with a music is played.
0:00 / 0:10
The old man laid down his hand to light a cigar.
"What does the person say?"
(Then a speech mixed with a sound is played.
0:00 / 0:10
The old man laid down his hand to light a cigar.
</details>

Figure 10: Example showing Qwen2-Audio’s robustness in mixed audio analysis.

## 6 Acknowledgements

We express our gratitude to Jinze Bai, Shuai Bai, Peng Wang, Sinan Tan, Shijie Wang, Kai Dang for their insightful discussion.

## References

Andrea Agostinelli, Timo I Denk, Zalán Borsos, Jesse Engel, Mauro Verzetti, Antoine Caillon, Qingqing Huang, Aren Jansen, Adam Roberts, Marco Tagliasacchi, et al. Musiclm: Generating music from text. arXiv preprint arXiv:2301.11325, 2023.
Junyi Ao, Rui Wang, Long Zhou, Chengyi Wang, Shuo Ren, Yu Wu, Shujie Liu, Tom Ko, Qing Li, Yu Zhang, et al. Speecht5: Unified-modal encoder-decoder pre-training for spoken language processing. arXiv:2110.07205, 2021.
R. Ardila, M. Branson, K. Davis, M. Henretty, M. Kohler, J. Meyer, R. Morais, L. Saunders, F. M. Tyers, and G. Weber. Common voice: A massively-multilingual speech corpus. In Proceedings of the 12th Conference on Language Resources and Evaluation (LREC 2020), pages 4211–4215, 2020.
Jinze Bai, Shuai Bai, Yunfei Chu, Zeyu Cui, Kai Dang, Xiaodong Deng, Yang Fan, Wenbin Ge, Yu Han, Fei Huang, et al. Qwen technical report. arXiv preprint arXiv:2309.16609, 2023.
Sanyuan Chen, Chengyi Wang, Zhengyang Chen, Yu Wu, Shujie Liu, Zhuo Chen, Jinyu Li, Naoyuki Kanda, Takuya Yoshioka, Xiong Xiao, Jian Wu, Long Zhou, Shuo Ren, Yanmin Qian, Yao Qian, Jian Wu, Michael Zeng, Xiangzhan Yu, and Furu Wei. Wavlm: Large-scale self-supervised pre-training for full stack speech processing. IEEE J. Sel. Top. Signal Process., 2022.
Yi-Chen Chen, Po-Han Chi, Shu-wen Yang, Kai-Wei Chang, Jheng-hao Lin, Sung-Feng Huang, Da-Rong Liu, Chi-Liang Liu, Cheng-Kuang Lee, and Hung-yi Lee. Speechnet: A universal modularized model for speech processing tasks. arXiv:2105.03070, 2021.
Yunfei Chu, Jin Xu, Xiaohuan Zhou, Qian Yang, Shiliang Zhang, Zhijie Yan, Chang Zhou, and Jingren Zhou. Qwen-audio: Advancing universal audio understanding via unified large-scale audio-language models. arXiv preprint arXiv:2311.07919, 2023.
Christopher Cieri, David Miller, and Kevin Walker. The fisher corpus: A resource for the next generations of speech-to-text. In LREC, volume 4, pages 69–71, 2004.
Alexis Conneau, Min Ma, Simran Khanuja, Yu Zhang, Vera Axelrod, Siddharth Dalmia, Jason Riesa, Clara Rivera, and Ankur Bapna. Fleurs: Few-shot learning evaluation of universal representations of speech. 2022 IEEE Spoken Language Technology Workshop (SLT), pages 798–805, 2022. URL https: //api.semanticscholar.org/CorpusID:249062909.
Nilaksh Das, Saket Dingliwal, Srikanth Ronanki, Rohit Paturi, David Huang, Prashant Mathur, Jie Yuan, Dhanush Bekal, Xing Niu, Sai Muralidhar Jayanthi, et al. Speechverse: A large-scale generalizable audio language model. arXiv preprint arXiv:2405.08295, 2024.
Soham Deshmukh, Benjamin Elizalde, Rita Singh, and Huaming Wang. Pengi: An audio language model for audio tasks. CoRR, 2023.
Konstantinos Drossos, Samuel Lipping, and Tuomas Virtanen. Clotho: an audio captioning dataset. In 2020 IEEE International Conference on Acoustics, Speech and Signal Processing, ICASSP 2020, Barcelona, Spain, May 4-8, 2020. IEEE, 2020.
Jiayu Du, Xingyu Na, Xuechen Liu, and Hui Bu. AISHELL-2: transforming mandarin ASR research into industrial scale. abs/1808.10583, 2018.

Benjamin Elizalde, Soham Deshmukh, Mahmoud Al Ismail, and Huaming Wang. CLAP: learning audio concepts from natural language supervision. abs/2206.04769, 2022.
Zhifu Gao, Zerui Li, Jiaming Wang, Haoneng Luo, Xian Shi, Mengzhe Chen, Yabin Li, Lingyun Zuo, Zhihao Du, Zhangyu Xiao, and Shiliang Zhang. Funasr: A fundamental end-to-end speech recognition toolkit. CoRR, abs/2305.11013, 2023.
Yuan Gong, Jin Yu, and James R. Glass. Vocalsound: A dataset for improving human vocal sounds recognition. In IEEE International Conference on Acoustics, Speech and Signal Processing, ICASSP 2022, Virtual and Singapore, 23-27 May 2022, pages 151–155. IEEE, 2022. doi: 10.1109/ICASSP43922.2022.9746828. URL https://doi. org/10.1109/ICASSP43922.2022.9746828.
Chris Dongjoo Kim, Byeongchang Kim, Hyunmin Lee, and Gunhee Kim. Audiocaps: Generating captions for audios in the wild. In Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, Volume 1 (Long and Short Papers), 2019.
Zhifeng Kong, Arushi Goel, Rohan Badlani, Wei Ping, Rafael Valle, and Bryan Catanzaro. Audio flamingo: A novel audio language model with few-shot learning and dialogue abilities. arXiv preprint arXiv:2402.01831, 2024.
Chenyang Lyu, Minghao Wu, Longyue Wang, Xinting Huang, Bingshuai Liu, Zefeng Du, Shuming Shi, and Zhaopeng Tu. Macaw-llm: Multi-modal language modeling with image, audio, video, and text integration. CoRR, abs/2306.09093, 2023.
OpenAI. Gpt-4 technical report, 2023.
OpenAI. Gpt-4o, 2024. URL https://openai.com/index/hello-gpt-4o/.
Vassil Panayotov, Guoguo Chen, Daniel Povey, and Sanjeev Khudanpur. Librispeech: An ASR corpus based on public domain audio books. In 2015 IEEE International Conference on Acoustics, Speech and Signal Processing, ICASSP 2015, South Brisbane, Queensland, Australia, April 19-24, 2015. IEEE, 2015.
Kishore Papineni, Salim Roukos, Todd Ward, and Wei-Jing Zhu. Bleu: a method for automatic evaluation of machine translation. In Proceedings of the 40th annual meeting of the Association for Computational Linguistics, 2002.
Soujanya Poria, Devamanyu Hazarika, Navonil Majumder, Gautam Naik, Erik Cambria, and Rada Mihalcea. MELD: A multimodal multi-party dataset for emotion recognition in conversations. In Proceedings of the 57th Conference of the Association for Computational Linguistics, ACL 2019, Florence, Italy, July 28- August 2, 2019, Volume 1: Long Papers. Association for Computational Linguistics, 2019.
Qwen. Introducing qwen-7b: Open foundation and human-aligned models (of the state-of-the-arts), 2023. URL https://github.com/QwenLM/Qwen-7B.
Alec Radford, Jong Wook Kim, Tao Xu, Greg Brockman, Christine McLeavey, and Ilya Sutskever. Robust speech recognition via large-scale weak supervision. In International Conference on Machine Learning, ICML 2023, 23-29 July 2023, Honolulu, Hawaii, USA, 2023.
Rafael Rafailov, Archit Sharma, Eric Mitchell, Christopher D Manning, Stefano Ermon, and Chelsea Finn. Direct preference optimization: Your language model is secretly a reward model. Advances in Neural Information Processing Systems, 36, 2024.
Machel Reid, Nikolay Savinov, Denis Teplyashin, Dmitry Lepikhin, Timothy Lillicrap, Jean-baptiste Alayrac, Radu Soricut, Angeliki Lazaridou, Orhan Firat, Julian Schrittwieser, et al. Gemini 1.5: Unlocking multimodal understanding across millions of tokens of context. arXiv preprint arXiv:2403.05530, 2024.
Shuzheng Si, Wentao Ma, Yuchuan Wu, Yinpei Dai, Haoyu Gao, Ting-En Lin, Hangyu Li, Rui Yan, Fei Huang, and Yongbin Li. Spokenwoz: A large-scale speech-text benchmark for spoken task-oriented dialogue in multiple domains. arXiv preprint arXiv:2305.13040, 2023.

Yixuan Su, Tian Lan, Huayang Li, Jialu Xu, Yan Wang, and Deng Cai. Pandagpt: One model to instructionfollow them all. arXiv:2305.16355, 2023.
Changli Tang, Wenyi Yu, Guangzhi Sun, Xianzhao Chen, Tian Tan, Wei Li, Lu Lu, Zejun MA, and Chao Zhang. SALMONN: Towards generic hearing abilities for large language models. In The Twelfth International Conference on Learning Representations, 2024. URL https://openreview.net/forum?id=14rn7HpKVk.
Changhan Wang, Anne Wu, and Juan Miguel Pino. Covost 2: A massively multilingual speech-to-text translation corpus. abs/2007.10310, 2020. URL https://arxiv.org/abs/2007.10310.
Chen Wang, Minpeng Liao, Zhongqiang Huang, Jinliang Lu, Junhong Wu, Yuchen Liu, Chengqing Zong, and Jiajun Zhang. Blsp: Bootstrapping language-speech pre-training via behavior alignment of continuation writing. arXiv:2309.00916, 2023a.
Mingqiu Wang, Wei Han, Izhak Shafran, Zelin Wu, Chung-Cheng Chiu, Yuan Cao, Yongqiang Wang, Nanxin Chen, Yu Zhang, Hagen Soltau, Paul K. Rubenstein, Lukas Zilka, Dian Yu, Zhong Meng, Golan Pundak, Nikhil Siddhartha, Johan Schalkwyk, and Yonghui Wu. SLM: bridge the thin gap between speech and text foundation models. abs/2310.00230, 2023b.
Jian Wu, Yashesh Gaur, Zhuo Chen, Long Zhou, Yimeng Zhu, Tianrui Wang, Jinyu Li, Shujie Liu, Bo Ren, Linquan Liu, and Yu Wu. On decoder-only architecture for speech-to-text and large language model integration. abs/2307.03917, 2023a.
Shengqiong Wu, Hao Fei, Leigang Qu, Wei Ji, and Tat-Seng Chua. Next-gpt: Any-to-any multimodal LLM. CoRR, abs/2309.05519, 2023b.
Qian Yang, Jin Xu, Wenrui Liu, Yunfei Chu, Ziyue Jiang, Xiaohuan Zhou, Yichong Leng, Yuanjun Lv, Zhou Zhao, Chang Zhou, and Jingren Zhou. Air-bench: Benchmarking large audio-language models via generative comprehension. In ACL, 2024.
Dong Zhang, Shimin Li, Xin Zhang, Jun Zhan, Pengyu Wang, Yaqian Zhou, and Xipeng Qiu. Speechgpt: Empowering large language models with intrinsic cross-modal conversational abilities. CoRR, abs/2305.11000, 2023.
Xiaohuan Zhou, Jiaming Wang, Zeyu Cui, Shiliang Zhang, Zhijie Yan, Jingren Zhou, and Chang Zhou. Mmspeech: Multi-modal multi-task encoder-decoder pre-training for speech recognition. abs/2212.00500, 2022.
