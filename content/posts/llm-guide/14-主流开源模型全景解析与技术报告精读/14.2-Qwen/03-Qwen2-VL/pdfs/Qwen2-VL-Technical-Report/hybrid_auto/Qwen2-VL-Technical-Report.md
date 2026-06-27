# Qwen2-VL: Enhancing Vision-Language Model’s Perception of the World at Any Resolution

Peng Wang\* Shuai Bai\* Sinan Tan\* Shijie Wang\* Zhihao Fan\* Jinze Bai\*† Keqin Chen Xuejing Liu Jialin Wang Wenbin Ge Yang Fan Kai Dang Mengfei Du Xuancheng Ren Rui Men Dayiheng Liu Chang Zhou Jingren Zhou Junyang Lin† Qwen Team Alibaba Group

# Abstract

We present the Qwen2-VL Series, an advanced upgrade of the previous Qwen-VL models that redefines the conventional predetermined-resolution approach in visual processing. Qwen2-VL introduces the Naive Dynamic Resolution mechanism, which enables the model to dynamically process images of varying resolutions into different numbers of visual tokens. This approach allows the model to generate more efficient and accurate visual representations, closely aligning with human perceptual processes. The model also integrates Multimodal Rotary Position Embedding (M-RoPE), facilitating the effective fusion of positional information across text, images, and videos. We employ a unified paradigm for processing both images and videos, enhancing the model’s visual perception capabilities. To explore the potential of large multimodal models, Qwen2-VL investigates the scaling laws for large vision-language models (LVLMs). By scaling both the model size-with versions at 2B, 8B, and 72B parameters-and the amount of training data, the Qwen2-VL Series achieves highly competitive performance. Notably, the Qwen2-VL-72B model achieves results comparable to leading models such as GPT-4o and Claude3.5- Sonnet across various multimodal benchmarks, outperforming other generalist models. Code is available at https://github.com/QwenLM/Qwen2-VL.

# 1 Introduction

In the realm of artificial intelligence, Large Vision-Language Models (LVLMs) represent a significant leap forward, building upon the strong textual processing capabilities of traditional large language models. These advanced models now encompass the ability to interpret and analyze a broader spectrum of data, including images, audio, and video. This expansion of capabilities has transformed LVLMs into indispensable tools for tackling a variety of real-world challenges. Recognized for their unique capacity to condense extensive and intricate knowledge into functional representations, LVLMs are paving the way for more comprehensive cognitive systems. By integrating diverse data forms, LVLMs aim to more closely mimic the nuanced ways in which humans perceive and interact with their environment. This allows these models to provide a more accurate representation of how we engage with and perceive our environment

Recent advancements in large vision-language models (LVLMs) (Li et al., 2023c; Liu et al., 2023b; Dai et al., 2023; Zhu et al., 2023; Huang et al., 2023a; Bai et al., 2023b; Liu et al., 2023a; Wang et al., 2023b; OpenAI., 2023; Team et al., 2023) have led to significant improvements in a short span. These models (OpenAI, 2023; Touvron et al., 2023a,b; Chiang et al., 2023; Bai et al., 2023a) generally follow a common approach of visual encoder→cross-modal connector→LLM. This setup, combined with next-token prediction as the primary training method and the availability of high-quality datasets (Liu et al., 2023a; Zhang et al., 2023; Chen et al., 2023b;

![](images/aa33ff2bb6839e99681472286132bdebc531c3c4a7c66caec8f0c1a1fd859a92.jpg)

<details>
<summary>flowchart</summary>

System architecture flowchart for Qwen2-VL, covering General Chat, Video Understanding, Grounding, Multilingual OCR, and UI Interaction components.
</details>

Figure 1: Qwen2-VL capabilities: Multilingual image text understanding, code/math reasoning, video analysis, live chat, agent potential, and more. See Appendix for details.

Li et al., 2023b), has driven much of the progress. Additional factors like larger model architectures (Alayrac et al., 2022), higher-resolution images (Li et al., 2023a,d), and advanced techniques such as mixture-ofexpert models (MoE) (Wang et al., 2023b; Ye et al., 2023b), model ensembles (Lin et al., 2023), and more sophisticated connectors (Ye et al., 2023a) between visual and textual modalities have also played a key role in enhancing LVLMs’ ability to process complex visual and textual information more effectively.

However, current large vision-language models (LVLMs) are typically constrained by a fixed image input size. Standard LVLMs encode input images to a fixed resolution (e.g., 224×224), often by either downsampling or upsampling the images (Zhu et al., 2023; Huang et al., 2023a), or by employing a scale-then-padding approach (Liu et al., 2023b,a). While this one-size-fits-all strategy enables processing of images at consistent resolutions, it also limits the model’s ability to capture information at different scales, particularly leading to a significant loss of detailed information in high-resolution images. Consequently, such models fall short of perceiving visual information with the same sensitivity to scale and detail as human vision.

Additionally, most LVLMs rely on a static, frozen CLIP-style (Radford et al., 2021) vision encoder, raising concerns about whether the visual representations produced by such pre-trained models are adequate, particularly for complex reasoning tasks and processing intricate details within images. Recent works (Bai et al., 2023b; Ye et al., 2023a) have attempted to address these limitations by fine-tuning the vision transformer (ViT) during the LVLM training process, which has shown to yield improved results. To further enhance the model’s adaptability to varying resolutions, we introduce dynamic resolution training in the LVLM training process. Specifically, we employ a 2D Rotary Position Embedding (RoPE) in the ViT, thus allowing the model to better capture information across different spatial scales.

When it comes to video content, which is essentially a sequence of frames, many existing models continue to treat it as an independent modality. However, understanding the dynamic nature of reality, as manifested in videos, is crucial for models aiming to grasp the complexities of the real world. Unlike text, which is inherently one-dimensional, the real-world environment exists in three dimensions. The use of one-dimensional position embeddings in current models significantly limits their ability to model three-dimensional space and temporal dynamics effectively. To bridge this gap, we have developed Multimodal Rotary Position Embedding (M-

Table 1: Model descriptions of Qwen2-VL. 

<table><tr><td>Model Name</td><td>Vision Encoder</td><td>LLM</td><td>Model Description</td></tr><tr><td>Qwen2-VL-2B</td><td>675M</td><td>1.5B</td><td>The most efficient model, designed to run on-device. It delivers adequate performance for most scenarios with limited resources.</td></tr><tr><td>Qwen2-VL-7B</td><td>675M</td><td>7.6B</td><td>The performance-optimized model in terms of cost, significantly upgraded for text recognition and video understanding capabilities. It delivers significant performance across a broad range of visual tasks.</td></tr><tr><td>Qwen2-VL-72B</td><td>675M</td><td>72B</td><td>The most capable model, further improvements in visual reasoning, instruction-following, decision-making, and agent capabilities. It delivers optimal performance on most complex tasks.</td></tr></table>

RoPE), which employs separate components to represent temporal and spatial information. This enables the model to naturally comprehend dynamic content, such as videos or streaming data, improving its ability to understand and interact with the world.

Furthermore, compared to the scaling of large language models (LLMs), current LVLMs are still in the early stages of exploring the impact of scaling in terms of training data and model parameters. The exploration of scaling laws for LVLMs—how increases in model and data size affect performance—remains an open and promising area of research.

In this work, we introduce the newest addition to the large vision-language models of the Qwen family: Qwen2-VL series, which comprises three open-weight models with total parameter counts of 2 billion, 8 billion, and 72 billion. As shown in Figure 1, the key advances in Qwen2-VL include:

• State-of-the-art understanding across various resolutions and aspect ratios: Qwen2-VL achieves leading performance on visual benchmarks, including DocVQA, InfoVQA, RealWorldQA, MTVQA, MathVista, and others.   
• Comprehension of extended-duration videos (20 min+): Qwen2-VL is capable of understanding videos over 20 minutes in length, enhancing its ability to perform high-quality video-based question answering, dialogue, content creation, and more.   
• Robust agent capabilities for device operation: With advanced reasoning and decision-making abilities, Qwen2-VL can be integrated with devices such as mobile phones, robots, etc., enabling autonomous operation based on visual inputs and text instructions.   
• Multilingual support: To serve a global audience, beyond English and Chinese, Qwen2-VL now supports multilingual context understanding within images, including most European languages, Japanese, Korean, Arabic, Vietnamese, and others.

# 2 Approach

The Qwen2-VL series consists of models of 3 sizes, which are Qwen2-VL-2B, Qwen2-VL-7B and Qwen2-VL-72B. Table 1 lists the hyper-parameters and important information. Notably, Qwen2-VL employs a 675M parameter ViT across various-sized LLMs, ensuring that the computational load of the ViT remains constant regardless of the scale of the LLM.

# 2.1 Model Architecture

Figure 2 illustrates the comprehensive structure of Qwen2-VL. We have retained the Qwen-VL (Bai et al., 2023b) framework, which integrates vision encoders and language models. For various scale adaptations, we have implemented a Vision Transformer (ViT) (Dosovitskiy et al., 2021) with approximately 675 million parameters, adept at handling both image and video inputs. In terms of language processing, we have opted for the more powerful Qwen2 (Yang et al., 2024) series of language models. To further enhance the model’s ability to effectively perceive and comprehend visual information in videos, we introduced several key upgrades:

![](images/6c2276e9cbe2239b85f8ddbb60db1e1f579a38a4dd21dfbd7f9391cabb1461bc.jpg)

<details>
<summary>flowchart</summary>

QwenLM Decoder architecture diagram showing image processing, video encoding, and spatial dimensions for Picture 1, Video 1, and Picture 2 components.
</details>

Figure 2: Qwen2-VL is capable of accurately identifying and comprehending the content within images, regardless of their clarity, resolution, or extreme aspect ratios.

Naive Dynamic Resolution A key architectural improvement in Qwen2-VL is the introduction of naive dynamic resolution support (Dehghani et al., 2024). Unlike Qwen-VL, Qwen2-VL can now process images of any resolution, dynamically converting them into a variable number of visual tokens.1 To support this feature, we modified ViT by removing the original absolute position embeddings and introducing 2D-RoPE (Su et al., 2024; Su, 2021) to capture the two-dimensional positional information of images. At the inference stage, images of varying resolutions are packed into a single sequence, with the packed length controlled to limit GPU memory usage. Furthermore, to reduce the visual tokens of each image, a simple MLP layer is employed after the ViT to compress adjacent 2 × 2 tokens into a single token, with the special <|vision\_start|> and <|vision\_end|> tokens placed at the beginning and end of the compressed visual tokens. As a result, an image with a resolution of 224 × 224, encoded with a ViT using patch\_size=14, will be compressed to 66 tokens before entering LLM.

Multimodal Rotary Position Embedding (M-RoPE) Another key architectural enhancement is the innovation of Multimodal Rotary Position Embedding (M-RoPE). Unlike the traditional 1D-RoPE in LLMs, which is limited to encoding one-dimensional positional information, M-RoPE effectively models the positional information of multimodal inputs. This is achieved by deconstructing the original rotary embedding into three components: temporal, height, and width. For text inputs, these components utilize identical position IDs, making M-RoPE functionally equivalent to 1D-RoPE (Su, 2024). When processing images, the temporal IDs of each visual token remain constant, while distinct IDs are assigned to the height and width components based on the token’s position in the image. For videos, which are treated as sequences of frames, the temporal ID increments for each frame, while the height and width components follow the same ID assignment pattern as images. In scenarios where the model’s input encompasses multiple modalities, position numbering for each modality is initialized by incrementing the maximum position ID of the preceding modality by one. An illustration of M-RoPE is shown in Figure 3. M-RoPE not only enhances the modeling of positional information but also reduces the value of position IDs for images and videos, enabling the model to extrapolate to longer sequences during inference.

![](images/1ceded3f1ab8757cef2752dae0e8c58a92b108784d647b2f861bba331708c869.jpg)

<details>
<summary>text_image</summary>

Position ids:
Height
Width
(2, 0, 0)
(2, 0, 1)
(2, 0, 2)
(2, 0, 3)
(1, 0, 0)
(1, 0, 1)
(1, 0, 2)
(1, 0, 3)
(2, 1, 3)
(2, 2, 3)
(0, 0, 0)
(0, 0, 1)
(0, 0, 2)
(0, 0, 3)
(1, 1, 3)
(1, 2, 3)
(0, 1, 0)
(0, 1, 1)
(0, 1, 2)
(0, 1, 3)
(0, 2, 0)
(0, 2, 1)
(0, 2, 2)
(0, 2, 3)
</details>

This video features a dog, specifically a Shiba (4, 4, 4) (5, 5, 5) (6, 6, 6) (7.7 7)(8 8 8)0 9 9) (10,10,10) (u1 11, u)(12, 12, 12)   
![](images/51b9bc483ecdabd7599d69f1c0b5eea4b6aae9a5f82e9cf7944d7d66003d6cd0.jpg)

<details>
<summary>text_image</summary>

Multimodal Rotary Position Embedding
( Time - height + width )
</details>

Itimodal Rotary Position Embedding (M-RoPE)   
Figure 3: A demonstration of M-RoPE. By decomposing rotary embedding into temporal, height, and width components, M-RoPE can explicitly model the positional information of text, images, and video in LLM.

Unified Image and Video Understanding Qwen2-VL employs a mixed training regimen incorporating both image and video data, ensuring proficiency in image understanding and video comprehension. To preserve video information as completely as possible, we sampled each video at two frames per second. Additionally, we integrated 3D convolutions (Carreira and Zisserman, 2017) with a depth of two to process video inputs, allowing the model to handle 3D tubes instead of 2D patches, thus enabling it to process more video frames without increasing the sequence length (Arnab et al., 2021). For consistency, each image is treated as two identical frames. To balance the computational demands of long video processing with overall training efficiency, we dynamically adjust the resolution of each video frame, limiting the total number of tokens per video to 16384. This training approach strikes a balance between the model’s ability to comprehend long videos and training efficiency.

# 2.2 Training

Following Qwen-VL (Bai et al., 2023b), we adopt a three-stage training methodology. In the first stage, we focus exclusively on training the Vision Transformer (ViT) component, utilizing a vast corpus of image-text pairs to enhance semantic understanding within the Large Language Model (LLM). In the second stage, we unfreeze all parameters and train with a wider range of data for more comprehensive learning. In the final stage, we lock the ViT parameters and perform exclusive fine-tuning of the LLM using instructional datasets.

The model is pre-trained on a diverse dataset that includes image-text pairs, optical character recognition (OCR) data, interleaved image-text articles, visual question answering datasets, video dialogues, and image knowledge datasets. Our data sources primarily comprise cleaned web pages, open-source datasets, and synthetic data. The cutoff date for our data knowledge is June 2023. This diverse data composition is instrumental in developing a robust multimodal understanding capability.

During the initial pre-training phase, Qwen2-VL is exposed to a corpus of around 600 billion tokens. The LLM component of Qwen2-VL is initialized using the parameters from Qwen2 (Yang et al., 2024), while the vision encoder of Qwen2-VL is initialized with the ViT derived from DFN. However, the fixed position embedding in the original DFN’s ViT (Fang et al., 2023) is replaced by RoPE-2D. This pre-training phase primarily focuses on learning image-text relationships, textual content recognition within images through OCR, and image classification tasks. Such foundational training is instrumental in enabling the model to develop a robust understanding of core visual-textual correlations and alignments.

The second pre-training phase marks a significant progression, involving an additional 800 billion tokens of image-related data. This stage introduces a higher volume of mixed image-text content, facilitating a more nuanced understanding of the interplay between visual and textual information. The incorporation of visual question answering datasets refines the model’s capacity to respond to image-related queries. Moreover, the inclusion of multitasking datasets is pivotal in developing the model’s ability to navigate diverse tasks concurrently, a skill of paramount importance when dealing with complex, real-world datasets. Concurrently, purely textual data continues to play a crucial role in maintaining and advancing the model’s linguistic proficiency.

Throughout the pre-training stages, Qwen2-VL processes a cumulative total of 1.4 trillion tokens. Specifically, these tokens encompass not only text tokens but also image tokens. During the training process, however, we only provide supervision for the text tokens. This exposure to extensive and diverse linguistic and visual scenarios ensures that the model develops a deep understanding of the intricate relationships between visual and textual information, thereby laying a robust foundation for various multimodal tasks.

During the instruction fine-tuning phase, we employ the ChatML (Openai, 2024) format to construct instruction-following data. This dataset encompasses not only pure text-based dialogue data but also multimodal conversational data. The multimodal components include image question-answering, document parsing, multi-image comparison, video comprehension, video stream dialogue, and agent-based interactions. Our comprehensive approach to data construction aims to enhance the model’s capability to understand and execute a wide range of instructions across various modalities. By incorporating diverse data types, we seek to develop a more versatile and robust language model capable of handling complex, multimodal tasks in addition to traditional text-based interactions.

# 2.2.1 Data Format.

In line with Qwen-VL, Qwen2-VL also employs special tokens to distinguish vision and text inputs. Tokens <|vision\_start|> and <|vision\_end|> are inserted at the start and end of the image feature sequence to demarcate the image content.

Dialogue Data. In terms of dialogue format, we construct our instruction tuning dataset using the ChatML format, where each interaction’s statement is marked with two special tokens (<|im\_start|> and <|im\_end|>) to facilitate dialogue termination. The sections marked in blue indicate the supervised parts.

The Dataset Format Example of ChatML   
```txt
<|im_start|>user
<|vision_start|>Picture1.jpg<|vision_end|><|vision_start|>Picture2.jpg<|vision_end|>What do the two pictures have in common?<|im_end|>
<|im_start|>assistant
Both pictures are of SpongeBob SquarePants. <|im_end|>
<|im_start|>user
What is happening in the video?<|vision_start|>video.mp4<|vision_end|><|im_end|>
<|im_start|>assistant
The protagonist in the video is frying an egg.<|im_end|> 
```

Visual Grounding. To endow the model with visual grounding capabilities, bounding box coordinates are normalized within [0, 1000) and represented as "(Xtop left, Ytop left), (Xbottom right, Ybottom right)". Tokens <|box\_start|> and <|box\_end|> are utilized to demarcate bounding box text. To accurately link bounding boxes with their textual descriptions, we introduce tokens <|object\_ref\_start|> and <|object\_ref\_end|> to indicate the content that the bounding box references, thereby allowing the model to effectively interpret and generate precise descriptions of specific regions.

Referring Grounding   
```txt
<|vision_start|>Picture1.jpg<|vision_end|>
<|object_ref_start|>the eyes on a giraffe<|object_ref_end|><|box_start|>(176,106),(232,160)
<|box_end|> 
```

Visual Agent. To develop Qwen2-VL as a general-purpose VL-Agent, we treat various agent tasks, such as UI Operations, Robotic Control, Games, and Navigation, as sequential decision-making problems, enabling Qwen2-VL to accomplish tasks through multi-step action execution. For each task, we first define a set of permissible actions and keywords pattern (underline) for function call (Qwen Team, 2024). Qwen2-VL then analyzes the observations, performs reasoning and planning, executes the selected actions, and interacts with the environment to acquire new observations. This cycle repeats iteratively until the task is successfully completed. By integrating various tools and leveraging the vision perception capabilities of large visionlanguage models (LVLMs), Qwen2-VL is able to iteratively execute increasingly complex tasks involving real-world visual interactions.

Visual Agent   
```txt
<|im_start|> Dominant
system
You are a helpful assistant.
# Actions
## You have the following actions.
### Tap
Tap: A gentle tap that commands, chooses, or navigates through a smartphone's user interface.
Parameters: [{"name": "point", "description": "The specific spot of interest on the monitor, denoted by
the coordinates (x, y) where x and y range from 0 to 1000.", "required": True}]
### Home
Home: Go to phone's home screen. Parameters: []
### Other Actions ...
## Continuously take action until the task is completed.
*FUNCTION*: The action to take, should be one of {Actions}.
*ARGS*: The input of the action.
*RESULT*: Action results.
*RETURN*: Reply based on action results. <|im_end|>
<|im_start|>user
Find a pizza restaurant nearby in Map. <|vision_start|>Screenshot_1.jpg<|vision_end|> <|im_end|>
<|im_start|>assistant
Several e-mails are displaying on the phone screen. To open Map, I need go back to the home screen
and find the corresponding app icon.
*FUNCTION*: Home *ARGS*: {}
*RESULT*: <|vision_start|>Screenshot_2.jpg<|vision_end|>
*RETURN*: I return to the home screen. Next, I need to find the icon of Map and tap on it.
*FUNCTION*: Tap *ARGS*: {"point": (348,291)}
*RESULT*: <|vision_start|>Screenshot_3.jpg<|vision_end|>
*RETURN*: [Thinking for the next action.]
[Other subsequent actions.] .....
I have found the pizza restaurant nearby in Map. <|im_end|> 
```

# 2.3 Multimodal Model Infrastructure

The Qwen2-VL models were trained on Alibaba Cloud’s PAI-Lingjun Intelligent Computing Service (Alibaba-Cloud, 2024c) with its scalable computing, auto resuming and straggler detection.

Storage. We use Alibaba Cloud’s ultra-speed CPFS (Cloud Parallel File Storage) (Alibaba-Cloud, 2024a) to build a storage system of Qwen2-VL pre-training and post-training. We decoupled the text data and vision data storage. We simply store text data on CPFS and use mmap for efficient access. For vision data, we use Alibaba Cloud’s OSS (Object Storage Service) (Alibaba-Cloud, 2024b) for persistent storage. During training, we accessed vision data through OSS’s python-client concurrently and tuned the concurrency and retrying parameters to avoid reaching the QPS (queries per second) limit. We also found that video data decoding is a main bottleneck, especially for long videos. After several attempts with open-source (FFmpeg-Developers, 2024) and in-house software failed, we opted for a caching decoding technique. Checkpointing saves each GPU’s optimizer and model states on CPFS.

Parallelism. We use 3D parallelism which combines data parallelism (DP) (Li et al., 2020), tensor parallelism (TP) (Krizhevsky et al., 2012; Shoeybi et al., 2019) and pipeline parallelism (PP) (Huang et al., 2019; Narayanan et al., 2021; Lamy-Poirier, 2023) to scale Qwen2-VL model training. We also leverage deepspeed’s zero-1 redundancy optimizer (Rajbhandari et al., 2020) to shard states for memory saving. Sequence parallelism (SP) (Korthikanti et al., 2023) with selective checkpointing activation (Chen et al., 2016) was leveraged to reduce memory usage. When enabling TP training, we always shard the vision encoder and large language models together but not the vision merger due to its relatively few parameters. We found the TP training would result in different model shared-weights due to the convolution operator’s non-deterministic behavior 2. We resolved this issue by performing offline reduction of the shared weights, thereby avoiding an additional all-reduce communication step. This approach resulted in only a minimal impact on performance. We leverage 1F1B PP (Narayanan et al., 2021) for Qwen2-VL 72B training. We combine the vision encoder, vision adapter and several LLM’s decoder layers into one stage, and evenly split the remaining decoder layers. Note that the vision and text sequence lengths are dynamic for each data point. We broadcast the dynamic sequence lengths before initiating the 1F1B process and access the shape information using batch indices. We also implemented an interleaved 1F1B PP (Narayanan et al., 2021) but found it is slower than the standard 1F1B setting.

Software. We use PyTorch (Paszke et al., 2019; Ansel et al., 2024) version 2.1.2 with CUDA 11.8 (Nvidia, 2024b) for training. Additionally, we leverage flash-attention (Dao et al., 2022; Dao, 2024; Shah et al., 2024) for efficient training in both the vision encoder and the LLM. We also utilize fused operators (Nvidia, 2024a) such as LayerNorm (Ba et al., 2016), RMSNorm (Zhang and Sennrich, 2019), and Adam (Loshchilov and Hutter, 2019). Besides this, we leverage the overlap of communication and computation during matrix multiplication in our training process.

# 3 Experiments

In this section, we first evaluate the model’s performance by conducting a comparative analysis across a variety of visual benchmarks, demonstrating the advantages of our approach. Subsequently, we carry out a detailed examination of specific capabilities, including general visual perception, document understanding, multilingual recognition in images, video comprehension, and agent abilities. Finally, we present an ablation study to investigate several key components of our approach.

Table 2: Performance Comparison of Qwen2-VL Models and State-of-the-art. 

<table><tr><td>Benchmark</td><td>Previous SoTA</td><td>Claude-3.5 Sonnet</td><td>GPT-4o</td><td>Qwen2-VL-72B</td><td>Qwen2-VL-7B</td><td>Qwen2-VL-2B</td></tr><tr><td> $MMMU_{val}$  (Yue et al., 2023)</td><td>66.1 (X.AI, 2024b)</td><td>68.3</td><td>69.1</td><td>64.5</td><td>54.1</td><td>41.1</td></tr><tr><td> $DocVQA_{test}$  (Mathew et al., 2021)</td><td>94.1 (Chen et al., 2024c)</td><td>95.2</td><td>92.8</td><td>96.5</td><td>94.5</td><td>90.1</td></tr><tr><td> $InfoVQA_{test}$  (Mathew et al., 2021)</td><td>82.0 (Chen et al., 2024c)</td><td>-</td><td>-</td><td>84.5</td><td>76.5</td><td>65.5</td></tr><tr><td>AI2D (Kembhavi et al., 2016)</td><td>87.6 (Chen et al., 2024c)</td><td>80.2(94.7)</td><td>84.6(94.2)</td><td>88.1</td><td>83.0</td><td>74.7</td></tr><tr><td> $ChartQA_{test}$  (Masry et al., 2022)</td><td>88.4 (Chen et al., 2024c)</td><td>90.8</td><td>85.7</td><td>88.3</td><td>83.0</td><td>73.5</td></tr><tr><td> $TextVQA_{val}$  (Singh et al., 2019)</td><td>84.4 (Chen et al., 2024c)</td><td>-</td><td>-</td><td>85.5</td><td>84.3</td><td>79.7</td></tr><tr><td> $OCRBench$  (Liu et al., 2023e)</td><td>852 (Yao et al., 2024)</td><td>788</td><td>736</td><td>877</td><td>866</td><td>809</td></tr><tr><td> $MTVQA$  (Tang et al., 2024)</td><td>23.2 (Team et al., 2023)</td><td>25.7</td><td>27.8</td><td>30.9</td><td>25.6</td><td>18.1</td></tr><tr><td> $VCR_{en\ easy}$  (Zhang et al., 2024c)</td><td>84.7 (Chen et al., 2024c)</td><td>63.9</td><td>91.6</td><td>91.9</td><td>89.7</td><td>81.5</td></tr><tr><td> $VCR_{zh\ easy}$  (Zhang et al., 2024c)</td><td>22.1 (Chen et al., 2024c)</td><td>1.0</td><td>14.9</td><td>65.4</td><td>59.9</td><td>46.2</td></tr><tr><td> $RealWorldQA$  (X.AI, 2024a)</td><td>72.2 (Chen et al., 2024c)</td><td>60.1</td><td>75.4</td><td>77.8</td><td>70.1</td><td>62.9</td></tr><tr><td> $MME_{sum}$  (Fu et al., 2023)</td><td>2414.7 (Chen et al., 2024c)</td><td>1920.0</td><td>2328.7</td><td>2482.7</td><td>2326.8</td><td>1872.0</td></tr><tr><td> $MMBench-EN_{test}$  (Liu et al., 2023d)</td><td>86.5 (Chen et al., 2024c)</td><td>79.7</td><td>83.4</td><td>86.5</td><td>83.0</td><td>74.9</td></tr><tr><td> $MMBench-CN_{test}$  (Liu et al., 2023d)</td><td>86.3 (Chen et al., 2024c)</td><td>80.7</td><td>82.1</td><td>86.6</td><td>80.5</td><td>73.5</td></tr><tr><td> $MMBench-V1.1_{test}$  (Liu et al., 2023d)</td><td>85.5 (Chen et al., 2024c)</td><td>78.5</td><td>82.2</td><td>85.9</td><td>80.7</td><td>72.2</td></tr><tr><td> $MMT-Bench_{test}$  (Ying et al., 2024)</td><td>63.4 (Chen et al., 2024b)</td><td>-</td><td>65.5</td><td>71.7</td><td>63.7</td><td>54.5</td></tr><tr><td> $MMStar$  (Chen et al., 2024a)</td><td>67.1 (Chen et al., 2024c)</td><td>62.2</td><td>63.9</td><td>68.3</td><td>60.7</td><td>48.0</td></tr><tr><td> $MMVet_{GPT-4-Turbo}$  (Yu et al., 2024)</td><td>67.5 (OpenAI., 2023)</td><td>66.0</td><td>69.1</td><td>74.0</td><td>62.0</td><td>49.5</td></tr><tr><td> $HallBench_{avg}$  (Guan et al., 2023)</td><td>55.2 (Chen et al., 2024c)</td><td>49.9</td><td>55.0</td><td>58.1</td><td>50.6</td><td>41.7</td></tr><tr><td> $MathVista_{testmini}$  (Lu et al., 2024a)</td><td>69.0 (X.AI, 2024b)</td><td>67.7</td><td>63.8</td><td>70.5</td><td>58.2</td><td>43.0</td></tr><tr><td>MathVision (Wang et al., 2024)</td><td>30.3 (OpenAI, 2023)</td><td>-</td><td>30.4</td><td>25.9</td><td>16.3</td><td>12.4</td></tr><tr><td> $MMMU-Pro$  (Yue et al., 2024)</td><td>46.9 (Team et al., 2023)</td><td>51.5</td><td>51.9</td><td>46.2</td><td>43.5</td><td>37.6</td></tr></table>

Table 3: Performance of Qwen2-VL and GPT-4o on internal multilingual OCR benchmarks. 

<table><tr><td>Language</td><td>Korean</td><td>Japanese</td><td>French</td><td>German</td><td>Italian</td><td>Russian</td><td>Vietnamese</td><td>Arabic</td></tr><tr><td>GPT-4o</td><td>87.8</td><td>88.3</td><td>89.7</td><td>88.3</td><td>74.1</td><td>96.8</td><td>72.0</td><td>75.9</td></tr><tr><td>Qwen2-VL-72B</td><td>94.5</td><td>93.4</td><td>94.1</td><td>91.5</td><td>89.8</td><td>97.2</td><td>73.0</td><td>70.7</td></tr></table>

# 3.1 Compare to SOTAs

We evaluate the visual capabilities of our model through various visual benchmarks, video tasks, and agentbased assessments. Qwen2-VL demonstrates highly competitive performance at the same scale, achieving new state-of-the-art (SoTA) results. Overall, our 72B model consistently delivers top-tier performance across most evaluation metrics, frequently surpassing even closed-source models such as GPT-4o (OpenAI, 2024) and Claude 3.5-Sonnet (Anthropic, 2024). Notably, it exhibits a significant advantage in document understanding tasks. However, in the MMMU (Yue et al., 2023) benchmark, our model still lags behind GPT-4o to some extent, indicating that Qwen2-VL-72B has room for improvement when handling more complex and challenging problem sets.

# 3.2 Quantitative Results

In this section, we present an extensive evaluation of the Qwen2-VL series across an array of datasets, offering a comprehensive understanding of the model’s capabilities in various aspects.

# 3.2.1 General Visual Question Answering

To rigorously assess our models’ capabilities in general visual question answering tasks, we conduct extensive evaluations across a diverse array of state-of-the-art benchmarks: RealWorldQA (X.AI, 2024a), MMStar (Chen et al., 2024a), MMVet (Yu et al., 2024), MMT-Bench (Ying et al., 2024), MMBench (Liu et al., 2023d), MMbench-1.1 (Liu et al., 2023d), MME (Fu et al., 2023), and HallusionBench (Guan et al., 2023). The Qwen2-VL series exhibits exceptional performance across these benchmarks, with the 72B model consistently achieving or surpassing state-of-the-art results, while the 7B and 2B variants also demonstrate robust capabilities. On RealWorldQA, which evaluates real-world spatial comprehension, Qwen2-VL-72B achieves a score of 77.8, surpassing both the previous state-of-the-art (72.2) and formidable baselines such as GPT-4o (75.4), thus demonstrating superior understanding of physical environments. For MMStar, a benchmark designed to assess genuine multimodal capabilities through visually indispensable samples, Qwen2-VL-72B attains 68.3, outperforming the previous best of 67.1 and highlighting its proficiency in integrating visual and textual information. On MMVet, which evaluates the integration of core vision-language capabilities across 16 complex multimodal tasks, Qwen2-VL-72B achieves a remarkable 74.0, significantly outperforming strong competitors including GPT-4V (67.5) and showcasing its versatility in addressing diverse multimodal challenges. In the MMT-Bench evaluation, which assesses advanced reasoning and instruction following across 32 core meta-tasks and 162 subtasks in multimodal understanding, Qwen2-VL-72B achieves 71.7, markedly surpassing the previous best (63.4) and demonstrating its prowess in applying expert knowledge and executing deliberate visual recognition, localization, reasoning, and planning. On MMBench, which evaluates fine-grained abilities across 20 dimensions, Qwen2-VL-72B exhibits strong performance, achieving 86.5 on the English test set, matching the state-of-the-art, and 86.6 on the Chinese test set, establishing a new benchmark. For MME, which measures a wide spectrum of perception and cognition abilities across 14 subtasks, Qwen2-VL-72B achieves a cumulative score of 2482.7, significantly outperforming the previous best (2414.7), underscoring its advanced capabilities in both visual perception and high-level cognition tasks.

Table 4: Performance of Qwen2-VL and other models on video benchmarks. 

<table><tr><td>Benchmark</td><td>Previous SoTA</td><td>Gemini 1.5-Pro</td><td>GPT-4o</td><td>Qwen2-VL-72B</td><td>Qwen2-VL-7B</td><td>Qwen2-VL-2B</td></tr><tr><td>MVBench (Li et al., 2024)</td><td>69.6</td><td>-</td><td>-</td><td>73.6</td><td>67.0</td><td>63.2</td></tr><tr><td>PerceptionTesttest (Patraucean et al., 2024)</td><td>66.9</td><td>-</td><td>-</td><td>68.0</td><td>62.3</td><td>53.9</td></tr><tr><td>EgoSchematest (Mangalam et al., 2023)</td><td>62.0</td><td>63.2</td><td>72.2</td><td>77.9</td><td>66.7</td><td>54.9</td></tr><tr><td>Video-MME(wo/w subs) (Fu et al., 2024)</td><td>66.3/69.6</td><td>75.0/81.3</td><td>71.9/77.2</td><td>71.2/77.8</td><td>63.3/69.0</td><td>55.6/60.4</td></tr></table>

Table 5: Performance Comparison of Qwen2-VL-72B across various agent benchmarks and GPT-4o. SR, GC, TM and EM are short for success rate, goal-condition success, type match and exact match. ALFRED, R2R and REVERIE are performance in valid-unseen. 

<table><tr><td></td><td>Benchmark</td><td>Metric</td><td>Previous SoTA</td><td>GPT-4o</td><td>Qwen2-VL-72B</td></tr><tr><td rowspan="2">General</td><td rowspan="2">FnCall</td><td>TM</td><td>-</td><td>90.2</td><td>93.1</td></tr><tr><td>EM</td><td>-</td><td>50.0</td><td>53.2</td></tr><tr><td rowspan="2">UI Operations</td><td rowspan="2">AITZ (Zhang et al., 2024b)</td><td>TM</td><td>83.0 (Hong et al., 2023)</td><td>70.0</td><td>89.6</td></tr><tr><td>EM</td><td>47.7 (Zhan and Zhang, 2023)</td><td>35.3</td><td>72.1</td></tr><tr><td rowspan="4">Card Games</td><td>Number Line (Zhai et al., 2024)</td><td>SR</td><td>89.4 (Zhai et al., 2024)</td><td>91.5</td><td>100.0</td></tr><tr><td>BlackJack (Zhai et al., 2024)</td><td>SR</td><td>40.2 (Zhai et al., 2024)</td><td>34.5</td><td>42.6</td></tr><tr><td>EZPoint (Zhai et al., 2024)</td><td>SR</td><td>50.0 (Zhai et al., 2024)</td><td>85.5</td><td>100.0</td></tr><tr><td>Point24 (Zhai et al., 2024)</td><td>SR</td><td>2.6 (Liu et al., 2023b)</td><td>3.0</td><td>4.5</td></tr><tr><td rowspan="2">Robotic Control</td><td rowspan="2">ALFRED (Shridhar et al., 2020a)</td><td>SR</td><td>67.7 (Lu et al., 2023)</td><td>-</td><td>67.8</td></tr><tr><td>GC</td><td>75.3 (Lu et al., 2023)</td><td>-</td><td>75.8</td></tr><tr><td rowspan="2">Navigation</td><td>R2R (Anderson et al., 2018)</td><td>SR</td><td>79.0 (Chen et al., 2022)</td><td>43.7</td><td>51.7</td></tr><tr><td>REVERIE (Qi et al., 2020)</td><td>SR</td><td>61.0 (Sigurdsson et al., 2023)</td><td>31.6</td><td>31.0</td></tr></table>

These comprehensive results underscore the Qwen2-VL series’ exceptional proficiency in general visual question answering tasks. The models demonstrate advanced capabilities in real-world spatial comprehension, genuine multimodal integration, complex reasoning, instruction following, and a broad range of perception and cognition tasks. The consistent superior performance across diverse benchmarks, particularly the outstanding results of the 72B model, positions the Qwen2-VL series as a leading solution in the field of visual question answering. Our models excel in handling visually indispensable tasks, integrating core vision-language capabilities, and demonstrating expertise across diverse multimodal scenarios, ranging from fundamental perception tasks to complex reasoning and planning. This exhaustive evaluation highlights the Qwen2-VL series’ versatility and effectiveness in addressing the multifaceted challenges posed by state-ofthe-art multimodal benchmarks, thereby setting a new standard for large vision-language models.

# 3.2.2 Document and Diagrams Reading

We tested our model’s OCR and document and diagram comprehension on DocVQA (Mathew et al., 2021), ChartQA (Masry et al., 2022),InfoVQA (Mathew et al., 2021), TextVQA (Singh et al., 2019),AI2D (Kembhavi et al., 2016) datasets. The DocVQA/InfoVQA/ChartQA dataset focuses on the model’s ability to comprehend text in documents/high-resolution infographics/charts, while the TextVQA dataset examines the ability to comprehend text in naturalistic images. The OCRBench dataset is a a dataset of mixed tasks, which focuses on mathematical formula parsing and information extraction in addition to the text-based VQA. The AI2D dataset focuses on multiple-choice questions on scientific diagrams containing text. In addition, we also tested the OCR and formula recognition capabilities of our model on OCRBench (Liu et al., 2023e), as well as the multilingual OCR capabilities of our model on the MTVQA (Tang et al., 2024) dataset.

The experimental results show that our model achieves SoTA level in several metrics, including DocVQA, InfoVQA, TextVQA and OCRBench, demonstrating that our model has good comprehension of textual content in images from multiple domains.

# 3.2.3 Multilingual Text Recognition and Understanding

In particular, our model surpasses all existing general-purpose LVLMs in multilingual OCR. Our model not only outperforms existing LVLMs (including proprietary models such as GPT-4o, Claude 3.5 Sonnet, etc.) on the public-available MTVQA dataset, it also outperforms GPT-4o on the in-house internal benchmark across all foreign languages except Arabic (Table 3).

# 3.2.4 Mathematical Reasoning

We’ve conducted experiments on the MathVista (Lu et al., 2024a) and MathVision (Wang et al., 2024) datasets to assess mathematical reasoning capabilities. MathVista is a comprehensive benchmark featuring 6,141 diverse examples of mathematical and visual tasks. The MathVision dataset comprises 3,040 math problems embedded in visual contexts from actual math competitions, covering 16 mathematical disciplines and varying in difficulty across five levels. These challenges underscore the necessity for LVLMs to exhibit strong visual comprehension, a deep understanding of mathematics, and sound logical reasoning skills. The Qwen2-VL series has demonstrated superior performance on MathVista, achieving a 70.5 outperforming other LVLMs. Additionally, it has set a new open-source benchmark on MathVision with 25.9.

# 3.2.5 Referring Expression Comprehension

Regarding visual localization task, we evaluate Qwen2-VL on RefCOCO, RefCOCO+, and RefCOCOg datasets (Kazemzadeh et al., 2014; Mao et al., 2016). The results, as depicted in Table 6, demonstrate that Qwen2-VL attains top-tier results among generalist models. Benefiting from a more rational structure design, Qwen2-VL is able to perceive details in high-resolution images, leading to significant improvements over Qwen-VL. The superiority of these models in comparison to both generalist and specialized models highlights their potential for advancing the field of visual localization and their capacity for real-world implementation in tasks requiring precise visual understanding.

# 3.2.6 Video Understanding

We evaluate our models on various video understanding tasks, with related benchmarks covering short videos of a few seconds to long videos of up to one hour. Table 4 presents the performance of Qwen2-VL and baseline models. Overall, Qwen2-VL demonstrates strong results across 2B, 7B, and 72B sizes, with Qwen2-VL-72B achieving the best performance on MVBench (Li et al., 2024), PerceptionTest (Patraucean et al., 2024), and EgoSchema (Mangalam et al., 2023). This showcases Qwen2-VL’s superior capabilities in video understanding tasks, and scaling up Qwen2-VL yields significant improvements. For the challenging Video-MME benchmark (Fu et al., 2024), which includes videos up to one hour, it is noteworthy that we limited the maximum number of frames extracted per video to 768 during evaluation, potentially impacting performance on longer videos. Future work will focus on extending Qwen2-VL to support longer sequences, thereby accommodating longer videos.

Table 6: Performance Comparison on Referring Expression Comprehension Task. 

<table><tr><td rowspan="2">Type</td><td rowspan="2">Model</td><td colspan="3">RefCOCO</td><td colspan="3">RefCOCO+</td><td colspan="2">RefCOCOg</td></tr><tr><td>val</td><td>test-A</td><td>test-B</td><td>val</td><td>test-A</td><td>test-B</td><td>val</td><td>test</td></tr><tr><td rowspan="11">Generalist</td><td>OFA-L (Wang et al., 2022)</td><td>80.0</td><td>83.7</td><td>76.4</td><td>68.3</td><td>76.0</td><td>61.8</td><td>67.6</td><td>67.6</td></tr><tr><td>Shikra (Chen et al., 2023a)</td><td>87.0</td><td>90.6</td><td>80.2</td><td>81.6</td><td>87.4</td><td>72.1</td><td>82.3</td><td>82.2</td></tr><tr><td>Qwen-VL (Bai et al., 2023b)</td><td>89.4</td><td>92.3</td><td>85.3</td><td>83.1</td><td>88.3</td><td>77.2</td><td>85.6</td><td>85.5</td></tr><tr><td>Ferretv2 (Zhang et al., 2024a)</td><td>92.6</td><td>95.0</td><td>88.9</td><td>87.4</td><td>92.1</td><td>81.4</td><td>89.4</td><td>90.0</td></tr><tr><td>CogVLM (Wang et al., 2023b)</td><td>92.8</td><td>94.8</td><td>89.0</td><td>88.7</td><td>92.9</td><td>83.4</td><td>89.8</td><td>90.8</td></tr><tr><td>InternVL22b (Chen et al., 2024c)</td><td>82.3</td><td>88.2</td><td>75.9</td><td>73.5</td><td>82.8</td><td>63.3</td><td>77.6</td><td>78.3</td></tr><tr><td>InternVL28b (Chen et al., 2024c)</td><td>87.1</td><td>91.1</td><td>80.7</td><td>79.8</td><td>87.9</td><td>71.4</td><td>82.7</td><td>82.7</td></tr><tr><td>InternVL276b (Chen et al., 2024c)</td><td>92.2</td><td>94.8</td><td>88.4</td><td>88.8</td><td>93.1</td><td>82.8</td><td>89.5</td><td>90.3</td></tr><tr><td>Qwen2-VL2b</td><td>87.6</td><td>90.6</td><td>82.3</td><td>79.0</td><td>84.9</td><td>71.0</td><td>81.2</td><td>80.3</td></tr><tr><td>Qwen2-VL7b</td><td>91.7</td><td>93.6</td><td>87.3</td><td>85.8</td><td>90.5</td><td>79.5</td><td>87.3</td><td>87.8</td></tr><tr><td>Qwen2-VL72b</td><td>93.2</td><td>95.3</td><td>90.7</td><td>90.1</td><td>93.8</td><td>85.6</td><td>89.9</td><td>90.4</td></tr><tr><td rowspan="3">Specialist</td><td>G-DINO-L (Liu et al., 2023c)</td><td>90.6</td><td>93.2</td><td>88.2</td><td>82.8</td><td>89.0</td><td>75.9</td><td>86.1</td><td>87.0</td></tr><tr><td>UNINEXT-H (Yan et al., 2023)</td><td>92.6</td><td>94.3</td><td>91.5</td><td>85.2</td><td>89.6</td><td>79.8</td><td>88.7</td><td>89.4</td></tr><tr><td>ONE-PEACE (Wang et al., 2023a)</td><td>92.6</td><td>94.2</td><td>89.3</td><td>88.8</td><td>92.2</td><td>83.2</td><td>89.2</td><td>89.3</td></tr></table>

# 3.2.7 Visual Agent

Qwen2-VL is evaluated first for its ability to interact with the environment via function calls and then for its capacity to complete complex sequential decision tasks through multiple rounds of interaction. The implementation is based on the Qwen-Agent framework (Qwen Team, 2024).

Function Calling Unlike function calling in LLMs (Yan et al., 2024; Srinivasan et al., 2023; Chen et al., 2023c), function calling in LVLMs often involves extracting information from visual cues. Due to the absence of public benchmarks for evaluating the capabilities of LVLMs in function calling, we constructed our internal evaluation dataset.

To construct the evaluation dataset, we undertook the following procedures (Chen et al., 2023c): Scene Categorization, Image Collection, Image Content Extraction, and Question/Functions/Arguments Generation. Firstly, we classified scenes into categories based on different visual applications. Subsequently, we downloaded and meticulously selected high-quality, representative images from the internet for each category. Thereafter, utilizing an advanced LVLM (Bai et al., 2023b), we analyzed each image to extract key visual elements and textual information. Finally, based on the content information from the images, we used an advanced LLM (Yang et al., 2024) to generate a series of questions that required specific functions to answer, along with specifying the input parameters needed for these function calls.

Similar to the function calling evaluation method in LLMs (Yan et al., 2024), we designed two metrics to evaluate the accuracy of the function selection and the correctness of the arguments input. Specifically, Type Match(TM), is calculated as the ratio of times the model successfully invoked the correct function to the total number of calls attempted. Exact Match(EM), for each function calling, we checked whether the arguments passed to the function exactly matched those recorded in the image’s content information, calculating this correctness ratio.

As shown in Table 5, the performance of Qwen2-VL in both Type Match(93.1 vs. 90.2) and Exact Match(53.2 vs. 50.0) over GPT-4o substantiates the efficacy of Qwen2-VL’s capability in function calling, thereby underscoring its significant potential for application expansion through external tool integration.

The evaluation results demonstrated that GPT-4o underperformed, primarily due to two factors: in scenarios where uncertainty arises, GPT-4o demonstrates a conservative approach by avoiding using external tools. The Optical Character Recognition (OCR) capability of GPT-4o is outperformed by Qwen2-VL, particularly in the context of Chinese characters.

UI Operations/Games/Robotics/Navigation To assess Qwen2-VL’s ability to generally handle complex tasks, we conduct evaluations across multiple VL agent tasks, including mobile operations (Zhang et al., 2024b; Rawles et al., 2024b; Lu et al., 2024b; Rawles et al., 2024a), robotic control (Kolve et al., 2017; Shridhar et al., 2020a; Inoue and Ohashi, 2022; Lu et al., 2023; Jiang et al., 2022; Huang et al., 2023b), card games (Zhai et al., 2024), and vision-language navigation (Anderson et al., 2018; Qi et al., 2020). As these tasks need multiple actions to complete tasks, we keep the history (observation, action) through Qwen2-VL supports a 32K context length, then append each new observation image after every action, enabling continuous reasoning about subsequent steps.

UI Operations: we evaluate Qwen2-VL using the AITZ task (Zhang et al., 2024b), which constructs a core clean test set derived from AITW (Rawles et al., 2024b). Based on common operation patterns of phone, we define actions such as tap, input and swipe (Rawles et al., 2024b) for Qwen2-VL to interact with on-screen icons for task completion. For example, when Qwen2-VL is tasked with finding a pizza restaurant nearby by Google Maps, it should input "pizza" in the search term, swipe to select the appropriate restaurant, and tap the corresponding link. Following the AITZ setting, we report both type match (correctness of tap, input, or swipe) and exact match (correctness of tap location, input text, or swipe direction). With the support of grounding capability on UI, Qwen2-VL surpasses GPT-4 and previous SoTA (Zhang et al., 2024b; Zhan and Zhang, 2023).

Robotic Control: we evaluate Qwen2-VL on the ALFRED task (Shridhar et al., 2020a) in AI2THOR (Kolve et al., 2017). The task requires agent to perform complex household tasks, such as toasting bread and slicing an apple to prepare a meal. To work in the virtual environment, we define high-level actions (GotoLocation, Pickup, PutDown, Open, Close, Clean, Heat, Cool, Slice) (Shridhar et al., 2020b) as the action set. Moreover, agent needs to localize objects for manipulation (e.g., it can only pick up an apple if the apple is recognized). To improve the accuracy of manipulation, we integrate SAM (Kirillov et al., 2023). ALFRED task reports task success rate (SR) (e.g., preparing dinner) and sub-goal completion metrics (GC) (e.g., whether the bread is toasted or the apple is sliced). Qwen2-VL slightly outperforms the previously specialized model ThinkBot (Lu et al., 2023) on the valid-unseen set.

Card Games: we leverage the card game environment from RL4VLM (Zhai et al., 2024) to assess Qwen2-VL’s performance in a series of card-based games: Number Line, BlackJack, EZPoint, and Point24. Each game presents distinct challenges: (1) reaching a target number using +1 or -1 operations, (2) drawing or holding cards to compete against the dealer, (3) applying basic arithmetic operations to reach a total of 12, and (4) using arithmetic operations to achieve a total of 24. We report the success rate of the tasks. They not only evaluate agent capabilities but also require strong OCR skills to recognize these cards and understand the progression of the game. Qwen2-VL demonstrates superior performance across all tasks.

Vision-Language Navigation: we evaluate Qwen2-VL on the Vision-and-Language Navigation (VLN) task using the R2R (Anderson et al., 2018) and REVERIE (Qi et al., 2020). In VLN, the model must autonomously determine the next location based on instruction, current observations. We report the success rate (SR) of VLM in reaching the predetermined destination for this task. The performance of Qwen2-VL is comparable to that of GPT-4o, but both models fall significantly behind current specialized VLN models (Chen et al., 2022; Sigurdsson et al., 2023). We attribute this gap to the incomplete and unstructured map information generated by the model from multiple images. Accurately modeling maps and locations in a 3D environment remains a major challenge for multimodal models.

Table 7: Qwen2-VL-7B under fixed/dynamic image tokens. Adjusting image sizes only results in small perturbations in performance, demonstrating the robustness to varying image sizes. Moreover, the dynamic resolution strategy achieves top-tier performance while consuming fewer tokens on average, demonstrating the efficiency of our model. 

<table><tr><td>Strategy</td><td>Average Image Tokens</td><td>InfoVQAval</td><td>RealWorldQA</td><td>OCRBench</td><td>MMMU</td></tr><tr><td rowspan="4">Fixed Image Tokens</td><td>64</td><td>28.85</td><td>56.47</td><td>572</td><td>53.33</td></tr><tr><td>576</td><td>65.72</td><td>65.88</td><td>828</td><td>52.78</td></tr><tr><td>1600</td><td>74.99</td><td>69.54</td><td>824</td><td>52.89</td></tr><tr><td>3136</td><td>77.27</td><td>70.59</td><td>786</td><td>53.44</td></tr><tr><td>Dynamic Image Tokens</td><td>1924</td><td>75.89</td><td>70.07</td><td>866</td><td>53.44</td></tr></table>

![](images/f9e64aa26b51117607e6dfb01369cc42bc3c710d388d37ba67bb38cd14751388.jpg)  
Figure 4: Qwen2-VL-7B with different min\_pixels. Small images are upscaled to surpass a specified min\_pixels threshold before input into the model. Increasing the image size within a reasonable range shows enhanced performance on perceptual tasks like InfoVQA, HallusionBench, and OCRBench.

# 3.3 Ablation Study

In this section, we present ablation studies on image dynamic resolution, M-RoPE, and model scale. These experiments aim to provide insights into the impact of these key components on our model’s performance.

# 3.3.1 Dynamic Resolution

As shown in Table 7, we compare the performance between dynamic resolution and fixed resolution. For fixed resolution, we resize the images to ensure a constant number of image tokens being input to the model, rather than resizing to a specific height and width, as this would distort the original aspect ratio. For dynamic resolution, we only set min\_pixels= 100 × 28 × 28 and max\_pixels= 16384 × 28 × 28, allowing the number of image tokens depend primarily on the image’s native resolution. It can be observed that adjusting image sizes only results in small perturbations in performance, demonstrating the model robustness to varying image sizes. Moreover, dynamic resolution approach is more efficient. We can observe that no single fixed resolution achieves optimal performance across all benchmarks. In contrast, the dynamic resolution approach consistently achieves top-tier performance while consuming fewer tokens on average.

Additionally, we observe that merely increasing the image size does not always lead to improved performance. It is more important to choose an appropriate resolution for different images. As detailed in Figure 4, we upscale small images to surpass a specified min\_pixels threshold. Evaluations on upscaled images shows enhanced performance on perceptual tasks like InfoVQA, HallusionBench, and OCRBench. We attribute these gains to increased computational load. However, for OCRBench, a too-high min\_pixels value leads to a severe performance decline. This is likely because OCRBench contains numerous extremely small images, and excessive enlargement causes these images to deviate from the training data distribution, turning them into out-of-distribution samples. In contrast, the effect of increasing min\_pixels on the MMMU benchmark is negligible. We hypothesize that the performance bottleneck in MMMU is more related to the model’s

Table 8: Ablation studies of M-RoPE. Compared to 1D-RoPE, using M-RoPE achieves better performance in downstream tasks, particularly in video benchmarks. RWQ means RealworldQA. 

<table><tr><td></td><td colspan="8">Image Benchmarks</td><td colspan="3">Video Benchmarks</td></tr><tr><td></td><td>MathVista</td><td>MMB</td><td>MMStar</td><td>RWQ</td><td>DocVQA</td><td>ChartQA</td><td>InfoVQA</td><td>TextVQA</td><td>PerceptionTest</td><td>NextQA</td><td>STAR</td></tr><tr><td>1D-RoPE</td><td>39.2</td><td>58.6</td><td>36.7</td><td>54.5</td><td>82.5</td><td>68.0</td><td>50.8</td><td>71.3</td><td>46.6</td><td>43.9</td><td>55.5</td></tr><tr><td>M-RoPE</td><td>43.4</td><td>60.6</td><td>36.7</td><td>53.7</td><td>82.8</td><td>68.4</td><td>50.3</td><td>71.8</td><td>47.4</td><td>46.0</td><td>57.9</td></tr></table>

![](images/63ac7fc3ae7d053061765327bd46c78178e6f507cb26995bfa67a5618b995822.jpg)

<details>
<summary>line</summary>

Training Sequence Length
| Inference Sequence Length | Accuracy |
| :--- | :--- |
| 8K | 68.2 |
| 16K | 70.1 |
| 32K | 70.4 |
| 48K | 71.3 |
| 64K | 70.4 |
| 80K | 71.1 |
</details>

Figure 5: Evaluate the length extrapolation capability of Qwen2-VL-72B on Video-MME Medium Video. With the help of M-RoPE, the model demonstrated robust performance when the inference length exceeded the maximum training length of 16384 tokens.

reasoning capability rather than image resolution.

# 3.3.2 M-RoPE

In this subsection, we demonstrate the effectiveness of M-RoPE. First, we validate its capability on various downstream tasks. We employ Qwen2-1.5B and ViT-L as the backbone and report the results of the pretrained models. As shown in Table 8, compared to 1D-RoPE, using M-RoPE achieves better performance in downstream tasks, particularly in video benchmarks. Furthermore, we assess the length extrapolation capability of M-RoPE on Video-MME medium-length videos. Figure 5 illustrates the performance of Qwen2- VL-72B at different inference lengths. Leveraging M-RoPE, the model demonstrates robust results across various inference lengths. Notably, despite limiting the maximum tokens per video to 16K during training, the model still exhibits exceptional performance at a maximum inference length of 80K tokens.

# 3.3.3 Model Scaling

We evaluate the performance of models of varying scales across multiple capability dimensions. Specifically, we categorize these dimensions into complex college-level problem-solving, mathematical abilities, document and table comprehension, general scenario question-answering, and video comprehension. The overall capability of a model is assessed by averaging its scores across different benchmarks associated with each dimension.

In particular, we use the MMMU (Yue et al., 2023) benchmark to represent college-level problem-solving ability, while the average scores from MathVista (Lu et al., 2024a) and MathVision (Wang et al., 2024) serve as indicators of mathematical ability. For general scenario question-answering, we compute the average score across the RealWorldQA (X.AI, 2024a), MMBench-V1.1 (Liu et al., 2023d), MMT-Bench (Ying et al., 2024), HallBench (Guan et al., 2023), MMVet (Yu et al., 2024), and MMStar (Chen et al., 2024a)

![](images/13cdb800585c7a85d5d99c90f46b55f62fd0f0311097a4f8f9a3617b9218fd0b.jpg)

<details>
<summary>line</summary>

| Parameters(B) | OCR | Video | General VQA | MMMU | Math |
|---|---|---|---|---|---|
| 2B | 68 | 58 | 55 | 41 | 28 |
| 8B | 75 | 66 | 65 | 54 | 37 |
| 72B | 78 | 74 | 72 | 64 | 48 |
</details>

(a)

![](images/c0dd04fc8c8ad0a5e35111e186d83af4d52a6db296829473627057ca27e5d7e9.jpg)

<details>
<summary>line</summary>

| Tokens(B) | AI2D | InfoVQA | RealworldQA | MMstar | MMMU |
|---|---|---|---|---|---|
| 0 | 68.5 | 61.0 | 59.0 | 45.0 | 46.5 |
| 100 | 77.0 | 67.5 | 63.5 | 49.5 | 45.5 |
| 200 | 79.5 | 70.5 | 63.5 | 52.0 | 48.0 |
| 300 | 80.5 | 71.5 | 63.5 | 53.0 | 49.0 |
| 400 | 81.0 | 73.5 | 67.5 | 53.0 | 49.0 |
| 500 | 81.5 | 73.5 | 66.0 | 53.0 | 50.5 |
| 600 | 82.0 | 73.5 | 65.0 | 54.5 | 50.5 |
| 700 | 81.5 | 73.0 | 65.5 | 55.0 | 51.0 |
| 800 | 81.0 | 74.0 | 67.0 | 55.5 | 49.5 |
</details>

(b)   
Figure 6: Model Performance Scaling Across Capabilities and Training Progress. As model size and the volume of training data increase, performance consistently improves across a range of capabilities and benchmarks.

benchmarks. Document and table comprehension capability is reflected through the average score from benchmarks like DocVQA (Mathew et al., 2021), InfoVQA (Mathew et al., 2021), ChartQA (Masry et al., 2022), TextVQA (Singh et al., 2019), OCRBench (Liu et al., 2023e), and MTVQA (Tang et al., 2024). Lastly, video comprehension ability is measured by averaging scores across MVBench (Li et al., 2024), Perception-Test (Patraucean et al., 2024), EgoSchema (Mangalam et al., 2023), and Video-MME (Fu et al., 2024).

As illustrated in Figure 6(a), there is a consistent improvement in performance with increasing model size, particularly with respect to mathematical abilities, which show a positive correlation with the number of model parameters. On the other hand, for optical character recognition (OCR)-related tasks, even smallerscale models exhibit relatively strong performance.

As shown in Figure 6(b), we visualize the relationship between model performance and the number of training tokens during the second stage of pretraining for Qwen2-VL-7B. As the number of training tokens increases, the model performance improves; however, performance on vision question answering (VQA) tasks exhibits some fluctuation. In contrast, for tasks such as AI2D (Kembhavi et al., 2016) and InfoVQA (Mathew et al., 2021)—both of which involve understanding textual and graphical information in images—the model performance shows steady improvement as training data is augmented.

# 4 Conclusion

We have presented the Qwen2-VL series, the versatile large vision-language models, including three openweight models with total parameter counts of 2, 8, and 72 billion. Qwen2-VL matches the performance of top-tier models like GPT-4o and Claude3.5-Sonnet in a range of multimodal scenarios, surpassing all other open-weight LVLM models. Qwen2-VL series introduces naive dynamic resolution and multimodal rotary position embedding (M-RoPE) to fuse information across modals effectively and be capable of understanding videos over 20 minutes in length. With advanced reasoning and decision-making abilities, Qwen2-VL can be integrated with devices such as mobile phones, robots, etc. Furthermore, Qwen2-VL now supports understanding multilingual texts within images, including most European languages, Japanese, Korean, Arabic, Vietnamese, and others.

We have made the Qwen2-VL model weights openly accessible, which enables researchers and developers to harness the full potential in a variety of applications and research projects. We aim to advance AI technologies and enhance their beneficial effects on society by dedicating ourselves to these endeavors.

# Acknowledgements

We express our gratitude to Juan Zhu, Fan Hong, Jie Zhang, Yong Li of Alibaba Cloud’s PAI team (Alibaba-Cloud, 2024c) for supporting the training infrastructure of Qwen2-VL. This work was also supported by Qwen LLM team (Yang et al., 2024), and we especially thank Na Ni, Yichang Zhang, Jianxin Ma, Bowen Yu, Zheren Fu for their data contribution and insightful discussion.

# References

Jean-Baptiste Alayrac, Jeff Donahue, Pauline Luc, Antoine Miech, Iain Barr, Yana Hasson, Karel Lenc, Arthur Mensch, Katherine Millican, Malcolm Reynolds, et al. Flamingo: a visual language model for few-shot learning. In NeurIPS, 2022. 2   
Alibaba-Cloud. Cloud parallel file storage (cpfs), 2024a. URL https://www.alibabacloud.com/en/ product/cpfs. 8   
Alibaba-Cloud. Object storage service (oss), 2024b. URL https://www.alibabacloud.com/en/product/ object-storage-service. 8   
Alibaba-Cloud. Pai-lingjun intelligent computing service, 2024c. URL https://www.alibabacloud.com/en/ product/pai-lingjun. 8, 17   
Peter Anderson, Qi Wu, Damien Teney, Jake Bruce, Mark Johnson, Niko Sünderhauf, Ian Reid, Stephen Gould, and Anton Van Den Hengel. Vision-and-language navigation: Interpreting visually-grounded navigation instructions in real environments. In CVPR, 2018. 10, 13   
Jason Ansel, Edward Z. Yang, Horace He, Natalia Gimelshein, Animesh Jain, Michael Voznesensky, Bin Bao, Peter Bell, David Berard, Evgeni Burovski, Geeta Chauhan, Anjali Chourdia, Will Constable, Alban Desmaison, Zachary DeVito, Elias Ellison, Will Feng, Jiong Gong, Michael Gschwind, Brian Hirsh, Sherlock Huang, Kshiteej Kalambarkar, Laurent Kirsch, Michael Lazos, Mario Lezcano, Yanbo Liang, Jason Liang, Yinghai Lu, C. K. Luk, Bert Maher, Yunjie Pan, Christian Puhrsch, Matthias Reso, Mark Saroufim, Marcos Yukio Siraichi, Helen Suk, Shunting Zhang, Michael Suo, Phil Tillet, Xu Zhao, Eikan Wang, Keren Zhou, Richard Zou, Xiaodong Wang, Ajit Mathews, William Wen, Gregory Chanan, Peng Wu, and Soumith Chintala. Pytorch 2: Faster machine learning through dynamic python bytecode transformation and graph compilation. In ASPLOS, 2024. 8   
Anthropic. Claude 3.5 sonnet, 2024. URL https://www.anthropic.com/news/claude-3-5-sonnet. 9   
Anurag Arnab, Mostafa Dehghani, Georg Heigold, Chen Sun, Mario Lučić, and Cordelia Schmid. Vivit: A video vision transformer. In ICCV, 2021. 5   
Lei Jimmy Ba, Jamie Ryan Kiros, and Geoffrey E. Hinton. Layer normalization. arXiv:1607.06450, 2016. 8   
Jinze Bai, Shuai Bai, Yunfei Chu, Zeyu Cui, Kai Dang, Xiaodong Deng, Yang Fan, Wenbin Ge, Yu Han, Fei Huang, et al. Qwen technical report. arXiv:2309.16609, 2023a. 1   
Jinze Bai, Shuai Bai, Shusheng Yang, Shijie Wang, Sinan Tan, Peng Wang, Junyang Lin, Chang Zhou, and Jingren Zhou. Qwen-vl: A frontier large vision-language model with versatile abilities. arXiv:2308.12966, 2023b. 1, 2, 3, 5, 12   
Joao Carreira and Andrew Zisserman. Quo vadis, action recognition? a new model and the kinetics dataset. In CVPR, 2017. 5   
Keqin Chen, Zhao Zhang, Weili Zeng, Richong Zhang, Feng Zhu, and Rui Zhao. Shikra: Unleashing multimodal llm’s referential dialogue magic. arXiv:2306.15195, 2023a. 12

Lin Chen, Jisong Li, Xiaoyi Dong, Pan Zhang, Conghui He, Jiaqi Wang, Feng Zhao, and Dahua Lin. Sharegpt4v: Improving large multi-modal models with better captions. arXiv:2311.12793, 2023b. 1   
Lin Chen, Jinsong Li, Xiaoyi Dong, Pan Zhang, Yuhang Zang, Zehui Chen, Haodong Duan, Jiaqi Wang, Yu Qiao, Dahua Lin, et al. Are we on the right way for evaluating large vision-language models? arXiv:2403.20330, 2024a. 9, 15   
Shizhe Chen, Pierre-Louis Guhur, Makarand Tapaswi, Cordelia Schmid, and Ivan Laptev. Think global, act local: Dual-scale graph transformer for vision-and-language navigation. In CVPR, 2022. 10, 13   
Tianqi Chen, Bing Xu, Chiyuan Zhang, and Carlos Guestrin. Training deep nets with sublinear memory cost. arXiv:1604.06174, 2016. 8   
Zehui Chen, Weihua Du, Wenwei Zhang, Kuikun Liu, Jiangning Liu, Miao Zheng, Jingming Zhuo, Songyang Zhang, Dahua Lin, Kai Chen, et al. T-eval: Evaluating the tool utilization capability step by step. arXiv:2312.14033, 2023c. 12   
Zhe Chen, Weiyun Wang, Hao Tian, Shenglong Ye, Zhangwei Gao, Erfei Cui, Wenwen Tong, Kongzhi Hu, Jiapeng Luo, Zheng Ma, et al. How far are we to gpt-4v? closing the gap to commercial multimodal models with open-source suites. arXiv:2404.16821, 2024b. 9   
Zhe Chen, Weiyun Wang, Hao Tian, Shenglong Ye, Zhangwei Gao, Erfei Cui, Wenwen Tong, Kongzhi Hu, Jiapeng Luo, Zheng Ma, et al. Internvl2: Better than the best—expanding performance boundaries of open-source multimodal models with the progressive scaling strategy, 2024c. URL https://internvl. github.io/blog/2024-07-02-InternVL-2.0. 9, 12   
Wei-Lin Chiang, Zhuohan Li, Zi Lin, Ying Sheng, Zhanghao Wu, Hao Zhang, Lianmin Zheng, Siyuan Zhuang, Yonghao Zhuang, Joseph E. Gonzalez, Ion Stoica, and Eric P. Xing. Vicuna: An open-source chatbot impressing gpt-4 with 90%\* chatgpt quality, 2023. URL https://lmsys.org/blog/2023-03-30-vicuna/. 1   
Wenliang Dai, Junnan Li, Dongxu Li, Anthony Meng Huat Tiong, Junqi Zhao, Weisheng Wang, Boyang Li, Pascale Fung, and Steven Hoi. Instructblip: Towards general-purpose vision-language models with instruction tuning. arXiv:2305.06500, 2023. 1   
Tri Dao. Flashattention-2: Faster attention with better parallelism and work partitioning. In ICLR, 2024. 8   
Tri Dao, Daniel Y. Fu, Stefano Ermon, Atri Rudra, and Christopher Ré. Flashattention: Fast and memoryefficient exact attention with io-awareness. In NeurIPS, 2022. 8   
Mostafa Dehghani, Basil Mustafa, Josip Djolonga, Jonathan Heek, Matthias Minderer, Mathilde Caron, Andreas Steiner, Joan Puigcerver, Robert Geirhos, Ibrahim M Alabdulmohsin, et al. Patch n’pack: Navit, a vision transformer for any aspect ratio and resolution. In NeurIPS, 2024. 4   
Alexey Dosovitskiy, Lucas Beyer, Alexander Kolesnikov, Dirk Weissenborn, Xiaohua Zhai, Thomas Unterthiner, Mostafa Dehghani, Matthias Minderer, Georg Heigold, Sylvain Gelly, Jakob Uszkoreit, and Neil Houlsby. An image is worth 16x16 words: Transformers for image recognition at scale. In ICLR, 2021. 4   
Abhimanyu Dubey, Abhinav Jauhri, Abhinav Pandey, Abhishek Kadian, Ahmad Al-Dahle, Aiesha Letman, Akhil Mathur, Alan Schelten, Amy Yang, Angela Fan, et al. The llama 3 herd of models. arXiv:2407.21783, 2024. 46, 48, 49   
Alex Fang, Albin Madappally Jose, Amit Jain, Ludwig Schmidt, Alexander Toshev, and Vaishaal Shankar. Data filtering networks. arXiv:2309.17425, 2023. 5   
FFmpeg-Developers. ffmpeg tool, 2024. URL http://ffmpeg.org/. 8   
Chaoyou Fu, Peixian Chen, Yunhang Shen, Yulei Qin, Mengdan Zhang, Xu Lin, Zhenyu Qiu, Wei Lin, Jinrui Yang, Xiawu Zheng, et al. Mme: A comprehensive evaluation benchmark for multimodal large language models. arXiv:2306.13394, 2023. 9

Chaoyou Fu, Yuhan Dai, Yondong Luo, Lei Li, Shuhuai Ren, Renrui Zhang, Zihan Wang, Chenyu Zhou, Yunhang Shen, Mengdan Zhang, et al. Video-mme: The first-ever comprehensive evaluation benchmark of multi-modal llms in video analysis. arXiv:2405.21075, 2024. 10, 12, 16   
Tianrui Guan, Fuxiao Liu, Xiyang Wu, Ruiqi Xian, Zongxia Li, Xiaoyu Liu, Xijun Wang, Lichang Chen, Furong Huang, Yaser Yacoob, Dinesh Manocha, and Tianyi Zhou. Hallusionbench: An advanced diagnostic suite for entangled language hallucination & visual illusion in large vision-language models. arXiv:2310.14566, 2023. 9, 15   
Wenyi Hong, Weihan Wang, Qingsong Lv, Jiazheng Xu, Wenmeng Yu, Junhui Ji, Yan Wang, Zihan Wang, Yuxiao Dong, Ming Ding, et al. Cogagent: A visual language model for gui agents. arXiv:2312.08914, 2023. 10   
Shaohan Huang, Li Dong, Wenhui Wang, Yaru Hao, Saksham Singhal, Shuming Ma, Tengchao Lv, Lei Cui, Owais Khan Mohammed, Qiang Liu, et al. Language is not all you need: Aligning perception with language models. arXiv:2302.14045, 2023a. 1, 2   
Siyuan Huang, Zhengkai Jiang, Hao Dong, Yu Qiao, Peng Gao, and Hongsheng Li. Instruct2act: Mapping multi-modality instructions to robotic actions with large language model. arXiv:2305.11176, 2023b. 13   
Yanping Huang, Youlong Cheng, Ankur Bapna, Orhan Firat, Dehao Chen, Mia Xu Chen, HyoukJoong Lee, Jiquan Ngiam, Quoc V. Le, Yonghui Wu, and Zhifeng Chen. Gpipe: Efficient training of giant neural networks using pipeline parallelism. In NeurIPS, 2019. 8   
Yuki Inoue and Hiroki Ohashi. Prompter: Utilizing large language model prompting for a data efficient embodied instruction following. arXiv:2211.03267, 2022. 13   
Yunfan Jiang, Agrim Gupta, Zichen Zhang, Guanzhi Wang, Yongqiang Dou, Yanjun Chen, Li Fei-Fei, Anima Anandkumar, Yuke Zhu, and Linxi Fan. Vima: General robot manipulation with multimodal prompts. arXiv:2210.03094, 2022. 13   
Sahar Kazemzadeh, Vicente Ordonez, Mark Matten, and Tamara Berg. Referitgame: Referring to objects in photographs of natural scenes. In EMNLP, 2014. 11   
Aniruddha Kembhavi, Mike Salvato, Eric Kolve, Minjoon Seo, Hannaneh Hajishirzi, and Ali Farhadi. A diagram is worth a dozen images. In ECCV, 2016. 9, 11, 16   
Alexander Kirillov, Eric Mintun, Nikhila Ravi, Hanzi Mao, Chloe Rolland, Laura Gustafson, Tete Xiao, Spencer Whitehead, Alexander C Berg, Wan-Yen Lo, et al. Segment anything. In ICCV, 2023. 13   
Eric Kolve, Roozbeh Mottaghi, Winson Han, Eli VanderBilt, Luca Weihs, Alvaro Herrasti, Matt Deitke, Kiana Ehsani, Daniel Gordon, Yuke Zhu, et al. Ai2-thor: An interactive 3d environment for visual ai. arXiv:1712.05474, 2017. 13   
Vijay Anand Korthikanti, Jared Casper, Sangkug Lym, Lawrence McAfee, Michael Andersch, Mohammad Shoeybi, and Bryan Catanzaro. Reducing activation recomputation in large transformer models. In MLSys, 2023. 8   
Alex Krizhevsky, Ilya Sutskever, and Geoffrey E. Hinton. Imagenet classification with deep convolutional neural networks. In NeurIPS, 2012. 8   
Joel Lamy-Poirier. Breadth-first pipeline parallelism. In MLSys, 2023. 8   
Bo Li, Peiyuan Zhang, Jingkang Yang, Yuanhan Zhang, Fanyi Pu, and Ziwei Liu. Otterhd: A high-resolution multi-modality model. arXiv:2311.04219, 2023a. 2   
Chen Li, Yixiao Ge, Dian Li, and Ying Shan. Vision-language instruction tuning: A review and analysis. arXiv:2311.08172, 2023b. 2

Junnan Li, Dongxu Li, Silvio Savarese, and Steven Hoi. Blip-2: Bootstrapping language-image pre-training with frozen image encoders and large language models. arXiv:2301.12597, 2023c. 1   
Kunchang Li, Yali Wang, Yinan He, Yizhuo Li, Yi Wang, Yi Liu, Zun Wang, Jilan Xu, Guo Chen, Ping Luo, et al. Mvbench: A comprehensive multi-modal video understanding benchmark. In CVPR, 2024. 10, 11, 16   
Shen Li, Yanli Zhao, Rohan Varma, Omkar Salpekar, Pieter Noordhuis, Teng Li, Adam Paszke, Jeff Smith, Brian Vaughan, Pritam Damania, et al. Pytorch distributed: Experiences on accelerating data parallel training. In VLDB, 2020. 8   
Zhang Li, Biao Yang, Qiang Liu, Zhiyin Ma, Shuo Zhang, Jingxu Yang, Yabo Sun, Yuliang Liu, and Xiang Bai. Monkey: Image resolution and text label are important things for large multi-modal models. arXiv:2311.06607, 2023d. 2   
Ziyi Lin, Chris Liu, Renrui Zhang, Peng Gao, Longtian Qiu, Han Xiao, Han Qiu, Chen Lin, Wenqi Shao, Keqin Chen, Jiaming Han, Siyuan Huang, Yichi Zhang, Xuming He, Hongsheng Li, and Yu Jiao Qiao. Sphinx: The joint mixing of weights, tasks, and visual embeddings for multi-modal large language models. arXiv:2311.07575, 2023. 2   
Haotian Liu, Chunyuan Li, Yuheng Li, and Yong Jae Lee. Improved baselines with visual instruction tuning. arXiv:2310.03744, 2023a. 1, 2   
Haotian Liu, Chunyuan Li, Qingyang Wu, and Yong Jae Lee. Visual instruction tuning. arXiv:2304.08485, 2023b. 1, 2, 10   
Shilong Liu, Zhaoyang Zeng, Tianhe Ren, Feng Li, Hao Zhang, Jie Yang, Chun yue Li, Jianwei Yang, Hang Su, Jun-Juan Zhu, and Lei Zhang. Grounding dino: Marrying dino with grounded pre-training for open-set object detection. arXiv:2303.05499, 2023c. 12   
Yuan Liu, Haodong Duan, Bo Li Yuanhan Zhang, Songyang Zhang, Wangbo Zhao, Yike Yuan, Jiaqi Wang, Conghui He, Ziwei Liu, Kai Chen, and Dahua Lin. Mmbench: Is your multi-modal model an all-around player? arXiv:2307.06281, 2023d. 9, 15   
Yuliang Liu, Zhang Li, Mingxin Huang, Biao Yang, Wenwen Yu, Chunyuan Li, Xucheng Yin, Cheng lin Liu, Lianwen Jin, and Xiang Bai. Ocrbench: On the hidden mystery of ocr in large multimodal models. arXiv:2305.07895, 2023e. 9, 11, 16   
Ilya Loshchilov and Frank Hutter. Decoupled weight decay regularization. In ICLR, 2019. 8   
Guanxing Lu, Ziwei Wang, Changliu Liu, Jiwen Lu, and Yansong Tang. Thinkbot: Embodied instruction following with thought chain reasoning. arXiv:2312.07062, 2023. 10, 13   
Pan Lu, Ran Gong, Shibiao Jiang, Liang Qiu, Siyuan Huang, Xiaodan Liang, and Song-Chun Zhu. Inter-gps: Interpretable geometry problem solving with formal language and symbolic reasoning. In ACL, 2021. 32   
Pan Lu, Hritik Bansal, Tony Xia, Jiacheng Liu, Chunyuan Li, Hannaneh Hajishirzi, Hao Cheng, Kai-Wei Chang, Michel Galley, and Jianfeng Gao. Mathvista: Evaluating mathematical reasoning of foundation models in visual contexts. In ICLR, 2024a. 9, 11, 15   
Quanfeng Lu, Wenqi Shao, Zitao Liu, Fanqing Meng, Boxuan Li, Botong Chen, Siyuan Huang, Kaipeng Zhang, Yu Qiao, and Ping Luo. Gui odyssey: A comprehensive dataset for cross-app gui navigation on mobile devices. arXiv:2406.08451, 2024b. 13   
Karttikeya Mangalam, Raiymbek Akshulakov, and Jitendra Malik. Egoschema: A diagnostic benchmark for very long-form video language understanding. In NeurIPS, 2023. 10, 11, 16   
Junhua Mao, Jonathan Huang, Alexander Toshev, Oana Camburu, Alan L Yuille, and Kevin Murphy. Generation and comprehension of unambiguous object descriptions. In CVPR, 2016. 11

Ahmed Masry, Do Xuan Long, Jia Qing Tan, Shafiq Joty, and Enamul Hoque. Chartqa: A benchmark for question answering about charts with visual and logical reasoning. arXiv:2203.10244, 2022. 9, 11, 16   
Minesh Mathew, Dimosthenis Karatzas, and CV Jawahar. Docvqa: A dataset for vqa on document images. In WACV, 2021. 9, 11, 16   
Deepak Narayanan, Mohammad Shoeybi, Jared Casper, Patrick LeGresley, Mostofa Patwary, Vijay Korthikanti, Dmitri Vainbrand, Prethvi Kashinkunti, Julie Bernauer, Bryan Catanzaro, Amar Phanishayee, and Matei Zaharia. Efficient large-scale language model training on GPU clusters using megatron-lm. In SC, 2021. 8   
Nvidia. Apex, 2024a. URL https://github.com/NVIDIA/apex. 8   
Nvidia. Cuda, 2024b. URL https://developer.nvidia.com/cuda-toolkit. 8   
OpenAI. Gpt-4 technical report. arXiv:2303.08774, 2023. 1, 9   
OpenAI. Gpt-4v(ision) system card, 2023. URL https://openai.com/research/gpt-4v-system-card. 1, 9   
Openai. Chatml documents, 2024. URL https://github.com/openai/openai-python/blob/main/chatml. md. 6   
OpenAI. Hello gpt-4o, 2024. URL https://openai.com/index/hello-gpt-4o. 9   
Adam Paszke, Sam Gross, Francisco Massa, Adam Lerer, James Bradbury, Gregory Chanan, Trevor Killeen, Zeming Lin, Natalia Gimelshein, Luca Antiga, Alban Desmaison, Andreas Köpf, Edward Z. Yang, Zachary DeVito, Martin Raison, Alykhan Tejani, Sasank Chilamkurthy, Benoit Steiner, Lu Fang, Junjie Bai, and Soumith Chintala. Pytorch: An imperative style, high-performance deep learning library. In NeurIPS, 2019. 8   
Viorica Patraucean, Lucas Smaira, Ankush Gupta, Adria Recasens, Larisa Markeeva, Dylan Banarse, Skanda Koppula, Mateusz Malinowski, Yi Yang, Carl Doersch, et al. Perception test: A diagnostic benchmark for multimodal video models. In NeurIPS, 2024. 10, 11, 16   
Yuankai Qi, Qi Wu, Peter Anderson, Xin Wang, William Yang Wang, Chunhua Shen, and Anton van den Hengel. Reverie: Remote embodied visual referring expression in real indoor environments. In CVPR, 2020. 10, 13   
Alibaba Group Qwen Team. Qwen-agent framework, 2024. URL https://github.com/QwenLM/Qwen-Agent. 7, 12   
Alec Radford, Jong Wook Kim, Chris Hallacy, Aditya Ramesh, Gabriel Goh, Sandhini Agarwal, Girish Sastry, Amanda Askell, Pamela Mishkin, Jack Clark, et al. Learning transferable visual models from natural language supervision. In ICML, 2021. 2   
Samyam Rajbhandari, Jeff Rasley, Olatunji Ruwase, and Yuxiong He. Zero: memory optimizations toward training trillion parameter models. In SC, 2020. 8   
Christopher Rawles, Sarah Clinckemaillie, Yifan Chang, Jonathan Waltz, Gabrielle Lau, Marybeth Fair, Alice Li, William Bishop, Wei Li, Folawiyo Campbell-Ajala, et al. Androidworld: A dynamic benchmarking environment for autonomous agents. arXiv:2405.14573, 2024a. 13   
Christopher Rawles, Alice Li, Daniel Rodriguez, Oriana Riva, and Timothy Lillicrap. Androidinthewild: A large-scale dataset for android device control. In NeurIPS, 2024b. 13   
Jay Shah, Ganesh Bikshandi, Ying Zhang, Vijay Thakkar, Pradeep Ramani, and Tri Dao. Flashattention-3: Fast and accurate attention with asynchrony and low-precision. arXiv:2407.08608, 2024. 8   
Mohammad Shoeybi, Mostofa Patwary, Raul Puri, Patrick LeGresley, Jared Casper, and Bryan Catanzaro. Megatron-lm: Training multi-billion parameter language models using model parallelism. arXiv:1909.08053, 2019. 8

Mohit Shridhar, Jesse Thomason, Daniel Gordon, Yonatan Bisk, Winson Han, Roozbeh Mottaghi, Luke Zettlemoyer, and Dieter Fox. Alfred: A benchmark for interpreting grounded instructions for everyday tasks. In CVPR, 2020a. 10, 13   
Mohit Shridhar, Xingdi Yuan, Marc-Alexandre Côté, Yonatan Bisk, Adam Trischler, and Matthew Hausknecht. Alfworld: Aligning text and embodied environments for interactive learning. arXiv:2010.03768, 2020b. 13   
Gunnar A Sigurdsson, Jesse Thomason, Gaurav S Sukhatme, and Robinson Piramuthu. Rrex-bot: Remote referring expressions with a bag of tricks. In IROS, 2023. 10, 13   
Amanpreet Singh, Vivek Natarajan, Meet Shah, Yu Jiang, Xinlei Chen, Dhruv Batra, Devi Parikh, and Marcus Rohrbach. Towards vqa models that can read. In CVPR, 2019. 9, 11, 16   
Venkat Krishna Srinivasan, Zhen Dong, Banghua Zhu, Brian Yu, Damon Mosk-Aoyama, Kurt Keutzer, Jiantao Jiao, and Jian Zhang. Nexusraven: a commercially-permissive language model for function calling. In NeurIPS Workshop, 2023. 12   
Jianlin Su. Transformer upgrade path: 4. rotary position encoding for two-dimensional positions, 2021. URL https://www.spaces.ac.cn/archives/8397. 4   
Jianlin Su. Transformer upgrade path: 17. insights into multimodal positional encoding, 2024. URL https: //spaces.ac.cn/archives/10040. 5   
Jianlin Su, Murtadha Ahmed, Yu Lu, Shengfeng Pan, Wen Bo, and Yunfeng Liu. Roformer: Enhanced transformer with rotary position embedding. In Neurocomputing, 2024. 4   
Jingqun Tang, Qi Liu, Yongjie Ye, Jinghui Lu, Shu Wei, Chunhui Lin, Wanqing Li, Mohamad Fitri Faiz Bin Mahmood, Hao Feng, Zhen Zhao, Yanjie Wang, Yuliang Liu, Hao Liu, Xiang Bai, and Can Huang. Mtvqa: Benchmarking multilingual text-centric visual question answering. arXiv:2405.11985, 2024. 9, 11, 16   
Gemini Team, Rohan Anil, Sebastian Borgeaud, Yonghui Wu, Jean-Baptiste Alayrac, Jiahui Yu, Radu Soricut, Johan Schalkwyk, Andrew M Dai, Anja Hauth, et al. Gemini: A family of highly capable multimodal models. arXiv:2312.11805, 2023. 1, 9   
Hugo Touvron, Thibaut Lavril, Gautier Izacard, Xavier Martinet, Marie-Anne Lachaux, Timothée Lacroix, Baptiste Rozière, Naman Goyal, Eric Hambro, Faisal Azhar, et al. Llama: Open and efficient foundation language models. arXiv:2302.13971, 2023a. 1   
Hugo Touvron, Louis Martin, Kevin Stone, Peter Albert, Amjad Almahairi, Yasmine Babaei, Nikolay Bashlykov, Soumya Batra, Prajjwal Bhargava, Shruti Bhosale, et al. Llama 2: Open foundation and fine-tuned chat models. arXiv:2307.09288, 2023b. 1   
Ke Wang, Junting Pan, Weikang Shi, Zimu Lu, Mingjie Zhan, and Hongsheng Li. Measuring multimodal mathematical reasoning with math-vision dataset. arXiv:2402.14804, 2024. 9, 11, 15   
Peng Wang, An Yang, Rui Men, Junyang Lin, Shuai Bai, Zhikang Li, Jianxin Ma, Chang Zhou, Jingren Zhou, and Hongxia Yang. Ofa: Unifying architectures, tasks, and modalities through a simple sequence-tosequence learning framework. In ICML, 2022. 12   
Peng Wang, Shijie Wang, Junyang Lin, Shuai Bai, Xiaohuan Zhou, Jingren Zhou, Xinggang Wang, and Chang Zhou. One-peace: Exploring one general representation model toward unlimited modalities. arXiv:2305.11172, 2023a. 12   
Weihan Wang, Qingsong Lv, Wenmeng Yu, Wenyi Hong, Ji Qi, Yan Wang, Junhui Ji, Zhuoyi Yang, Lei Zhao, Xixuan Song, et al. Cogvlm: Visual expert for pretrained language models. arXiv:2311.03079, 2023b. 1, 2, 12   
X.AI. Grok-1.5 vision preview. https://x.ai/blog/grok-1.5v, 2024a. 9, 15   
X.AI. Grok-2 beta release. https://x.ai/blog/grok-2, 2024b. 9

B. Yan, Yi Jiang, Jiannan Wu, D. Wang, Ping Luo, Zehuan Yuan, and Huchuan Lu. Universal instance perception as object discovery and retrieval. In CVPR, 2023. 12   
Fanjia Yan, Huanzhi Mao, Charlie Cheng-Jie Ji, Tianjun Zhang, Shishir G. Patil, Ion Stoica, and Joseph E. Gonzalez. Berkeley function calling leaderboard, 2024. URL https://gorilla.cs.berkeley.edu/blogs/ 8\_berkeley\_function\_calling\_leaderboard.html. 12   
An Yang, Baosong Yang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Zhou, Chengpeng Li, Chengyuan Li, Dayiheng Liu, Fei Huang, et al. Qwen2 technical report. arXiv:2407.10671, 2024. 4, 5, 12, 17   
Zhengyuan Yang, Linjie Li, Kevin Lin, Jianfeng Wang, Chung-Ching Lin, Zicheng Liu, and Lijuan Wang. The dawn of lmms: Preliminary explorations with gpt-4v (ision). arXiv:2309.17421, 2023. 30, 44   
Yuan Yao, Tianyu Yu, Ao Zhang, Chongyi Wang, Junbo Cui, Hongji Zhu, Tianchi Cai, Haoyu Li, Weilin Zhao, Zhihui He, et al. Minicpm-v: A gpt-4v level mllm on your phone. arXiv:2408.01800, 2024. 9   
Qinghao Ye, Haiyang Xu, Guohai Xu, Jiabo Ye, Ming Yan, Yiyang Zhou, Junyang Wang, Anwen Hu, Pengcheng Shi, Yaya Shi, et al. mplug-owl: Modularization empowers large language models with multimodality. arXiv:2304.14178, 2023a. 2   
Qinghao Ye, Haiyang Xu, Jiabo Ye, Ming Yan, Haowei Liu, Qi Qian, Ji Zhang, Fei Huang, and Jingren Zhou. mplug-owl2: Revolutionizing multi-modal large language model with modality collaboration. arXiv:2311.04257, 2023b. 2   
Kaining Ying, Fanqing Meng, Jin Wang, Zhiqian Li, Han Lin, Yue Yang, Hao Zhang, Wenbo Zhang, Yuqi Lin, Shuo Liu, Jiayi Lei, Quanfeng Lu, Runjian Chen, Peng Xu, Renrui Zhang, Haozhe Zhang, Peng Gao, Yali Wang, Yu Qiao, Ping Luo, Kaipeng Zhang, and Wenqi Shao. Mmt-bench: A comprehensive multimodal benchmark for evaluating large vision-language models towards multitask agi. arXiv:2404.16006, 2024. 9, 15   
Weihao Yu, Zhengyuan Yang, Linjie Li, Jianfeng Wang, Kevin Lin, Zicheng Liu, Xinchao Wang, and Lijuan Wang. Mm-vet: Evaluating large multimodal models for integrated capabilities. In ICML, 2024. 9, 15   
Xiang Yue, Yuansheng Ni, Kai Zhang, Tianyu Zheng, Ruoqi Liu, Ge Zhang, Samuel Stevens, Dongfu Jiang, Weiming Ren, Yuxuan Sun, et al. Mmmu: A massive multi-discipline multimodal understanding and reasoning benchmark for expert agi. arXiv:2311.16502, 2023. 9, 15   
Xiang Yue, Tianyu Zheng, Yuansheng Ni, Yubo Wang, Kai Zhang, Shengbang Tong, Yuxuan Sun, Ming Yin, Botao Yu, Ge Zhang, et al. Mmmu-pro: A more robust multi-discipline multimodal understanding benchmark. arXiv preprint arXiv:2409.02813, 2024. 9   
Yuexiang Zhai, Hao Bai, Zipeng Lin, Jiayi Pan, Shengbang Tong, Yifei Zhou, Alane Suhr, Saining Xie, Yann LeCun, Yi Ma, et al. Fine-tuning large vision-language models as decision-making agents via reinforcement learning. arXiv:2405.10292, 2024. 10, 13   
Zhuosheng Zhan and Aston Zhang. You only look at screens: Multimodal chain-of-action agents. arXiv:2309.11436, 2023. 10, 13   
Biao Zhang and Rico Sennrich. Root mean square layer normalization. In NeurIPS, 2019. 8   
Haotian Zhang, Haoxuan You, Philipp Dufter, Bowen Zhang, Chen Chen, Hong-You Chen, Tsu-Jui Fu, William Yang Wang, Shih-Fu Chang, Zhe Gan, and Yinfei Yang. Ferret-v2: An improved baseline for referring and grounding with large language models. arXiv:2404.07973, 2024a. 12   
Jiwen Zhang, Jihao Wu, Yihua Teng, Minghui Liao, Nuo Xu, Xiao Xiao, Zhongyu Wei, and Duyu Tang. Android in the zoo: Chain-of-action-thought for gui agents. arXiv:2403.02713, 2024b. 10, 13   
Pan Zhang, Xiaoyi Dong Bin Wang, Yuhang Cao, Chao Xu, Linke Ouyang, Zhiyuan Zhao, Shuangrui Ding, Songyang Zhang, Haodong Duan, Hang Yan, et al. Internlm-xcomposer: A vision-language large model for advanced text-image comprehension and composition. arXiv:2309.15112, 2023. 1

Tianyu Zhang, Suyuchen Wang, Lu Li, Ge Zhang, Perouz Taslakian, Sai Rajeswar, Jie Fu, Bang Liu, and Yoshua Bengio. Vcr: Visual caption restoration. arXiv:2406.06462, 2024c. 9   
Deyao Zhu, Jun Chen, Xiaoqian Shen, Xiang Li, and Mohamed Elhoseiny. Minigpt-4: Enhancing visionlanguage understanding with advanced large language models. arXiv:2304.10592, 2023. 1, 2

# A Model Capabilities and Qualitative Examples

In this section, we present some practical examples of our Qwen2-VL.

# A.1 General Chat and OCR

The Qwen2-VL models are now more adept at accurately describing and identifying complex information within images, as well as providing detailed background and answering related questions. Besides, the text processing capabilities of the Qwen2-VL models have seen significant improvements, particularly concerning the recognition of Chinese and English text within images.

# Multi-object Recognition

![](images/74b8b67c53b6a7a4976eda9bb58d872130019932cea50930208482ac60d76de9.jpg)

<details>
<summary>natural_image</summary>

Colorful 3D-printed blocks arranged in a pyramid shape, each labeled with a number from 0 to 9 (no text or symbols beyond numbers)
</details>

Output the color and number of each box.

# Model Response

The image shows a stack of colorful blocks with numbers on them. Here is the color and number of each block from top to bottom:

\- Top row (single block): Blue with the number 9 - Second row (two blocks): Light blue with the number 7, and green with the number 8 - Third row (three blocks): Purple with the number 4, pink with the number 5, and light green with the number 6 - Bottom row (four blocks): Red with the number 0, orange with the number 1, yellow with the number 2, and light green with the number 3

Figure 7: When presented with an image of cubes of different colors, the models identify their layout and the color of each cube.

# Plant identification

![](images/9ecac61a1699943fde6d5841b09ed3204078f354259c9920acc6805f23bd2968.jpg)

<details>
<summary>natural_image</summary>

Close-up of vibrant pink and blue flowers with yellow centers, surrounded by green foliage (no text or symbols)
</details>

What kind of flower is this?

# Model Response

The flowers in the picture are forget-me-nots (Myosotis). These small, delicate flowers are known for their vibrant colors, typically blue, pink, or white, and are often used in bouquets and gardens for their charming appearance.

Figure 8: The model displays an adeptness in recognizing flowers in photographs.

# Document Parsing with Dense Formulas

1. If i > 0, let d′ := (i − 1, d − i −l + 1, l). Let Vd and Vd, be r + 1-dimensional subspaces holds in Vr if and only if

$$
\dim \left(V _ {\underline {{d}}} ^ {X _ {2}, 0} + V _ {\underline {{d}}} ^ {X _ {3}, 0}\right) - \dim \left(V _ {\underline {{d}} ^ {\prime \prime}} ^ {X _ {2}, 0} + V _ {\underline {{d}} ^ {\prime \prime}} ^ {X _ {3}, 0}\right) = r + 1 - \dim \left(V _ {\underline {{d}} ^ {\prime \prime}} ^ {X _ {1}, 0} + V _ {\underline {{d}} ^ {\prime \prime}} ^ {X _ {2}, 0} + V _ {\underline {{d}} ^ {\prime \prime}} ^ {X _ {3}, 0}\right)
$$

2. If i + l ≤ d − 1, let d′ := (i, d − i − l − 1, l + 1). Let Vd and Vw, be r + 1-dimensiona subspaces of H0(Ld) and H0(Ld), respectively, such that φdr,d(Vα) = V X3,0. Then the distributivity holds in Vd if and only if

$$
\dim \left(V _ {\underline {{d}} ^ {X _ {1}, 0}} + V _ {\underline {{d}} ^ {X _ {2}, 0}}\right) - \dim \left(V _ {\underline {{d}}} ^ {X _ {1}, 0} + V _ {\underline {{d}}} ^ {X _ {2}, 0}\right) = r + 1 - \dim \left(V _ {\underline {{d}}} ^ {X _ {1}, 0} + V _ {\underline {{d}}} ^ {X _ {2}, 0} + V _ {\underline {{d}}} ^ {X _ {3}, 0}\right),
$$

where the maps φd,d ′ and φd ′,d in Proposition 3.14 are the maps linking the corresponding sheaves. Another important result is Proposition 3.16, which establishes an inequality for any exact limit linear series. Specifically, our Proposition 3.16 says:

Let {(Ld, Vd)}d be an exact limit linear series of degree d and dimension r. Then

$$
\sum_ {\underline {{d}}} \dim \left(\frac {V _ {\underline {{d}}}}{V _ {\underline {{d}}} ^ {X _ {1 , 0}} + V _ {\underline {{d}}} ^ {X _ {2 , 0}} + V _ {\underline {{d}}} ^ {X _ {3 , 0}}}\right) \geq r + 1.
$$

As a conseguence of Proposition 3.14 and Proposition 3.16. in Corollary 3.17. we get the following characterization of exact limit linear series satisfying the distributivity at each multidegree:

Let {(Ld, Vd)}d be an exact limit linear series of degree d and dimension r. Then

$$
\sum_ {\underline {{d}}} \dim \left(\frac {V _ {\underline {{d}}}}{V _ {\underline {{d}}} ^ {X _ {1 , 0}} + V _ {\underline {{d}}} ^ {X _ {2 , 0}} + V _ {\underline {{d}}} ^ {X _ {3 , 0}}}\right) = r + 1
$$

if and only if the distributivity holds in Vd for any d

In Section 3, we also study simple limit linear series. In Proposition 3.18, we characterize the multidegrees which determine all simple bases. In Proposition 3.20, following the construction in Muñoz [5], Proposition 4.4, we present a certain structure of linearly inde pendent sections for any exact limit linear series satisfying the distributivity property. In propositions 3.21 and 3.22, we obtain some properties of that structure. These properties imply the existence of a simple basis (we give a proof of that in Proposition 3.23)

We conclude Section 3 with a characterization of simple limit linear series among the exact limit linear series. Specifically, our Corollary 3.24 says:

Let {(Ld, Vd)}d be an exact limit linear series of degree d and dimension r. Then the following statements are equivalent

1. {(Ld, Vd)}d is simple.

2. ∑ dim d V x1,0 + + V x2,0 Vi

3. The distributivity holds in Vd for any d

In a subsequent work, given a refined limit linear series, we will construct all sim ple extensions by combining our Proposition 3.14 and the method of Muñoz [6] for the construction of all exact extensions.

Convert the content in the image to Markdown

# Model Response

1. If i > 0, let d′′ := (i − 1, d − i − l + 1, l). Let Vd and Vd′′ be r + 1-dimensional subspaces of H0(Ld) and $H ^ { 0 } ( \mathcal { L } _ { \underline { { d } } ^ { \prime \prime } } )$ , respectively, such that $\varphi _ { \underline { { d } } , \underline { { d } } ^ { \prime \prime } } ( V _ { \underline { { d } } } ) = V _ { \underline { { d } } ^ { \prime \prime } } ^ { X _ { 1 } , 0 } .$ . Then the distributivity holds in $V _ { \underline { { d } } ^ { \prime \prime } }$ if and only if

$$
\dim (V _ {\underline {{d}}} ^ {X _ {2}, 0} + V _ {\underline {{d}}} ^ {X _ {3}, 0}) - \dim (V _ {\underline {{d}} ^ {\prime \prime}} ^ {X _ {2}, 0} + V _ {\underline {{d}} ^ {\prime \prime}} ^ {X _ {3}, 0}) = r + 1 - \dim (V _ {\underline {{d}} ^ {\prime \prime}} ^ {X _ {1}, 0} + V _ {\underline {{d}} ^ {\prime \prime}} ^ {X _ {2}, 0} + V _ {\underline {{d}} ^ {\prime \prime}} ^ {X _ {3}, 0})
$$

2. If i+l ≤ d−1, let d′′′ := (i, d−i−l−1, l+1). Let Vd and Vd′′′ be r+1-dimensional subspaces of H0(Ld) andV $H ^ { 0 } ( \underline { { c } } _ { d ^ { \prime \prime \prime } } )$ , respectively, such that $\varphi _ { \underline { { d } } ^ { \prime \prime \prime } , \underline { { d } } } ( V _ { \underline { { d } } ^ { \prime \prime \prime } } ) = V _ { \underline { { d } } } ^ { X _ { 3 } , 0 } .$

$$
\dim (V _ {\underline {{d}} ^ {\prime \prime \prime}} ^ {X _ {1}, 0} + V _ {\underline {{d}} ^ {\prime \prime \prime}} ^ {X _ {2}, 0}) - \dim (V _ {\underline {{d}}} ^ {X _ {1}, 0} + V _ {\underline {{d}}} ^ {X _ {2}, 0}) = r + 1 - \dim (V _ {\underline {{d}}} ^ {X _ {1}, 0} + V _ {\underline {{d}}} ^ {X _ {2}, 0} + V _ {\underline {{d}}} ^ {X _ {3}, 0}),
$$

where the maps φd,d′′ and φd′′′,d in Proposition 3.14 are the maps linking the corresponding sheaves. Another important result is Proposition 3.16, which establishes an inequality for any exact limit linear series. Specifically, our Proposition 3.16 says:

Let {(L , V )} be an exact limit linear series of degree d and dimension r. Then

$$
\sum_ {\underline {{d}}} \dim \left(\frac {V _ {\underline {{d}}}}{V _ {\underline {{d}}} ^ {X _ {1 , 0}} + V _ {\underline {{d}}} ^ {X _ {2 , 0}} + V _ {\underline {{d}}} ^ {X _ {3 , 0}}}\right) \geq r + 1.
$$

As a consequence of Proposition 3.14 and Proposition 3.16, in Corollary 3.17, we get the following characterization of exact limit linear series satisfying the distributivity at each multidegree: Let {(Ld, Vd)}d be an exact limit linear series of degree d and dimension r. Then

$$
\sum_ {\underline {{d}}} \dim \left(\frac {V _ {\underline {{d}}}}{V _ {\underline {{d}}} ^ {X _ {1 , 0}} + V _ {\underline {{d}}} ^ {X _ {2 , 0}} + V _ {\underline {{d}}} ^ {X _ {3 , 0}}}\right) = r + 1
$$

if and only if the distributivity holds in V for any d.

In Section 3, we also study simple limit linear series. In Proposition 3.18, we characterize the multidegrees which determine all simple bases. In Proposition 3.20, following the construction in Muñoz [5], Proposition 4.4, we present a certain structure of linearly independent sections for any exact limit linear series satisfying the distributivity property. In propositions 3.21 and 3.22, we obtain some properties of that structure. These properties imply the existence of a simple basis (we give a proof of that in Proposition 3.23).

We conclude Section 3 with a characterization of simple limit linear series among the exact limit linear series. Specifically, our Corollary 3.24 says:

Let $\{ ( \mathcal { L } _ { \underline { { d } } } , V _ { \underline { { d } } } ) \} _ { \underline { { d } } }$ be an exact limit linear series of degree d and dimension r. Then the following statements are equivalent: 1. {(Ld, Vd)}d is simple. 2.

$$
\Sigma_ {\underline {{d}}} \dim \left(\frac {V _ {\underline {{d}}}}{V _ {\underline {{d}}} ^ {X _ {1 , 0}} + V _ {\underline {{d}}} ^ {X _ {2 , 0}} + V _ {\underline {{d}}} ^ {X _ {3 , 0}}}\right) = r + 1. 3. \text {   The   distributivity   holds   in   } V _ {\underline {{d}}} \text {   for   any   } \underline {{d}}.
$$

In a subsequent work, given a refined limit linear series, we will construct all simple extensions by combining our Proposition 3.14 and the method of Muñoz [6] for the construction of all exact extensions.

Figure 9: Literary writing in multiple languages based on visual stimuli.

# Multilingual Text Recognition

X, t"#", Esn, ttt-3 \$x",5"A17"/"Mm7"1#,—A8#8#7A1oh#M7M0 \$\

AAUUb# 61

Le francais est une langue indo-européenne de la famille des langues romanes dont les locuteurs sont appelés < francophones >.

El español o castellano es una lengua romance procedente del latír hablado, perteneciente a la familia de lenguas indoeuropeas

A linqua portuquesa, também designada portuquês, é uma línqua indoeuropeia romanica flexiva ocidental originada no galego-portugués falado no Reino da Galiza e no norte de Portugal

Is ceann de na teangacha Ceilteacha í an Ghaeilge (nó Gaeilge na hÉireann mar a thugtar uirthi corruair), agus ceann de na tri cinn de theangacha Ceilteacha ar a dtugtar na teangacha Gaelacha (Gaeilge, Gaeilge Mhanann agus Gaeilge na hAlban) go háirithe.

English is a West Germanic language in the Indo-European language family, whose speakers, called Anglophones, originated in early medieval England on the island of Great Britain.

Die deutsche Sprache bzw. Deutsch ist eine westgermanische Sprache, die weltweit etwa 90 bis 105 Millionen Menschen als Muttersprache unc weiteren rund 80 Millionen als Zweit— oder Fremdsprache dient.

Jezyk polski, polszczyzna — jezyk z grupy zachodniostowianskiej (do które alówn czeski kaszubsk stowack jzykituzckie czy wry jezyk drzewianski), stanowiacej czes'rodziny indoeuropejskiej

H EλAnVIKN yλWóOg gVnKELgTny JvOEUOWTTaiKn OUKOVEVEIg KQL gTTOTEλEL to oao´μελoç T ελλnvλa

Tiéng Viet hay Viet nguà mof ngón ngu thuo ngu he Nam Á, dudç cóng nhah là ngôn ngu"chính thu tai Vief Nam.

o X/ Hb M y/ a6 ë XN I

4 B p 3b B P B/ 137,5 M/H 4e/oBek (2010). Bcero B MNpe Ha pycckoM roBopAT 258,2 M/H 4enoBek (2022)

R      R 35  3

Kiswahili ni lugha va Kibantu venye misamiati mingi va Kiarabu (35%) lakini sasa ya Kiingereza pia (10%), inayozungumzwa katika eneo kubwa Ia Afrika ya Mashariki.

转 图中内容，并识别图中 内容的语 。

(Translation: Transcribe the picture and identify the language of each paragraph in it.)

# Model Response

汉语，也称为 华语 。是中国使 人数最 的语 ，也是世 上作为 一语 使 人数最 的语 。是中华优秀传统文化的 要载体。繁体用 多 言 界 第 言字，又 繁中文 ， 化字 字 相。一般是指字化被化字 代替的字。 语 ：中文

日本は地方ごとに な方 があり、とりわけ琉球で方 差が著しい。 语 ：日语

3. 한국어(韓國語), 조선말(朝鮮말)ᄂᆫ대한민국과조선민주주의인민공화국의공용어이다. 둘은표기나ᄆᆫ법에서ᄂᆫ차이가없지만동사어미나표현에서차이가있다. -语 ：韩语

言4. Le français est une langue indo-européenne de la famille des langues romanes dont les locuteurs sont appelés « francophones ». - 语 ：法语

言5. El español o castellano es una lengua romance procedente del latín hablado, perteneciente a la familia de lenguas indoeuropeas. - 语 ：西班 语

牙6. A língua portuguesa, também designada português, é uma língua indo-europeia românica flexiva ocidental originada no galego-português falado no Reino da Galiza e no norte de Portugal. - 语 ：葡萄 语

言 牙7. Is ceann de na teangacha Ceilteacha í an Ghaeilge (nó Gaeilge na hÉireann mar a thugtar uirthi corruair), agus ceann de na trí cinn de theangacha Ceilteacha ar a dtugtar na teangacha Gaelacha (Gaeilge, Gaeilge Mhanann agus Gaeilge na hAlban) go háirithe. - 语 ： 兰语

言 爱尔8. English is a West Germanic language in the Indo-European language family, whose speakers, called Anglophones, originated in early medieval England on the island of Great Britain. - 语 ：英语

言9. Die deutsche Sprache bzw. Deutsch ist eine westgermanische Sprache, die weltweit etwa 90 bis 105 Millionen Menschen als Muttersprache und weiteren rund 80 Millionen als Zweit- oder Fremdsprache dient. - 语 ： 语

10. Język polski, polszczyzna — język z grupy zachodniosłowiańskiej (do której należą również czeski, kaszubski, słowacki, języki łużyckie czy wymarły język drzewiański), stanowiącej część rodziny indoeuropejskiej. - 语 ：波兰语

11. Η ελληνική γλώσσα ανήκει στην ινδοευρωπαϊκή οικογένεια και αποτελεί το μοναδικό μέλος του ελληνικού κλάδου. - 语 ： 希 语

12. Tiếng Việt hay Việt ngữ là một ngôn ngữ thuộc ngữ hệ Nam Á, được công nhận là ngôn ngữ chính thức tại Việt Nam. - 语 ：越南语

13. Монгол хэл нь Монгол улсын албан ёсны хэл юм. - 语 ：蒙古语

\- 语 ：俄语

言16. Kiswahili ni lugha ya Kibantu yenye misamiati mingi ya Kiarabu (35%), lakini sasa ya Kiingereza pia (10%), inayozungumzwa katika eneo kubwa la Afrika ya Mashariki. - 语 ：斯瓦希 语

Figure 10: The model displays an adeptness in recognizing multilingual texts in images.

# Text Information Recognition & Processing

![](images/9f416e11c263b8a813a91b53d1712bde8e6b872efd468fa3f25868d10d8dad39.jpg)

#

A\$T"Ew"4MM.(2i4)x(k)+ \$\*R-.4A24"14. #M#"E"#A #6E.

M-\$(&41"-872M\*147 "M"AAA.A5 " #A4486%228444497

#8\*84 84424\*M.X%.

1541.48+4.

3-11

Translate all the text in the picture into English and standardize the format

# Model Response

The text in the image reads: Learning Prompt

Guo Moruo’s collection of poems, "The Goddess", is a representative work of modern Chinese poetry. It expresses new content and forms, embodying the spirit of the May Fourth Movement. "Standing on the Edge of the Earth" is a representative poem from "The Goddess". The poet imagines standing on the edge of the earth to observe it from all angles, shouting and singing, imagining the surging clouds, magnificent Arctic ice, and violent Pacific Ocean, praising the power to destroy the old world and create a new life. This poem embodies the free, and bold spirit of the May Fourth Movement. When reading, pay attention to connecting with the specific context of the May Fourth Movement to understand the content and form of this poem.

Wen Yiduo’s "Red Candle" uses the classical image of "candle" to give it a new meaning, praising the red candle for its dedication to lighting up the world. Pay attention to how the poet uses the dialogue between "red candle" and "red candle" to express the confusion and hope of youth, as well as the firm pursuit of ideals. The use of fantasy and emotional rhetoric, the use of rhetorical devices such as alliteration and assonance, and the formation of rhythmic beauty through the arrangement of long and short sentences in the poem are also important aspects to appreciate.

Chang Yao’s "Snow Capped Peak on the Side of the Sun" is rich in content. When reading, pay attention to the development of imagination and taste the heavy and majestic atmosphere created by the images of "snow-capped peak", "sun", and "spider". Feel the powerful contained in it.

Shelley’s "To a Skylark" has profound implications and novel imagery. Pay attention to the poet’s emotions and understand the symbolic meaning of the skylark. Grasp the characteristics of the interlocking between sections of the work and appreciate the poet’s use of bold and flexible imagery.

When learning this group of poems, rely more on reading aloud to clarify the emotional context of the poem and grasp the connotation of the image. Feel the emotions expressed by the poet and understand the use of symbolism

Figure 11: Recognition of dense Chinese text. The model is capable of directly converting lengthy, closely packed Chinese characters into standard English with accuracy and fluency.

# Multilingual Text Recognition

![](images/c9c1dbf89d9b2016d12c41a5de05c648d27f9af8a2d070661904b6f0ac924439.jpg)  
What is the text?

# Model Response

The text on the wall is in Portuguese and reads: “não é normal ter medo de andar sozinha na rua!!!” This translates to: “It is not normal to be afraid to walk alone on the street!!!”

Figure 12: The model displays an adeptness in recognizing multilingual texts in images. Image source: (Yang et al., 2023)

# Multilingual Text Recognition

![](images/514f2d93adfba8aac770b5d0918c311a3db95320bd1becc4dc55b56bc7cbf6b4.jpg)

识别图中 有文字，无需添加标点。

所(Translation: Recognize all the text in the image without adding punctuation.)

# Model Response

敬的老师

尊信舒

展 颜气温 降

骤树叶无声无息的掉落

教诲 春

如 风师恩深似海

愿温馨、喜悦与幸福

同吐露芬芳的花朵

如永远洋溢在您幸福的时光

Figure 13: The model displays an adeptness in recognizing multilingual texts in images.

# A.2 Information extraction and Visual Reasoning

A notable advancement in the Qwen2-VL models is their enhanced visual reasoning capability. This advancement allows the models to interpret and comprehend complex representations such as flowcharts, diagrams, and other symbolic systems.

# Mathematical Problem Solving

![](images/93423e34970bd1260e185c675f4bda4fd8200e7fa8adebb54b8cd70d130c5166.jpg)

<details>
<summary>text_image</summary>

A 9x - 1 B
4x + 1 C 5x - 0.5
</details>

Find the length of AC in the isosceles triangle ABC.

# Model Response

Since triangle ABC is isosceles, we know that AC = BC. Therefore, we can set the expressions for AC and BC equal to each other and solve for x

$$
4 x + 1 = 5 x - 0. 5
$$

Subtracting 4x from both sides, we get:

$$
1 = x - 0. 5
$$

Adding 0.5 to both sides, we get:

$$
1. 5 = x
$$

Now that we know the value of x, we can substitute it back into the expression for AC to find its length:

$$
A C = 4 x + 1
$$

$$
A C = 4 (1. 5) + 1
$$

$$
A C = 6 + 1
$$

$$
A C = 7
$$

Therefore, the length of AC is 7.

Figure 14: The model displays an adeptness in solving mathematical problems. Image source: Lu et al. (2021)

# Mathematical Problem Solving

# 3iF()

![](images/4695c3658579d5e7544fe38b7990c5629228299428c9160918b6bf338fad759d.jpg)

Read the image and solve it step by step.

# Model Response

The image shows two geometric figures, a rectangular prism and a cube, with their dimensions labeled. The problem asks to calculate the surface area and volume of these figures.

```txt
1. For the rectangular prism:
Length (l) = 4 cm
Width (w) = 2 cm
Height (h) = 3 cm
Surface Area (SA) of a rectangular prism = 2lw + 2lh + 2wh
Volume (V) of a rectangular prism = lwh
Substituting the given values:
SA = 2(4cm)(2cm) + 2(4cm)(3cm) + 2(2cm)(3cm)
SA = 16cm² + 24cm² + 12cm² SA = 52cm²
V = (4cm)(2cm)(3cm) V = 24cm³ 
```

```txt
2. For the cube:
Side length (a) = 3 dm
Surface Area (SA) of a cube = 6a² Volume (V) of a cube = a³
Substituting the given value:
SA = 6(3dm)² SA = 6(9dm²) SA = 54dm²
V = (3dm)³ V = 27dm³ 
```

So, the surface area and volume for each figure are as follows:

For the rectangular prism:
Surface Area = 52 cm $^{2}$ Volume = 24 cm $^{3}$

For the cube:
Surface Area = 54 dm $^{2}$ Volume = 27 dm $^{3}$   
Figure 15: Solving a math problem. The model calculates the surface area and volume of these figures with step-by-step explanation

# Algorithmic Problem Solving

![](images/40c00b9389642bfe8efb0e0442f239d2ac703487eef4b070ff982af5de92c74d.jpg)

<details>
<summary>text_image</summary>

3248. Snake in Matrix
Easy Companies Hint
There is a snake in an n x n matrix grid and can move in four possible directions. Each cell in the grid is identified by the
position: grid[i][i] = (i * n) * j.
The snake starts at cell 0 and follows a sequence of commands.
You are given an integer n representing the size of the grid and an array of strings commands where each command[i] is either
"UP", "RIGHT", "DOWN", and "LEFT". It's guaranteed that the snake will remain within the grid boundaries throughout its
movement.
Return the position of the final cell where the snake ends up after executing commands.
Example 1:
Input: n = 2, commands = ["RIGHT", "DOWN"]
Output: 3
Explanation:
0 1 0 1 0 1
2 3 2 3 2 3
Example 2:
Input: n = 3, commands = ["DOWN", "RIGHT", "UP"]
Output: 1
Explanation:
50 6 5 6 7 8
</> Code
Python > Auto
class Solution(object):
def finalPositionOfSnake(self, n, commands):
    """
    :type n: int
    :type commands: List[str]
    :rtype: int
    """
Saved
You need to Login / Sign up to run or submit
> Testcase > Test Result
</details>

Solve the algorithmic problem in the web page.

# Model Response

To solve the “Snake in Matrix” problem, we need to implement a function that takes the size of the matrix n and a list of commands, and returns the final position of the snake after executing all the commands. Here’s a step-by-step approach to solve this problem:

# 1. Initialize Variables:

• Initialize the current position of the snake as 0.   
• Initialize the direction of the snake as RIGHT (initially, the snake moves to the right).

# 2. Define Movement Functions:

• Create a function to move the snake based on the current direction and the size of the matrix n.   
• Update the position of the snake accordingly.

# 3. Process Commands:

• Iterate through each command in the list of commands.   
• For each command, update the direction and position of the snake.

# 4. Return Final Position:

• After processing all commands, return the final position of the snake.

Here’s the Python code to implement the solution:   
```python
class Solution:
    def finalPositionOfSnake(self, n: int, commands: List[str]) -> int:
    # Initialize variables
    position = 0
    direction = "RIGHT"
    # Define movement functions
    def move_right():
    nonlocal position
    position += 1
    def move_down():
    nonlocal position
    position += n
    def move_left():
    nonlocal position
    position -= 1
    def move_up():
    nonlocal position
    position -= n
    # Process commands
    for command in commands:
    if command == "RIGHT":
    move_right()
    elif command == "DOWN":
    move_down()
    elif command == "LEFT":
    move_left()
    elif command == "UP":
    move_up()
    # Return final position
    return position 
```

This code defines a class Solution with a method finalPositionOfSnake that takes the size of the matrix n and a list of commands, and returns the final position of the snake after executing all the commands. The movement functions (move\_right, move\_down, move\_left, move\_up) are used to update the position of the snake based on the current direction.

Figure 16: The model displays an adeptness in solving algorithmic problems.

Web Content Recognition   
![](images/d452584f36f485ae63172cf6466dec8b3edef3b6c6f0d34fa3afcbac77128e9b.jpg)

<details>
<summary>text_image</summary>

Google search results page showing Qwen2 and Qwen2 series queries with version, version info, and user feedback
</details>

Extract all page titles in the screenshot of search result.

# Model Response

The page titles in the screenshot of the search result are:

1. 你 ，Qwen2  
2. QwenLM/Qwen2   
3. Qwen2 - a Qwen Collection   
4. 速   
5. Qwen2-7B   
6. Qwen2-Math，新一代数学 型  
7. Qwen   
8. Qwen/Qwen2-7B-Instruct   
9. [2407.10671] Qwen2 Technical Report   
10. qwen2

Figure 17: The model displays an adeptness in recognize content from the web page.

# OCR and Mathematical Problem Solving

Ruka Kayamori   
![](images/37e71693aa760af9251660151b941c9d5bc7da031bc1b67e18712ccbcd4617cb.jpg)

<details>
<summary>text_image</summary>

A SS
Personal information
</details>

Yuki Izumi   
![](images/517b122dcea1668d02725beac7f3771b2fb3c48ec6470aa61bd10f6a35e0ecf6.jpg)

<details>
<summary>natural_image</summary>

Illustration of a character in blue with glowing green effects, no visible text or symbols
</details>

Japanese \* Name

Addresses atashi (5L) self as

Height 159cm

Birthday 24 June

Personal information

Japanese 01 Name

Addresses atashi(L self as

Height 160cm

Birthday 17 September

Seraphim Informatior   
![](images/e0637cb597c3f608c0e88692157fd3f7605e2495b70f9ae760357dca047e9182.jpg)

Seraphim Brave Blue Brave Blue Weapon

![](images/91eec1677bcf7b247f67d39e3fb70535d36dc067e76868a89b03af55e47da010.jpg)

Seraphim Code My legend is starting now

Seraphim Information   
![](images/03b78480b076c34ce8a120b408ac2138e13248216e89e2fc5e87583e406241c0.jpg)

Seraphim Weapon Rapid Fire

Seraphim Hello World Code

![](images/829edb6c1e97066e1be13d8e75d346a3b318ded44e854ad23f2593c473aeca8a.jpg)

Please tell me how many days are between Ruka’s birthday and Yuki’s birthday? Think carefully step by step.

# Model Response

To determine the number of days between Ruka’s and Yuki’s birthdays, we need to calculate the difference between their respective birth dates.

1. Ruka’s birthday is on June 24.   
2. Yuki’s birthday is on September 17.

Let’s break it down step by step:

1. From June 24 to June 30:

• June 24 to June 30 is 6 days.

2. From July 1 to August 31:

• July has 31 days.   
• August has 31 days.   
• Total days in July and August: 31 + 31 = 62 days.

3. From September 1 to September 17:

• September 1 to September 17 is 17 days.

Now, we add all these days together:

• June 24 to June 30: 6 days   
• July 1 to August 31: 62 days   
• September 1 to September 17: 17 days

Total days = 6 + 62 + 17 = 85 days

Therefore, there are 85 days between Ruka’s and Yuki’s birthdays.

Figure 18: The model displays an adeptness in OCR and mathematical reasoning.

# OCR and Format Following

# The Linux Kernel Archives

![](images/f1800f838e33a77cc9898789c8d4fa9bcf43a3a5391eb99aaf919ead30d08de9.jpg)

Protocol Location HTTP https://www.kerneLorg/pub/ RSYNC rsync://rsync.kernel.org/pub/

![](images/98b626635956164ac9e18a58a32e9713b455be5494fcf914b9d57f3ca2a4bd8d.jpg)

<table><tr><td>mainline:</td><td>6.11-rc3</td><td>2024-08-11</td><td>[tarbail]</td><td>[patch]</td><td>[inc. patch]</td><td>[view diff]</td><td>[browse]</td></tr><tr><td>stable:</td><td>6.10.4</td><td>2024-08-11</td><td>[tarbail]</td><td>[pgp]</td><td>[patch]</td><td>[inc. patch]</td><td>[view diff]</td></tr><tr><td>stable:</td><td>6.9.12 [EOL]</td><td>2024-07-27</td><td>[tarbail]</td><td>[pgp]</td><td>[patch]</td><td>[inc. patch]</td><td>[view diff]</td></tr><tr><td>longterm:</td><td>6.6.45</td><td>2024-08-11</td><td>[tarbail]</td><td>[pgp]</td><td>[patch]</td><td>[inc. patch]</td><td>[view diff]</td></tr><tr><td>longterm:</td><td>6.1.104</td><td>2024-08-11</td><td>[tarbail]</td><td>[pgp]</td><td>[patch]</td><td>[inc. patch]</td><td>[view diff]</td></tr><tr><td>longterm:</td><td>5.15.164</td><td>2024-07-27</td><td>[tarbail]</td><td>[pgp]</td><td>[patch]</td><td>[inc. patch]</td><td>[view diff]</td></tr><tr><td>longterm:</td><td>5.10.223</td><td>2024-07-27</td><td>[tarbail]</td><td>[pgp]</td><td>[patch]</td><td>[inc. patch]</td><td>[view diff]</td></tr><tr><td>longterm:</td><td>5.4.281</td><td>2024-07-27</td><td>[tarbail]</td><td>[pgp]</td><td>[patch]</td><td>[inc. patch]</td><td>[view diff]</td></tr><tr><td>longterm:</td><td>4.19.319</td><td>2024-07-27</td><td>[tarbail]</td><td>[pgp]</td><td>[patch]</td><td>[inc. patch]</td><td>[view diff]</td></tr><tr><td>linux-next:</td><td>next-20240812</td><td>2024-08-12</td><td></td><td></td><td></td><td></td><td>[browse]</td></tr></table>

Other resources 

<table><tr><td>Git Trees</td><td>Documentation</td><td>Kernel Mailing Lists</td></tr><tr><td>Patchwork</td><td>Wikis</td><td>Bugzilla</td></tr><tr><td>Mirrors</td><td>Linux.com</td><td>Linux Foundation</td></tr></table>

Social 

<table><tr><td>Site Atom feed Releases Atom Feed Kernel Planet</td></tr></table>

What are the Linux versions and their release dates in the picture? Return results as a JSON list.

# Model Response

```json
[
    {
    "version": "6.11-rc3", "release_date": "2024-08-11"
    },
    {
    "version": "6.10.4", "release_date": "2024-08-11"
    },
    {
    "version": "6.9.12 [EOL]", "release_date": "2024-07-27"
    },
    {
    "version": "6.6.45", "release_date": "2024-08-11"
    },
    {
    "version": "6.1.104", "release_date": "2024-08-11"
    },
    {
    "version": "5.15.164", "release_date": "2024-07-27"
    },
    {
    "version": "5.10.223", "release_date": "2024-07-27"
    },
    {
    "version": "5.4.281", "release_date": "2024-07-27"
    },
    {
    "version": "4.19.319", "release_date": "2024-07-27"
    },
    {
    "version": "next-20240812", "release_date": "2024-08-12"
    }
] 
```  
Figure 19: The model displays an adeptness in OCR and following formats.

OCR and Format Following   
![](images/9525c7d0ce790fe4a68d66e3cc7d5e86882f36ccc6636970b6c098758c29285a.jpg)

<details>
<summary>text_image</summary>

北京
23° 多云 东北风4级
22~30°C 14 优
气温
现在
23°
08:00
风力
24°
09:00
降水量
24°
10:00
紫外线
26°
11:00
27°
12:00
优
优
优
优
优
13:00
28°
14:00
30°
15:00
优
优
优
优
优
优
优
07:51更新
</details>

15   
![](images/aee2ae7d90b945411c92fd93411c2028c8d9fbcf0740deae39428534f033faec.jpg)

<details>
<summary>line</summary>

| 日期 | 今天 | 明天 | 周四 | 周五 | 周六 | 周日 | 周一 |
|---|---|---|---|---|---|---|---|
| 08/12 | 31° | 30° | 31° | 31° | 30° | 30° | 30° |
| 08/13 | 30° | 30° | 31° | 31° | 30° | 30° | 30° |
| 08/14 | 23° | 22° | 24° | 24° | 24° | 23° | 22° |
| 08/15 | 23° | 23° | 24° | 24° | 24° | 23° | 22° |
| 08/16 | 24° | 24° | 24° | 24° | 24° | 23° | 22° |
| 08/17 | 70% | 60% | 60% | 60% | 60% | 60% | 60% |
| 08/18 | 70% | 70% | 70% | 70% | 70% | 70% | 70% |
| 08/19 | 70% | 70% | 70% | 70% | 70% | 70% | 70% |
</details>

51   
图中的 日的最 气温和最低气温整理 表格。(Translation: Organize the daily highest and将 每 高 成lowest temperatures from the image into a table.)

Model Response   
以下是图中 日的最 气温和最低气温整理 的表格：

<table><tr><td>日期</td><td>最高气温</td><td>最低气温</td></tr><tr><td>08/12</td><td>31°C</td><td>23°C</td></tr><tr><td>08/13</td><td>30°C</td><td>22°C</td></tr><tr><td>08/14</td><td>30°C</td><td>23°C</td></tr><tr><td>08/15</td><td>31°C</td><td>24°C</td></tr><tr><td>08/16</td><td>31°C</td><td>24°C</td></tr><tr><td>08/17</td><td>30°C</td><td>24°C</td></tr><tr><td>08/18</td><td>30°C</td><td>23°C</td></tr><tr><td>08/19</td><td>30°C</td><td>22°C</td></tr></table>

希望这对你有帮助！

Figure 20: The model displays an adeptness in OCR and following formats.

# OCR for Large Images

![](images/8c57be00ea5338ac9f3e34c503ed26b2c77718e2f05c47797530e0b1eb92ee06.jpg)

![](images/e1672a004031058dc6866cb99ca6132ba3438e39aebf6bc50d57f9c87eb95989.jpg)

<details>
<summary>text_image</summary>

Scanned document with multiple columns of text, tables, and a red arrow pointing to a highlighted section
</details>

Original Image (1792 x 14400)

#

en--ax-0809#

#150M   
#MP4AVIMKVMOVFLVWMV   
R#600#T

Cropped region related to the question.

Note: The cropping effect is only for visualization. The original image is directly used as the input of the model, without any crop.

qwen-vl-max-0809对视 内容的理解功能存在哪些限制？

频(Translation: What limitations exist in qwen-vl-max-0809’s ability to understand video content?)

# Model Response

qwen-vl-max-0809对视 内容的理解功能存在以下限制：视 文件 最 为150MB，视 文件频 频 大小 大 频格 支持MP4、AVI、MKV、MOV、FLV、WMV ，视 寸无限制，但视 文件会被 整到式 等 频尺 频 调约600K像素数，更 寸的视 文件不会有更 的理解效果。(Translation: qwen-vl-max-0809 has大尺 频 好the following limitations on the video content understanding: the maximum video file size is 150MB,the video file formats supported are MP4, AVI, MKV, MOV, FLV, WMV, etc. There is no limitation onthe video size, but the video file will be resized to about 600K pixels, and video files of larger sizeswon’t have better video understanding results.)

Figure 21: The model displays an adeptness in large images OCR.

# A.3 Video Understanding

# Multi-Round Video Chat

![](images/386d60b8aace12a26eba1ee0022c7d8d397227d23816ce718030691bbb5a5b47.jpg)

Please describe the video in detail.

# Model Response

The video begins with a man speaking to the camera, followed by a group of people sitting in a control room. The camera then cuts to two men floating inside a space station, where they are seen speaking to the camera. The men appear to be astronauts, and they are wearing space suits. The space station is filled with various equipment and machinery, and the camera pans around to show the different areas of the station. The men continue to speak to the camera, and they appear to be discussing their mission and the various tasks they are performing. Overall, the video provides a fascinating glimpse into the world of space exploration and the daily lives of astronauts.

# User Query

What is the color of the clothes the two astronauts wearing?

# Model Response

The two astronauts are wearing blue and black clothes.

Figure 22: The model displays an adeptness in recognizing multi-round video chat.

# Multi-Video Understanding

![](images/0dce22b64220c68c049955cc7000e39a12856b32ee7c4cc24d875c466a6d974c.jpg)

<details>
<summary>natural_image</summary>

Grid of 20 identical photos showing a room interior with furniture and objects, no visible text or symbols
</details>

视 中的人在做什么？

频(Translation: What are the people in the video doing?)

# Model Response

视 中的人 在使 吸 器清理地板。

(Translation: The man in the video is using a vacuum cleaner to clean the floor.)

# User Query

果要进一 清洁地面的话，接下来该怎么做？

(Translation: What should I do next if I want to clean the floor further?)

# Model Response

果要进一 清洁地面，可以使 湿布 地面，以去除吸 器无法清除的污渍和灰 。

如 步 用拖把或 擦拭 尘 尘(Translation: For further cleaning of the floor, wipe the floor with a mop or damp cloth to remove stains and dirt that the vacuum cleaner cannot remove.)

# User Query

![](images/13b2c9758fe0e0568b6da743e421d82f6c9cfb2984a1d865eac3c85ee711134f.jpg)

<details>
<summary>natural_image</summary>

Grid of 20 close-up photos showing interior bathroom fixtures and fixtures, no visible text or symbols
</details>

已经 清洁了地面，评价一下清洁工作？

(Translation: Already cleaned the floor with a mop and please comment on the cleaning?)

# Model Response

从视 中可以看出，清洁工作已经完 ，地面已经变 干净整洁。

(Translation: As you can see from the video, the cleaning has been completed and the floor has been made clean and tidy.)

# User Query

通过你看到的，接下来还能做些什么？

(Translation: By what you see, what else can you do next?)

# Model Response

接下来可以 清洗干净，晾干 。

(Translation: Next you can clean the mop, dry it and set it aside.)

Figure 23: The model displays an adeptness in recognizing multi-video understanding.

# A.4 Visual Agent Capability

The Qwen2-VL also excels in location and agent tasks.

# Locate Whatever You Desire

![](images/178fa46bc525896a9c103f7d706fa2c8aff02a911ef3a24b3f7d5e194e090c99.jpg)

<details>
<summary>natural_image</summary>

Aerial view of a parking lot with multiple lanes of parked cars and vehicles, no visible text or signage.
</details>

Detect the bounding box of ’the red car’

# Model Response

<|object\_ref\_start|>the red car<|object\_ref\_end|><|box\_start|>(701,531),(869,675)<|box\_end|>

![](images/fccaabb0ade1dd231c5c08b4a4f2b4d2c9d6e0c9c15ea61d9c93db59939f9b15.jpg)

<details>
<summary>natural_image</summary>

Aerial view of a parking lot with rows of parked cars and a red car on the ground (no visible text or symbols)
</details>

Figure 24: Our models were able to locate specific elements within images, such as identifying the red car accurately.

# Visual Referring Prompting

![](images/509dd119611004bae557d1fbffd2cb2ec67f83cdf4b1991ba683270348bc483e.jpg)

What does the pointed news talk about?

# Model Response

The pointed news with a green logo of OpenAI and a title "Le chatbot ChatGPT d’OpenAI dispose désormais d’instructions personnalisées pour stocker vos préférences" is talking about the new feature of ChatGPT that can now store personalized instructions to better serve users.

Figure 25: Our model is capable of annotating and posing questions regarding the content present in webpage screenshots, demonstrating its potential as a visual agent. Image source: (Yang et al., 2023)

# Function Calling - Basic

![](images/8e936047ef855e06de66c351667532a76270077c479b07d7e8fa38d48e97b5b3.jpg)

<details>
<summary>text_image</summary>

11:59 ↑
中国国航CA1723 星空联盟
杭州萧山T4-北京首都T3
计划2024-07-30 18:00-20:30
空客330-300(X)
机龄14.4年 编号B6512
航班计划
预计起飞时间18:00 >
</details>

几点到达，到的时候目的地 气怎么样

天(Translation: What time does this flight arrive? What is the weather like at the destination when it arrives?)

# Function Input

北京

# Function Result

<table><tr><td>时间: 2024-07-30 14:00, 风向: 西南风, 风力: 0-3级微风&lt;5.4m/s, 温度: 29°C, 天气: 小雨</td></tr><tr><td>时间: 2024-07-30 15:00, 风向: 西南风, 风力: 0-3级微风&lt;5.4m/s, 温度: 28°C, 天气: 小雨</td></tr><tr><td>时间: 2024-07-30 16:00, 风向: 西南风, 风力: 0-3级微风&lt;5.4m/s, 温度: 28°C, 天气: 小雨</td></tr><tr><td>时间: 2024-07-30 17:00, 风向: 西南风, 风力: 0-3级微风&lt;5.4m/s, 温度: 28°C, 天气: 小雨</td></tr><tr><td>时间: 2024-07-30 18:00, 风向: 西南风, 风力: 0-3级微风&lt;5.4m/s, 温度: 27°C, 天气: 中雨</td></tr><tr><td>时间: 2024-07-30 19:00, 风向: 南风, 风力: 0-3级微风&lt;5.4m/s, 温度: 27°C, 天气: 中雨</td></tr><tr><td>时间: 2024-07-30 20:00, 风向: 南风, 风力: 0-3级微风&lt;5.4m/s, 温度: 27°C, 天气: 中雨</td></tr><tr><td>时间: 2024-07-30 21:00, 风向: 南风, 风力: 0-3级微风&lt;5.4m/s, 温度: 26°C, 天气: 小雨</td></tr><tr><td>时间: 2024-07-30 22:00, 风向: 南风, 风力: 0-3级微风&lt;5.4m/s, 温度: 26°C, 天气: 小雨</td></tr><tr><td>时间: 2024-07-30 23:00, 风向: 南风, 风力: 0-3级微风&lt;5.4m/s, 温度: 26°C, 天气: 小雨</td></tr><tr><td>(避免显示过长,省略部分信息。)</td></tr></table>

# Model Response

根据航班信息，您乘坐的中国国航CA1723航班 计 于2024年7月30日20:30 达北京首都机场T3航

站楼在您到达时，北京的 气 显示会有中雨，并且温度约为27℃。请注意 带雨具并做 防雨措施。祝您旅途愉 ！

快(Translation: According to flight information, your Air China flight CA1723 is expected to arrive at Beijing Capital Airport T3 Terminal at 20:30 on July 30, 2024. When you arrive, the weather forecast in Beijing shows moderate rain and the temperature is about 27℃. Please remember to bring rain gear and take rain protection measures. Have a pleasant journey!)

Figure 26: The model identified the destination and arrival time in the image, called the 24-hour weather query function, correctly input the destination, and extracted the weather at the arrival time from the query results, thus enabling it to answer the user’s question.

Function Calling - Code Interpreter   
![](images/91eac48f8dda44b120dbcdc48c74e0e5cecd05abb8498b7515a6fab59613e0ad.jpg)

<details>
<summary>flowchart</summary>

```mermaid
graph LR
    A["talk about the weather in San Francisco."] --> B["Speech understanding"]
    B --> C["Llama 3"]
    C --> D["Speech generation"]
    D --> E["Output audio"]
    C --> F["Dialogue history optional"]
    C --> G["Speech adapter"]
    G --> H["Speech ENCODER"]
    H --> I["System prompt optional"]
    C --> J["text normalization"]
    J --> K["Prosody model"]
    K --> L["Synthesizer"]
    C --> M["The weather in San Francisco is known for being quite unique and unpredictable..."]
```
</details>

Figure 29 Architecture of our speech interface for Llama 3.

Implement the flowchart, representing modules as functions without implementation details. Write the code and validate it using the code interpreter.

Function Input   
```python
# Placeholder functions for the modules
def speech_adapter(input_audio):
    # Placeholder for speech adapter implementation
    pass

# To avoid excessive length,
# the remaining functions without implementation details are omitted here.

# Example usage
input_audio = "talk about the weather in San Francisco."
speech_adapter_output = speech_adapter(input_audio)
speech_encoder_output = speech_encoder(speech_adapter_output)
system_prompt_output = system_prompt()
dialogue_history_output = dialogue_history()
llama_3_output = llama_3(speech_encoder_output, system_prompt_output, \
dialogue_history_output)
text_normalization_output = text_normalization(llama_3_output)
prosody_model_output = prosody_model(text_normalization_output)
output_audio = synthesizer(prosody_model_output) 
```

# Function Result

Finished execution.

# Model Response

The code has been executed without any errors, which means that the structure of the code matches the flowchart and there are no syntax issues. However, since the functions are placeholders and do not perform any actual operations, we cannot validate the correctness of the implementation. The code simply represents the flowchart by defining each module as a function and demonstrating how the functions could be called in sequence to process input audio and produce output audio.

Figure 27: The model identified the steps in the flowchart, drafted the simulation code as required while omitting the details, and then successfully executed it through the code interpreter. Image source: (Dubey et al., 2024)

# Function Calling - Code Interpreter

<table><tr><td>Model</td><td>HumanEval</td><td>HumanEval+</td><td>MBPP</td><td>MBPP EvalPlus (base)</td></tr><tr><td>Llama 3 8B</td><td>72.6 ±6.8</td><td>67.1 ±7.2</td><td>60.8 ±4.3</td><td>72.8 ±4.5</td></tr><tr><td>Gemma 2 9B</td><td>54.3 ±7.6</td><td>48.8 ±7.7</td><td>59.2 ±4.3</td><td>71.7 ±4.5</td></tr><tr><td>Mistral 7B</td><td>40.2 ±7.5</td><td>32.3 ±7.2</td><td>42.6 ±4.3</td><td>49.5 ±5.0</td></tr><tr><td>Llama 3 70B</td><td>80.5 ±6.1</td><td>74.4 ±6.7</td><td>75.4 ±3.8</td><td>86.0 ±3.5</td></tr><tr><td>Mixtral 8×22B</td><td>75.6 ±6.6</td><td>68.3 ±7.1</td><td>66.2 ±4.1</td><td>78.6 ±4.1</td></tr><tr><td>GPT-3.5 Turbo</td><td>68.0 ±7.1</td><td>62.8 ±7.4</td><td>71.2 ±4.0</td><td>82.0 ±3.9</td></tr><tr><td>Llama 3 405B</td><td>89.0 ±4.8</td><td>82.3 ±5.8</td><td>78.8 ±3.6</td><td>88.6 ±3.2</td></tr><tr><td>GPT-4</td><td>86.6 ±5.2</td><td>77.4 ±6.4</td><td>80.2 ±3.5</td><td>83.6 ±3.7</td></tr><tr><td>GPT-4o</td><td>90.2 ±4.5</td><td>86.0 ±5.3</td><td>81.4 ±3.4</td><td>87.8 ±3.3</td></tr><tr><td>Claude 3.5 Sonnet</td><td>92.0 ±4.2</td><td>82.3 ±5.8</td><td>76.6 ±3.7</td><td>90.5 ±3.0</td></tr><tr><td>Nemotron 4 340B</td><td>73.2 ±6.8</td><td>64.0 ±7.3</td><td>75.4 ±3.8</td><td>72.8 ±4.5</td></tr></table>

Table 18 Pass@1 scores on code generation benchmarks. We report results on HumanEval (Chen et al., 2021), MBPP (Austin et al., 2021), as well as EvalPlus (Liu et al., 2024a) versions of these benchmarks.

Count the average value of each row in this chart and draw a bar chart to show it. Write the code and verify it using the code interpreter.

# Function Input

```python
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# Extracting the numerical values from the table
data = {
    "Model": ["Llama 3 8B", "Gemma 2 9B", "Mistral 7B", "Llama 3 70B", \
    "Mixtral 8x22B", "GPT-3.5 Turbo", "Llama 3 405B", "GPT-4", \
    "GPT-4o", "Claude 3.5 Sonnet", "Nemotron 4 340B"],
    "HumanEval": [72.6, 54.3, 40.2, 80.5, 75.6, 68.0, 89.0, 86.6, 90.2, \
    92.0, 73.2],
    "HumanEval+": [67.1, 48.8, 32.3, 74.4, 68.3, 62.8, 82.3, 77.4, 86.0, \
    82.3, 64.0],
    "MBPP": [60.8, 59.2, 42.6, 75.4, 66.2, 71.2, 78.8, 80.2, 81.4, 76.6, \
    75.4],
    "MBPP EvalPlus (base)": [72.8, 71.7, 49.5, 86.0, 78.6, 82.0, 88.6, \
    83.6, 87.8, 90.5, 72.8]
}

# Create a DataFrame
df = pd.DataFrame(data)

# Calculate the average for each row
df["Average"] = df.mean(axis=1)

# Plotting the bar chart
plt.figure(figsize=(12, 6))
plt.bar(df["Model"], df["Average"], color="skyblue")
plt.xlabel("Model")
plt.ylabel("Average Score")
plt.title("Average Pass@1 Scores on Code Generation Benchmarks")
plt.xticks(rotation=45, ha="right")
plt.tight_layout()
plt.show() 
```

Function Result   
![](images/0b024bb41cd4b9fef16b393017b871017d8bd1682e4836632eac9f0e2ee8bb1d.jpg)

<details>
<summary>bar</summary>

Average Pass@1 Scores on Code Generation Benchmarks
| Model | Average Score |
| :--- | :--- |
| Llama 3 8B | 68.5 |
| Gemma 2 9B | 58.5 |
| Mistral 7B | 41.0 |
| Llama 3 70B | 79.0 |
| Mixtral 8x22B | 72.5 |
| GPT-3.5 Turbo | 71.0 |
| Llama 3 405B | 84.5 |
| GPT-4 | 81.5 |
| GPT-4o | 85.5 |
| Claude 3.5 Sonnet | 84.5 |
| Nemotron 4 340B | 71.5 |
</details>

# Model Response

The average Pass@1 scores on code generation benchmarks for each model have been calculated and are displayed in the table above. The bar chart shows the average scores for each model, providing a visual comparison of their performance across the different benchmarks.

Figure 28: The model analyzed the table, and wrote the code to calculate the mean of each row in the table and to plot the results as a bar chart, which was successfully executed and visualized by the code interpreter. Image source: (Dubey et al., 2024)

# Function Calling - Code Interpreter

# 2.2.2 QWEN2 MIXTURE-OF-EXPERTS MODEL

The architecture of Qwen2 MoE models closely mirrors that of Qwen1.5-MoE-A2.7B (Qwen Team, 2024c). As a substitute for the original FFN, the MoE FFN consists of n individual FFNs, each serving as an expert. Each token is directed to a specific expert Ei for computation based on probabilities assigned by a gated network G:

$$
\mathbf {p} = \operatorname{softmax} (G (\mathbf {x})), \tag {1}
$$

$$
\mathbf {y} = \sum_ {i \in \operatorname{top} _ {k} (\mathbf {p})} \mathbf {p} _ {i} E _ {i} (\mathbf {x}). \tag {2}
$$

In the following, we present critical design considerations of Qwen2 MoE.

Implement the formula, write the code and verify it using the code interpreter.

# Function Input

```python
import numpy as np

def softmax(x):
    """Compute softmax values for each sets of scores in x."""
    e_x = np.exp(x - np.max(x))
    return e_x / e_x.sum(axis=0)

def top_k(p, k):
    """Return the indices of the top k elements in the probability vector p."""
    return np.argsort(p)[-k:][::-1]

# Example input
x = np.array([1, 2, 3, 4, 5]) # Example input vector
G = lambda x: x # Simple gating network (identity function for demonstration)
E = lambda x, i: x + i # Simple expert functions (add the expert index to the input)
# Compute probabilities
p = softmax(G(x))
# Select top k experts
k = 3
top_experts = top_k(p, k)
# Compute output
y = np.sum([p[i] * E(x, i) for i in top_experts])
p, top_experts, y 
```

# Function Result

(array([0.01165623, 0.03168492, 0.08612854, 0.23412166, 0.63640865]), array([4, 3, 2]), 31.451165958047895)

# Model Response

The probabilities assigned to each expert based on the input vector (x) are: (p = [0.01165623, 0.03168492, 0.08612854, 0.23412166, 0.63640865]).

The top (k = 3) experts selected based on these probabilities are the experts with indices 4, 3, and 2 (in descending order of probability). The output (y) computed as a weighted sum of the outputs of these top experts is approximately 31.4512.

This example demonstrates a simple implementation of the MoE model’s operation. In a real-world scenario, the gating network (G) and the experts (Ei) would be more complex, involving neural network layers and potentially non-linear transformations.

Figure 29: The model understood the formula, implemented the code as required, and successfully executed it in the code interpreter to obtain the results. Image source: (Dubey et al., 2024)

# VL Agent - UI Operations

![](images/99aea6b1bc3f097923a0e2285770714db67fc931bfb411e24b66f81b726fa23a.jpg)

<details>
<summary>text_image</summary>

Set up email
Google
Outlook, Hotmail, and Live
Yahoo
Exchange and Office 365
Other
</details>

Screenshot\_1

![](images/ec23f5e0561d5d59ae73358c4afdebf1cd3cfb1c82575afa59ecfe372c09f21f.jpg)

<details>
<summary>text_image</summary>

Monday Oct 10 59:17
</details>

Screenshot 2

![](images/49ddca666507e81d251cac470c77b3d5bf3c26a9cec5e20769e78734f38edd5d.jpg)

<details>
<summary>text_image</summary>

Monday, Oct 10 58'17
</details>

Screenshot 3

![](images/976c735768dd40061f2555788a9e03e430867042182e224c0651c6f27b7c201a.jpg)

<details>
<summary>text_image</summary>

Google
speed of a skateboard
All Images Videos Shopping News Book
Sponsored
Shop speed of a skateboard
Tearngee H20T
Electric...
$529.00
Tearngee
Free shipping
Maxfind MAX2
PRO X Electric...
$594.00
maxfind
Free shipping
Teaj
Black
$39
Teaj
Free
</details>

Screenshot 4

![](images/cc1e99c96bbebd988718dadd634c0d646202acba59c8d15a8dac12d9f88fd834.jpg)

<details>
<summary>text_image</summary>

Google
speed of a skateboard
All Images Videos Shopping News Book
Sponsored
Shop speed of a skateboard
Teamgee H20T
Electric...
$529.00
Teamgee
Free shipping
Maxfind MAX2
PRO X Electric...
$594.00
maxfind
Free shipping
Tea
Black
$39
Tea
Free
</details>

Screenshot 5

![](images/0c3513a9c9c27e4b7f715997a9df8e2973cf758efbebd9da5b6e510568646949.jpg)

<details>
<summary>text_image</summary>

speed of a skateboard
skateboard speed km/h
how fast can you go on a skateboard
downhill
fastest skateboard speed
how fast is skateboarding compared
to biking
how fast is skateboarding compared
to walking
how fast can a longboard go on flat
ground
how fast can you skate on ice
longboard average speed
</details>

Screenshot 6

![](images/83793f67d4e3ab67b31dafcb6cf80d958dc6c4ea2e88dcbf8fff0bee54d2f757.jpg)

<details>
<summary>text_image</summary>

speed of a skateboard
skateboard speed km/h
how fast can you go on a skateboard
downhill
fastest skateboard speed
how fast is skateboarding compared
to biking
how fast is skateboarding compared
to walking
how fast can s longboard go on flat
ground
how fast can you skate on ice
longboard average speed
</details>

Screenshot 7

![](images/476f6d1b5c171a3067dc5d0be10ad7fe231a9719f12223f12a5518b726104f95.jpg)

<details>
<summary>text_image</summary>

speed of a skateboard
hotels in nyc
good greek restaurants
how do i get to the nearest best
buy?
what's on the menu at subway
what's the top post on Reddit today?
latest news in tech?
what is the capital of germany?
Trending searches
fort Wayne indiana mayor tom henry
ted lasso season 3
iga swiatek barbora krejcikova
</details>

Screenshot 8

![](images/07d860c3f24f69f41d253509fa19d6d218764ae9e228a30b1b65753253ac28e6.jpg)

<details>
<summary>text_image</summary>

aats a good restaurant in San Diego?
what are the best restaurants in san
diego
what is the most popular restaurant
in san diego
number 1 restaurant in san diego
good restaurants in san diego
san diego most famous restaurants
...
what's a good restaurant in san diego
o california
...
what's a good restaurant in san diego
o for lunch
...
what's a good restaurant in san diego
o to eat
</details>

Screenshot 9

![](images/dfe7ff9934cff4fa33e84e47f56c2e1a125133286df7f4ce33acd8570a74f747.jpg)

<details>
<summary>text_image</summary>

Google search results page for 'San Diego' restaurant, showing top rankings and price tags
</details>

Screenshot 10

# System Message

You are a helpful assistant.

\# Actions

\## You have the following actions.

\### Click

Click: A quick, light fingertip press that commands, selects, or navigates through a phone’s user interface. Parameters: [{"name": "point", "description": "The specific point of interest on the screen, marked by the coordinate (x, y)." "required": true, "schema": "string"}]

\### Type

Type: Engaging with a smartphone’s interface by entering text for various purposes like messaging, searching, or command execution. Parameters: [{ "name": "text", "description": "The text to be typed on a smartphone.", "required": true, "schema": "string"}]

\### Swipe

Swipe: Touch the screen and move your finger to a new location for new content. Parameters: ["name": "direction", "description": "Determine the swipe route from the cardinal directions: up, down, left, or right." "required": true, "schema": "string", "choices": ["up", "down", "left", "right"]]

\### Back

Back: Go in reverse to the prior interface or exiting the current context Parameters: []

\### Home

Home: Return to the device’s home screen from any application or task. Parameters: []

\### Enter

Enter: Execute a command to confirm inputs or selections. Parameters: []

\### Done

Done: Indicate the completion of a task. Parameters: []

# VL Agent - UI Operations

\## Continuously take action until the task is completed.

\*FUNCTION\*: The action to take, should be one of {Click,Type,Swipe,Back,Home,Enter,Done}

\*ARGS\*: The input of the action.

\*RESULT\*: Action results.

\*RETURN\*: Reply based on action results.

# User

Your task is: What’s a good restaurant in San Diego?

![](Screenshot\_1)

# Assistant

The screen shows the email setup page, which is not relevant to finding a restaurant. Possible actions are to exit the em ail setup and navigate to a search engine or map application where I can look up restaurants in San Diego. \*FUNCTION\*: Home \*ARGS\*: {}

\*RESULT\*: ![](Screenshot\_2)

\*RETURN\*: The screen shows the home screen with various apps, including Google Chrome and Maps which could be used to search for a restaurant in San Diego. Possible actions are to tap on the Google Chrome app to open it and then use it to search for a good restaurant in San Diego.

\*FUNCTION\*: Click \*ARGS\*: {"point": "(687, 792)"}

\*RESULT\*: ![](Screenshot\_4)

\*RETURN\*: The current screen shows search results for skateboards, which is not related to the query about finding a good restaurant in San Diego. Possible actions are to click on the Google search bar at the top of the screen and enter the correct search term "good restaurant in San Diego" to find relevant information.

\*FUNCTION\*: Click \*ARGS\*: {"point": " (596, 213)"}

\*RESULT\*: ![](Screenshot\_6)

\*RETURN\*: The current screen shows search suggestions related to skateboard speeds, which is not relevant to the query about finding a good restaurant in San Diego. Possible actions are to click on the "X" button to he correct query for finding a good restaurant in San Diego.

\*FUNCTION\*: Click \*ARGS\*: {"point": "(927, 135)"}

\*RESULT\*: ![](Screenshot\_8)

\*RETURN\*: The screen shows the Google search bar with a list of previous searches, none of which are related to finding a restauran t in San Diego. Possible actions are to type "good restaurant in San Diego" into the search bar and then press enter to perform the search.

\*FUNCTION\*: Type \*ARGS\*: {"text": "What’s a good restaurant in San Diego?"}

\*RESULT\*: ![](Screenshot\_9)

\*RETURN\*: The screen shows a list of search suggestions related to finding good restaurants in San Diego, indicating that the user has typed in a query but not yet executed it. Possible actions are to select one of the suggested searches or press enter on the keyboard to execute the current search and view the results.

\*FUNCTION\*: Enter \*ARGS\*: {}

\*RESULT\*: ![](Screenshot\_10)

\*RETURN\*: The screen shows a list of top-rated restaurants in San Diego with details such as ratings, price range, and opening hours. Possible actions are to stop and set the query as completed.

\*FUNCTION\*: Done \*ARGS\*: {}

Figure 30: Qwen2-VL as an agent understands the query with respect to UI operation, utilizes the pre-defined actions in system message, and fulfill the task step-by-step.

# VL Agent - Card Game

![](images/64f376cf761f6cdf08b8327c9df5351e13effe984fb002236cbe7337321b384f.jpg)

<details>
<summary>text_image</summary>

Dealer
Player
</details>

Screenshot\_1

![](images/535e88a7c815088eea4e54352b3a2442b2f32700106d3acf22686c9d68e03f4b.jpg)

<details>
<summary>text_image</summary>

Dealer
Player
</details>

Screenshot 2

![](images/0e7b050d97308d45b0d553fdfe5d79d3881a8988142c613d1e9ad7617915a849.jpg)

<details>
<summary>text_image</summary>

Dealer
Player
</details>

Screenshot\_3

# System Message

You are a helpful assistant.

\# Actions

\## You have the following actions.

\### Hit

Hit: Get a new card. Parameters: []

\### Stand

Stand: Stop to get a new card. Parameters: []

\## Continuously take action until the task is completed.

\*FUNCTION\*: The action to take, should be one of {Hit,Stand}

\*ARGS\*: The input of the action.

\*RESULT\*: Action results.

\*RETURN\*: Reply based on action results.

# User

You are a blackjack player. You are observing the current game state in the image. With the given functions, your goal is to dealer by getting as close to 21 points as possible without exceeding it. ![](Screenshot\_1)

# Assistant

I have 8 points, and the dealer has 10 points. I should hit.

\*FUNCTION\*: Hit \*ARGS\*: {}

\*RESULT\*:

![](Screenshot\_2)

\*RETURN\*: I have 15 points, and the dealer has 10 points. I should hit.

\*FUNCTION\*: Hit \*ARGS\*: {}

\*RESULT\*:

![](Screenshot\_3)

\*RETURN\*: I have 17 points, and the dealer has 10 points. I should stand.

\*FUNCTION\*: Stand \*ARGS\*: {}

\*RESULT\*: Dealer Card: Q, 5, Q. The total point of dealer is 25 > 21.

Player Card: 4, 4, 7, 2. The total point of player is 17.

Player win!

Figure 31: Qwen2-VL recognizes these cards and utilizes Hit and Stand to play the blackjack.