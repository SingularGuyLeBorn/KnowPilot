Title: The Transformer Family Version 2.0

URL Source: https://lilianweng.github.io/posts/2023-01-27-the-transformer-family-v2/

Published Time: 2023-01-27T00:00:00Z

Markdown Content:
Lil'Log
|
Posts
Archive
Search
Tags
FAQ
The Transformer Family Version 2.0
Date: January 27, 2023 | Estimated Reading Time: 45 min | Author: Lilian Weng
Table of Contents

Many new Transformer architecture improvements have been proposed since my last post on “The Transformer Family” about three years ago. Here I did a big refactoring and enrichment of that 2020 post — restructure the hierarchy of sections and improve many sections with more recent papers. Version 2.0 is a superset of the old version, about twice the length.

Notations
Symbol	Meaning

𝑑
	The model size / hidden state dimension / positional encoding size.

ℎ
	The number of heads in multi-head attention layer.

𝐿
	The segment length of input sequence.

𝑁
	The total number of attention layers in the model; not considering MoE.

𝑋
∈
𝑅
𝐿
×
𝑑
	The input sequence where each element has been mapped into an embedding vector of shape 
𝑑
, same as the model size.

𝑊
𝑘
∈
𝑅
𝑑
×
𝑑
𝑘
	The key weight matrix.

𝑊
𝑞
∈
𝑅
𝑑
×
𝑑
𝑘
	The query weight matrix.

𝑊
𝑣
∈
𝑅
𝑑
×
𝑑
𝑣
	The value weight matrix. Often we have 
𝑑
𝑘
=
𝑑
𝑣
=
𝑑
.

𝑊
𝑖
𝑘
,
𝑊
𝑖
𝑞
∈
𝑅
𝑑
×
𝑑
𝑘
/
ℎ
;
𝑊
𝑖
𝑣
∈
𝑅
𝑑
×
𝑑
𝑣
/
ℎ
	The weight matrices per head.

𝑊
𝑜
∈
𝑅
𝑑
𝑣
×
𝑑
	The output weight matrix.

𝑄
=
𝑋
𝑊
𝑞
∈
𝑅
𝐿
×
𝑑
𝑘
	The query embedding inputs.

𝐾
=
𝑋
𝑊
𝑘
∈
𝑅
𝐿
×
𝑑
𝑘
	The key embedding inputs.

𝑉
=
𝑋
𝑊
𝑣
∈
𝑅
𝐿
×
𝑑
𝑣
	The value embedding inputs.

𝑞
𝑖
,
𝑘
𝑖
∈
𝑅
𝑑
𝑘
,
𝑣
𝑖
∈
𝑅
𝑑
𝑣
	Row vectors in query, key, value matrices, 
𝑄
, 
𝐾
 and 
𝑉
.

𝑆
𝑖
	A collection of key positions for the 
𝑖
-th query 
𝑞
𝑖
 to attend to.

𝐴
∈
𝑅
𝐿
×
𝐿
	The self-attention matrix between a input sequence of lenght 
𝐿
 and itself. 
𝐴
=
softmax
(
𝑄
𝐾
⊤
/
𝑑
𝑘
)
.

𝑎
𝑖
𝑗
∈
𝐴
	The scalar attention score between query 
𝑞
𝑖
 and key 
𝑘
𝑗
.

𝑃
∈
𝑅
𝐿
×
𝑑
	position encoding matrix, where the 
𝑖
-th row 
𝑝
𝑖
 is the positional encoding for input 
𝑥
𝑖
.
Transformer Basics

The Transformer (which will be referred to as “vanilla Transformer” to distinguish it from other enhanced versions; Vaswani, et al., 2017) model has an encoder-decoder architecture, as commonly used in many NMT models. Later simplified Transformer was shown to achieve great performance in language modeling tasks, like in encoder-only BERT or decoder-only GPT.

Attention and Self-Attention

Attention is a mechanism in neural network that a model can learn to make predictions by selectively attending to a given set of data. The amount of attention is quantified by learned weights and thus the output is usually formed as a weighted average.

Self-attention is a type of attention mechanism where the model makes prediction for one part of a data sample using other parts of the observation about the same sample. Conceptually, it feels quite similar to non-local means. Also note that self-attention is permutation-invariant; in other words, it is an operation on sets.

There are various forms of attention / self-attention, Transformer (Vaswani et al., 2017) relies on the scaled dot-product attention: given a query matrix 
𝑄
, a key matrix 
𝐾
 and a value matrix 
𝑉
, the output is a weighted sum of the value vectors, where the weight assigned to each value slot is determined by the dot-product of the query with the corresponding key:

attn
(
𝑄
,
𝐾
,
𝑉
)
=
softmax
(
𝑄
𝐾
⊤
𝑑
𝑘
)
𝑉

And for a query and a key vector 
𝑞
𝑖
,
𝑘
𝑗
∈
𝑅
𝑑
 (row vectors in query and key matrices), we have a scalar score:

𝑎
𝑖
𝑗
=
softmax
(
𝑞
𝑖
𝑘
𝑗
⊤
𝑑
𝑘
)
=
exp
⁡
(
𝑞
𝑖
𝑘
𝑗
⊤
𝑑
𝑘
)
∑
𝑟
∈
𝑆
𝑖
exp
⁡
(
𝑞
𝑖
𝑘
𝑟
⊤
𝑑
𝑘
)

where 
𝑆
𝑖
 is a collection of key positions for the 
𝑖
-th query to attend to.

See my old post for other types of attention if interested.

Multi-Head Self-Attention

The multi-head self-attention module is a key component in Transformer. Rather than only computing the attention once, the multi-head mechanism splits the inputs into smaller chunks and then computes the scaled dot-product attention over each subspace in parallel. The independent attention outputs are simply concatenated and linearly transformed into expected dimensions.

	
	
MultiHeadAttn
(
𝑋
𝑞
,
𝑋
𝑘
,
𝑋
𝑣
)
	
=
[
head
1
;
…
;
head
ℎ
]
𝑊
𝑜


where head
𝑖
	
=
Attention
(
𝑋
𝑞
𝑊
𝑖
𝑞
,
𝑋
𝑘
𝑊
𝑖
𝑘
,
𝑋
𝑣
𝑊
𝑖
𝑣
)

where 
[
.
;
.
]
 is a concatenation operation. 
𝑊
𝑖
𝑞
,
𝑊
𝑖
𝑘
∈
𝑅
𝑑
×
𝑑
𝑘
/
ℎ
,
𝑊
𝑖
𝑣
∈
𝑅
𝑑
×
𝑑
𝑣
/
ℎ
 are weight matrices to map input embeddings of size 
𝐿
×
𝑑
 into query, key and value matrices. And 
𝑊
𝑜
∈
𝑅
𝑑
𝑣
×
𝑑
 is the output linear transformation. All the weights should be learned during training.

Illustration of the multi-head scaled dot-product attention mechanism. (Image source: Figure 2 in Vaswani, et al., 2017)
Encoder-Decoder Architecture

The encoder generates an attention-based representation with capability to locate a specific piece of information from a large context. It consists of a stack of 6 identity modules, each containing two submodules, a multi-head self-attention layer and a point-wise fully connected feed-forward network. By point-wise, it means that it applies the same linear transformation (with same weights) to each element in the sequence. This can also be viewed as a convolutional layer with filter size 1. Each submodule has a residual connection and layer normalization. All the submodules output data of the same dimension 
𝑑
.

The function of Transformer decoder is to retrieve information from the encoded representation. The architecture is quite similar to the encoder, except that the decoder contains two multi-head attention submodules instead of one in each identical repeating module. The first multi-head attention submodule is masked to prevent positions from attending to the future.

The architecture of the vanilla Transformer model. (Image source: Figure 17)
Positional Encoding

Because self-attention operation is permutation invariant, it is important to use proper positional encoding to provide order information to the model. The positional encoding 
𝑃
∈
𝑅
𝐿
×
𝑑
 has the same dimension as the input embedding, so it can be added on the input directly. The vanilla Transformer considered two types of encodings:

Sinusoidal Positional Encoding

Sinusoidal positional encoding is defined as follows, given the token position 
𝑖
=
1
,
…
,
𝐿
 and the dimension 
𝛿
=
1
,
…
,
𝑑
:

	

	
PE
(
𝑖
,
𝛿
)
=
{
sin
⁡
(
𝑖
10000
2
𝛿
′
/
𝑑
)
	
if 
𝛿
=
2
𝛿
′


cos
⁡
(
𝑖
10000
2
𝛿
′
/
𝑑
)
	
if 
𝛿
=
2
𝛿
′
+
1

In this way each dimension of the positional encoding corresponds to a sinusoid of different wavelengths in different dimensions, from 
2
𝜋
 to 
10000
⋅
2
𝜋
.

Sinusoidal positional encoding with 
𝐿
=
32
 and 
𝑑
=
128
. The value is between -1 (black) and 1 (white) and the value 0 is in gray.
Learned Positional Encoding

Learned positional encoding assigns each element with a learned column vector which encodes its absolute position (Gehring, et al. 2017) and furthermroe this encoding can be learned differently per layer (Al-Rfou et al. 2018).



Relative Position Encoding

Shaw et al. (2018)) incorporated relative positional information into 
𝑊
𝑘
 and 
𝑊
𝑣
. Maximum relative position is clipped to a maximum absolute value of 
𝑘
 and this clipping operation enables the model to generalize to unseen sequence lengths. Therefore, 
2
𝑘
+
1
 unique edge labels are considered and let us denote 
𝑃
𝑘
,
𝑃
𝑣
∈
𝑅
2
𝑘
+
1
 as learnable relative position representations.

𝐴
𝑖
𝑗
𝑘
=
𝑃
clip
(
𝑗
−
𝑖
,
𝑘
)
𝑘
𝐴
𝑖
𝑗
𝑣
=
𝑃
clip
(
𝑗
−
𝑖
,
𝑘
)
𝑣
where 
clip
(
𝑥
,
𝑘
)
=
clip
(
𝑥
,
−
𝑘
,
𝑘
)



Transformer-XL (Dai et al., 2019) proposed a type of relative positional encoding based on reparametrization of dot-product of keys and queries. To keep the positional information flow coherently across segments, Transformer-XL encodes the relative position instead, as it could be sufficient enough to know the position offset for making good predictions, i.e. 
𝑖
−
𝑗
, between one key vector 
𝑘
𝜏
,
𝑗
 and its query 
𝑞
𝜏
,
𝑖
.

If omitting the scalar 
1
/
𝑑
𝑘
 and the normalizing term in softmax but including positional encodings, we can write the attention score between query at position 
𝑖
 and key at position 
𝑗
 as:

	
	
𝑎
𝑖
𝑗
	
=
𝑞
𝑖
𝑘
𝑗
⊤
=
(
𝑥
𝑖
+
𝑝
𝑖
)
𝑊
𝑞
(
(
𝑥
𝑗
+
𝑝
𝑗
)
𝑊
𝑘
)
⊤

	
=
𝑥
𝑖
𝑊
𝑞
𝑊
𝑘
⊤
𝑥
𝑗
⊤
+
𝑥
𝑖
𝑊
𝑞
𝑊
𝑘
⊤
𝑝
𝑗
⊤
+
𝑝
𝑖
𝑊
𝑞
𝑊
𝑘
⊤
𝑥
𝑗
⊤
+
𝑝
𝑖
𝑊
𝑞
𝑊
𝑘
⊤
𝑝
𝑗
⊤

Transformer-XL reparameterizes the above four terms as follows:


				


				


				


				

𝑎
𝑖
𝑗
rel
=
𝑥
𝑖
𝑊
𝑞
𝑊
𝐸
𝑘
⊤
𝑥
𝑗
⊤
⏟
content-based addressing
+
𝑥
𝑖
𝑊
𝑞
𝑊
𝑅
𝑘
⊤
𝑟
𝑖
−
𝑗
⊤
⏟
content-dependent positional bias
+
𝑢
𝑊
𝐸
𝑘
⊤
𝑥
𝑗
⊤
⏟
global content bias
+
𝑣
𝑊
𝑅
𝑘
⊤
𝑟
𝑖
−
𝑗
⊤
⏟
global positional bias
Replace 
𝑝
𝑗
 with relative positional encoding 
𝑟
𝑖
−
𝑗
∈
𝑅
𝑑
;
Replace 
𝑝
𝑖
𝑊
𝑞
 with two trainable parameters 
𝑢
 (for content) and 
𝑣
 (for location) in two different terms;
Split 
𝑊
𝑘
 into two matrices, 
𝑊
𝐸
𝑘
 for content information and 
𝑊
𝑅
𝑘
 for location information.
Rotary Position Embedding

Rotary position embedding (RoPE; Su et al. 2021) encodes the absolution position with a rotation matrix and multiplies key and value matrices of every attention layer with it to inject relative positional information at every layer.


When encoding relative positional information into the inner product of the 
𝑖
-th key and the 
𝑗
-th query, we would like to formulate the function in a way that the inner product is only about the relative position 
𝑖
−
𝑗
. Rotary Position Embedding (RoPE) makes use of the rotation operation in Euclidean space and frames the relative position embedding as simply rotating feature matrix by an angle proportional to its position index.


Given a vector 
𝑧
, if we want to rotate it counterclockwise by 
𝜃
, we can multiply it by a rotation matrix to get 
𝑅
𝑧
 where the rotation matrix 
𝑅
 is defined as:

	
	
𝑅
=
[
cos
⁡
𝜃
	
−
sin
⁡
𝜃


sin
⁡
𝜃
	
cos
⁡
𝜃
]

When generalizing to higher dimensional space, RoPE divide the 
𝑑
-dimensional space into 
𝑑
/
2
 subspaces and constructs a rotation matrix 
𝑅
 of size 
𝑑
×
𝑑
 for token at position 
𝑖
:

						
						
						
						
						
						
						
𝑅
Θ
,
𝑖
𝑑
=
[
cos
⁡
𝑖
𝜃
1
	
−
sin
⁡
𝑖
𝜃
1
	
0
	
0
	
…
	
0
	
0


sin
⁡
𝑖
𝜃
1
	
cos
⁡
𝑖
𝜃
1
	
0
	
0
	
…
	
0
	
0


0
	
0
	
cos
⁡
𝑖
𝜃
2
	
−
sin
⁡
𝑖
𝜃
2
	
…
	
0
	
0


0
	
0
	
sin
⁡
𝑖
𝜃
2
	
cos
⁡
𝑖
𝜃
2
	
…
	
0
	
0


⋮
	
⋮
	
⋮
	
⋮
	
⋱
	
⋮
	
⋮


0
	
0
	
0
	
0
	
…
	
cos
⁡
𝑖
𝜃
𝑑
/
2
	
−
sin
⁡
𝑖
𝜃
𝑑
/
2


0
	
0
	
0
	
0
	
…
	
sin
⁡
𝑖
𝜃
𝑑
/
2
	
cos
⁡
𝑖
𝜃
𝑑
/
2
]

where in the paper we have 
Θ
=
𝜃
𝑖
=
10000
−
2
(
𝑖
−
1
)
/
𝑑
,
𝑖
∈
[
1
,
2
,
…
,
𝑑
/
2
]
. Note that this is essentially equivalent to sinusoidal positional encoding but formulated as a rotation matrix.

Then both key and query matrices incorporates the positional information by multiplying with this rotation matrix:

	

	
	
𝑞
𝑖
⊤
𝑘
𝑗
=
(
𝑅
Θ
,
𝑖
𝑑
𝑊
𝑞
𝑥
𝑖
)
⊤
(
𝑅
Θ
,
𝑗
𝑑
𝑊
𝑘
𝑥
𝑗
)
=
𝑥
𝑖
⊤
𝑊
𝑞
𝑅
Θ
,
𝑗
−
𝑖
𝑑
𝑊
𝑘
𝑥
𝑗

	
 where 
𝑅
Θ
,
𝑗
−
𝑖
𝑑
=
(
𝑅
Θ
,
𝑖
𝑑
)
⊤
𝑅
Θ
,
𝑗
𝑑
Visual illustration of how rotary position embedding is implemented.(Image source: Su et al., 2021) Note: I used 
𝑖
 instead of 
𝑚
 to represent the position index compared to the original figure in the paper.
Longer Context

The length of an input sequence for transformer models at inference time is upper-bounded by the context length used for training. Naively increasing context length leads to high consumption in both time (
𝑂
(
𝐿
2
𝑑
)
) and memory (
𝑂
(
𝐿
2
)
) and may not be supported due to hardware constraints.

This section introduces several improvements in transformer architecture to better support long context at inference; E.g. using additional memory, design for better context extrapolation, or recurrency mechanism.

Context Memory

The vanilla Transformer has a fixed and limited attention span. The model can only attend to other elements in the same segments during each update step and no information can flow across separated fixed-length segments. This context segmentation causes several issues:

The model cannot capture very long term dependencies.
It is hard to predict the first few tokens in each segment given no or thin context.
The evaluation is expensive. Whenever the segment is shifted to the right by one, the new segment is re-processed from scratch, although there are a lot of overlapped tokens.

Transformer-XL (Dai et al., 2019; “XL” means “extra long”) modifies the architecture to reuse hidden states between segments with an additional memory. The recurrent connection between segments is introduced into the model by continuously using the hidden states from the previous segments.

A comparison between the training phrase of vanilla Transformer & Transformer-XL with a segment length 4. (Image source: left part of Figure 2 in Dai et al., 2019).

Let’s label the hidden state of the 
𝑛
-th layer for the 
(
𝜏
+
1
)
-th segment in the model as 
ℎ
𝜏
+
1
(
𝑛
)
∈
𝑅
𝐿
×
𝑑
. In addition to the hidden state of the last layer for the same segment 
ℎ
𝜏
+
1
(
𝑛
−
1
)
, it also depends on the hidden state of the same layer for the previous segment 
ℎ
𝜏
(
𝑛
)
. By incorporating information from the previous hidden states, the model extends the attention span much longer in the past, over multiple segments.

	


	


	


	


	
ℎ
~
𝜏
+
1
(
𝑛
−
1
)
	
=
[
stop-gradient
(
ℎ
𝜏
(
𝑛
−
1
)
)
∘
ℎ
𝜏
+
1
(
𝑛
−
1
)
]


𝑄
𝜏
+
1
(
𝑛
)
	
=
ℎ
𝜏
+
1
(
𝑛
−
1
)
𝑊
𝑞


𝐾
𝜏
+
1
(
𝑛
)
	
=
ℎ
~
𝜏
+
1
(
𝑛
−
1
)
𝑊
𝑘


𝑉
𝜏
+
1
(
𝑛
)
	
=
ℎ
~
𝜏
+
1
(
𝑛
−
1
)
𝑊
𝑣


ℎ
𝜏
+
1
(
𝑛
)
	
=
transformer-layer
(
𝑄
𝜏
+
1
(
𝑛
)
,
𝐾
𝜏
+
1
(
𝑛
)
,
𝑉
𝜏
+
1
(
𝑛
)
)

Note that both keys and values rely on extended hidden states, while queries only consume hidden states at the current step. The concatenation operation 
[
.
∘
.
]
 is along the sequence length dimension. And Transformer-XL needs to use relative positional encoding because previous and current segments would be assigned with the same encoding if we encode absolute positions, which is undesired.

Compressive Transformer (Rae et al. 2019) extends Transformer-XL by compressing past memories to support longer sequences. It explicitly adds memory slots of size 
𝑚
𝑚
 per layer for storing past activations of this layer to preserve long context. When some past activations become old enough, they are compressed and saved in an additional compressed memory of size 
𝑚
𝑐
𝑚
 per layer.

Compressive transformer maintains two types of memory slots, memory and compressed memory, to support long context. (Image source: Rae et al. 2019).

Both memory and compressed memory are FIFO queues. Given the model context length 
𝐿
, the compression function of compression rate 
𝑐
 is defined as 
𝑓
𝑐
:
𝑅
𝐿
×
𝑑
→
𝑅
[
𝐿
𝑐
]
×
𝑑
, mapping 
𝐿
 oldest activations to 
[
𝐿
𝑐
]
 compressed memory elements. There are several choices of compression functions:

Max/mean pooling of kernel and stride size 
𝑐
;
1D convolution with kernel and stride size 
𝑐
 (need to learn additional parameters);
Dilated convolution (need to learn additional parameters). In their experiments, convolution compression works out the best on EnWik8 dataset;
Most used memories.

Compressive transformer has two additional training losses:

Auto-encoding loss (lossless compression objective) measures how well we can reconstruct the original memories from compressed memories

𝐿
𝑎
𝑐
=
‖
old_mem
(
𝑖
)
−
𝑔
(
new_cm
(
𝑖
)
)
‖
2
where 
𝑔
:
𝑅
[
𝐿
𝑐
]
×
𝑑
→
𝑅
𝐿
×
𝑑
 reverses the compression function 
𝑓
.

Attention-reconstruction loss (lossy objective) reconstructs content-based attention over memory vs compressed memory and minimize the difference:

𝐿
𝑎
𝑟
=
‖
attn
(
ℎ
(
𝑖
)
,
old_mem
(
𝑖
)
)
−
attn
(
ℎ
(
𝑖
)
,
new_cm
(
𝑖
)
)
‖
2

Transformer-XL with a memory of size 
𝑚
 has a maximum temporal range of 
𝑚
×
𝑁
, where 
𝑁
 is the number of layers in the model, and attention cost 
𝑂
(
𝐿
2
+
𝐿
𝑚
)
. In comparison, compressed transformer has a temporal range of 
(
𝑚
𝑚
+
𝑐
⋅
𝑚
𝑐
𝑚
)
×
𝑁
 and attention cost 
𝑂
(
𝐿
2
+
𝐿
(
𝑚
𝑚
+
𝑚
𝑐
𝑚
)
)
. A larger compression rate 
𝑐
 gives better tradeoff between temporal range length and attention cost.

Attention weights, from oldest to newest, are stored in three locations: compressed memory → memory → causally masked sequence. In the experiments, they observed an increase in attention weights from oldest activations stored in the regular memory, to activations stored in the compressed memory, implying that the network is learning to preserve salient information.

Attention weights with one standard deviation as error bars versus memory positions, from oldest (left) to newest (right). (Image source: Rae et al. 2019).
Non-Differentiable External Memory

𝑘
NN-LM (Khandelwal et al. 2020) enhances a pretrained LM with a separate 
𝑘
NN model by linearly interpolating the next token probabilities predicted by both models. The 
𝑘
NN model is built upon an external key-value store which can store any large pre-training dataset or OOD new dataset. This datastore is preprocessed to save a large number of pairs, (LM embedding representation of context, next token) and the nearest neighbor retrieval happens in the LM embedding space. Because the datastore can be gigantic, we need to rely on libraries for fast dense vector search such as FAISS or ScaNN. The indexing process only happens once and parallelism is easy to implement at inference time.

At inference time, the next token probability is a weighted sum of two predictions:

	
	
𝟙
𝑝
(
𝑦
|
𝑥
)
	
=
𝜆
𝑝
kNN
(
𝑦
|
𝑥
)
+
(
1
−
𝜆
)
𝑝
LM
(
𝑦
|
𝑥
)


𝑝
kNN
(
𝑦
|
𝑥
)
	
∝
∑
(
𝑘
𝑖
,
𝑤
𝑖
)
∈
𝑁
1
[
𝑦
=
𝑤
𝑖
]
exp
⁡
(
−
𝑑
(
𝑘
𝑖
,
𝑓
(
𝑥
)
)
)

where 
𝑁
 contains a set of nearest neighbor data points retrieved by 
𝑘
NN; 
𝑑
(
.
,
.
)
 is a distance function such as L2 distance.

According to the experiments, larger datastore size or larger 
𝑘
 is correlated with better perplexity. The weighting scalar 
𝜆
 should be tuned, but in general it is expected to be larger for out-of-domain data compared to in-domain data and larger datastore can afford a larger 
𝜆
.

SPALM (Adaptive semiparametric language models; Yogatama et al. 2021) incorporates both (1) Transformer-XL style memory for hidden states from external context as short-term memory and (2) 
𝑘
NN-LM style key-value store as long memory.

Illustration of how SPALM combines context memory of past hidden states (short term memory) with an external key-value datastore (long term memory) to support longer context. (Image source: Yogatama et al. 2021).

SPALM runs 
𝑘
NN search to fetch 
𝑘
 tokens with most relevant context. For each token we can get the same embedding representation provided by a pretrained LM, denoted as 
{
𝑦
𝑖
}
𝑖
=
1
𝑘
. The gating mechanism first aggregates the retrieved token embeddings with a simple attention layer using 
ℎ
𝑡
𝑅
 (the hidden state for token 
𝑥
𝑡
 at layer 
𝑅
) as a query and then learns a gating parameter 
𝑔
𝑡
 to balance between local information 
ℎ
𝑡
𝑅
 and long-term information 
𝑚
𝑡
.

	



	

	

	
𝑚
𝑡
	
=
∑
𝑖
=
1
𝑘
exp
⁡
(
𝑦
𝑖
⊤
ℎ
𝑡
𝑅
)
∑
𝑗
=
1
𝑘
exp
⁡
(
𝑦
𝑗
⊤
ℎ
𝑡
𝑅
)
⋅
𝑦
𝑖


𝑔
𝑡
	
=
𝜎
(
𝑤
𝑔
⊤
ℎ
𝑡
𝑅
)


𝑧
𝑡
	
=
(
1
−
𝑔
𝑡
)
⊙
𝑚
𝑡
+
𝑔
𝑡
⊙
ℎ
𝑡
𝑅


𝑝
(
𝑥
𝑡
+
1
∣
𝑥
≤
𝑡
)
	
=
softmax
(
𝑧
𝑡
;
𝑊
)

where 
𝑤
𝑔
 is a parameter vector to learn; 
𝜎
(
.
)
 is sigmoid; 
𝑊
 is the word embedding matrix shared between both input and output tokens. Different from 
𝑘
NN-LM, they didn’t find the nearest neighbor distance to be helpful in the aggregation of retrieved tokens.

During training, the key representations in the long-term memory stay constant, produced by a pretrained LM, but the value encoder, aka the word embedding matrix, gets updated.

Memorizing Transformer (Wu et al. 2022) adds a 
𝑘
NN-augmented attention layer near the top stack of a decoder-only Transformer. This special layer maintains a Transformer-XL style FIFO cache of past key-value pairs.

The same QKV values are used for both local attention and 
𝑘
NN mechanisms. The 
𝑘
NN lookup returns top-
𝑘
 (key, value) pairs for each query in the input sequence and then they are processed through the self-attention stack to compute a weighted average of retrieved values. Two types of attention are combined with a learnable per-head gating parameter. To prevent large distributional shifts in value magnitude, both keys and values in the cache are normalized.

What they found during experiments with Memorizing Transformer:

It is observed in some experiments that training models with a small memory and then finetuned with a larger memory works better than training with a large memory from scratch.
The smaller Memorizing Transformer with just 8k tokens in memory can match the perplexity of a larger vanilla Transformer with 5X more trainable parameters.
Increasing the size of external memory provided consistent gains up to a size of 262K.
A non-memory transformer can be finetuned to use memory.
Fine-tuning a vanilla Transformer with a key-value memory can achieve similar performance as training a memorizing transformer from scratch. (Image source: Wu et al. 2022).
Distance-Enhanced Attention Scores

Distance Aware Transformer(DA-Transformer; Wu, et al. 2021) and Attention with Linear Biases (ALiBi; Press et al. 2022) are motivated by similar ideas — in order to encourage the model to extrapolate over longer context than what the model is trained on, we can explicitly attach the positional information to every pair of attention score based on the distance between key and query tokens.

Note that the default positional encoding in vanilla Transformer only adds positional information to the input sequence, while later improved encoding mechanisms alter attention scores of every layer, such as rotary position embedding, and they take on form very similar to distance enhanced attention scores.

DA-Transformer (Wu, et al. 2021) multiplies attention scores at each layer by a learnable bias that is formulated as a function of the distance between key and query. Different attention heads use different parameters to distinguish diverse preferences to short-term vs long-term context. Given two positions, 
𝑖
,
𝑗
, DA-Transformer uses the following weighting function to alter the self-attention score:

	
	

	
𝑅
(
𝑖
)
	
=
𝛼
𝑖
𝑅
where 
𝑅
𝑖
𝑗
=
|
𝑖
−
𝑗
|


𝑓
(
𝑅
(
𝑖
)
;
𝛽
𝑖
)
	
=
1
+
exp
⁡
(
𝛽
𝑖
)
1
+
exp
⁡
(
𝛽
𝑖
−
𝑅
(
𝑖
)
)


attn
(
𝑄
(
𝑖
)
,
𝐾
(
𝑖
)
,
𝑉
(
𝑖
)
)
	
=
row-softmax
(
ReLU
(
𝑄
(
𝑖
)
𝐾
(
𝑖
)
⊤
)
𝑓
(
𝑅
(
𝑖
)
)
𝑑
)
𝑉
(
𝑖
)

where 
𝛼
𝑖
 is a learnable parameters to weight relative distance differently per head where the head is indexed by superscript 
(
𝑖
)
; 
𝛽
𝑖
 is a learnable parameter to control the upper bound and ascending slope wrt the distance for the 
𝑖
-th attention head. The weighting function 
𝑓
(
.
)
 is designed in a way that: (1) 
𝑓
(
0
)
=
1
; (2) 
𝑓
(
𝑅
(
𝑖
)
)
=
0
 when 
𝑅
(
𝑖
)
→
−
∞
; (3) 
𝑓
(
𝑅
(
𝑖
)
)
 is bounded when 
𝑅
(
𝑖
)
→
+
∞
; (4) the scale is tunable; (5) and the function is monotonic. The extra time complexity brought by 
𝑓
(
𝑅
(
𝑖
)
)
 is 
𝑂
(
𝐿
2
)
 and it is small relative to the self attention time complexity 
𝑂
(
𝐿
2
𝑑
)
. The extra memory consumption is minimal, ~
𝑂
(
2
ℎ
)
.

Instead of multipliers, ALiBi (Press et al. 2022) adds a constant bias term on query-key attention scores, proportional to pairwise distances. The bias introduces a strong recency preference and penalizes keys that are too far away. The penalties are increased at different rates within different heads.
softmax
(
𝑞
𝑖
𝐾
⊤
+
𝛼
𝑖
⋅
[
0
,
−
1
,
−
2
,
…
,
−
(
𝑖
−
1
)
]
)
where 
𝛼
𝑖
 is a head-specific weighting scalar. Different from DA-transformer, 
𝛼
𝑖
 is not learned but fixed as a geometric sequence; for example, for 8 heads, 
𝛼
𝑖
=
1
2
,
1
2
2
,
…
,
1
2
8
. The overall idea is very much similar to what relative positional encoding aims to solve.

Illustration of how ALiBi enhances attention scores with a positional bias term. (Image source: Press et al. 2021).

With ALiBi, Press et al. (2022) trained a 1.3B model on context length 1024 during training and extrapolated to 2046 at inference time.

Extrapolation experiments for running inference with Transformers of different configs, including sinusoidal positional encoding, rotary positional encoding, simplified relative positional encoding in T5 and ALiBi. All models were trained with small context length but inference ran for much longer context. (Image source: Press et al. 2021).
Make it Recurrent

Universal Transformer (Dehghani, et al. 2019) combines self-attention in Transformer with the recurrent mechanism in RNN, aiming to benefit from both a long-term global receptive field of Transformer and learned inductive biases of RNN. Rather than going through a fixed number of layers, Universal Transformer dynamically adjusts the number of steps using adaptive computation time. If we fix the number of steps, an Universal Transformer is equivalent to a multi-layer Transformer with shared parameters across layers.

On a high level, the universal transformer can be viewed as a recurrent function for learning the hidden state representation per token. The recurrent function evolves in parallel across token positions and the information between positions is shared through self-attention.

How the Universal Transformer refines a set of hidden state representations repeatedly for every position in parallel. (Image source: Figure 1 in Dehghani, et al. 2019).

Given an input sequence of length 
𝐿
, Universal Transformer iteratively updates the representation 
ℎ
𝑡
∈
𝑅
𝐿
×
𝑑
 at step 
𝑡
 for an adjustable number of steps. At step 0, 
ℎ
0
 is initialized to be same as the input embedding matrix. All the positions are processed in parallel in the multi-head self-attention mechanism and then go through a recurrent transition function.

	
	
𝐴
𝑡
	
=
LayerNorm
(
ℎ
𝑡
−
1
+
MultiHeadAttention
(
ℎ
𝑡
−
1
+
𝑃
𝑡
)


ℎ
𝑡
	
=
LayerNorm
(
𝐴
𝑡
−
1
+
Transition
(
𝐴
𝑡
)
)

where 
Transition
(
.
)
 is either a separable convolution or a fully-connected neural network that consists of two position-wise (i.e. applied to each row of 
𝐴
𝑡
 individually) affine transformation + one ReLU.

The positional encoding 
𝑃
𝑡
 uses sinusoidal position signal but with an additional time dimension:

	

	
PE
(
𝑖
,
𝑡
,
𝛿
)
=
{
sin
⁡
(
𝑖
10000
2
𝛿
′
/
𝑑
)
⊕
sin
⁡
(
𝑡
10000
2
𝛿
′
/
𝑑
)
	
if 
𝛿
=
2
𝛿
′


cos
⁡
(
𝑖
10000
2
𝛿
′
/
𝑑
)
⊕
cos
⁡
(
𝑡
10000
2
𝛿
′
/
𝑑
)
	
if 
𝛿
=
2
𝛿
′
+
1
A simplified illustration of Universal Transformer. The encoder and decoder share the same basic recurrent structure. But the decoder also attends to final encoder representation 
ℎ
𝑇
. (Image source: Figure 2 in Dehghani, et al. 2019)

In the adaptive version of Universal Transformer, the number of recurrent steps 
𝑇
 is dynamically determined by ACT. Each position is equipped with a dynamic ACT halting mechanism. Once a per-token recurrent block halts, it stops taking more recurrent updates but simply copies the current value to the next step until all the blocks halt or until the model reaches a maximum step limit.

Adaptive Modeling

Adaptive modeling refers to a mechanism that can adjust the amount of computation according to different inputs. For example, some tokens may only need local information and thus demand a shorter attention span; Or some tokens are relatively easier to predict and do not need to be processed through the entire attention stack.

Adaptive Attention Span

One key advantage of Transformer is the capability of capturing long-term dependencies. Depending on the context, the model may prefer to attend further sometime than others; or one attention head may had different attention pattern from the other. If the attention span could adapt its length flexibly and only attend further back when needed, it would help reduce both computation and memory cost to support longer maximum context size in the model.

This is the motivation for Adaptive Attention Span. Sukhbaatar et al (2019) proposed a self-attention mechanism that seeks an optimal attention span. They hypothesized that different attention heads might assign scores differently within the same context window (See Fig. 14) and thus the optimal span would be trained separately per head.

Two attention heads in the same model, A & B, assign attention differently within the same context window. Head A attends more to the recent tokens, while head B look further back into the past uniformly. (Image source: Sukhbaatar, et al. 2019)

Given the 
𝑖
-th token, we need to compute the attention weights between this token and other keys within its attention span of size 
𝑠
:

	
	

	




𝑒
𝑖
𝑗
	
=
𝑞
𝑖
𝑘
𝑗
⊤


𝑎
𝑖
𝑗
	
=
softmax
(
𝑒
𝑖
𝑗
)
=
exp
⁡
(
𝑒
𝑖
𝑗
)
∑
𝑟
=
𝑖
−
𝑠
𝑖
−
1
exp
⁡
(
𝑒
𝑖
𝑟
)


𝑦
𝑖
	
=
∑
𝑟
=
𝑖
−
𝑠
𝑖
−
1
𝑎
𝑖
𝑟
𝑣
𝑟
=
∑
𝑟
=
𝑖
−
𝑠
𝑖
−
1
𝑎
𝑖
𝑟
𝑥
𝑟
𝑊
𝑣

A soft mask function 
𝑚
𝑧
 is added to control for an effective adjustable attention span, which maps the distance between query and key into a [0, 1] value. 
𝑚
𝑧
 is parameterized by 
𝑧
∈
[
0
,
𝑠
]
 and 
𝑧
 is to be learned:

𝑚
𝑧
(
𝑥
)
=
clip
(
1
𝑅
(
𝑅
+
𝑧
−
𝑥
)
,
0
,
1
)

where 
𝑅
 is a hyper-parameter which defines the softness of 
𝑚
𝑧
.

The soft masking function used in the adaptive attention span. (Image source: Sukhbaatar, et al. 2019.)

The soft mask function is applied to the softmax elements in the attention weights:

𝑎
𝑖
𝑗
=
𝑚
𝑧
(
𝑖
−
𝑗
)
exp
⁡
(
𝑠
𝑖
𝑗
)
∑
𝑟
=
𝑖
−
𝑠
𝑖
−
1
𝑚
𝑧
(
𝑖
−
𝑟
)
exp
⁡
(
𝑠
𝑖
𝑟
)

In the above equation, 
𝑧
 is differentiable so it is trained jointly with other parts of the model. Parameters 
𝑧
(
𝑖
)
,
𝑖
=
1
,
…
,
ℎ
 are learned separately per head. Moreover, the loss function has an extra L1 penalty on 
∑
𝑖
=
1
ℎ
𝑧
(
𝑖
)
.

Using Adaptive Computation Time, the approach can be further enhanced to have flexible attention span length, adaptive to the current input dynamically. The span parameter 
𝑧
𝑡
 of an attention head at time 
𝑡
 is a sigmoidal function, 
𝑧
𝑡
=
𝑆
𝜎
(
𝑣
⋅
𝑥
𝑡
+
𝑏
)
, where the vector 
𝑣
 and the bias scalar 
𝑏
 are learned jointly with other parameters.

In the experiments of Transformer with adaptive attention span, Sukhbaatar, et al. (2019) found a general tendency that lower layers do not require very long attention spans, while a few attention heads in higher layers may use exceptionally long spans. Adaptive attention span also helps greatly reduce the number of FLOPS, especially in a big model with many attention layers and a large context length.

Depth-Adaptive Transformer

At inference time, it is natural to assume that some tokens are easier to predict and thus do not require as much computation as others. Therefore we may only process its prediction through a limited number of layers to achieve a good balance between speed and performance.

Both Depth-Adaptive Transformer (Elabyad et al. 2020) and Confident Adaptive Language Model (CALM; Schuster et al. 2022) are motivated by this idea and learn to predict optimal numbers of layers needed for different input tokens.

Depth-adaptive transformer (Elabyad et al. 2020) attaches an output classifier to every layer to produce exit predictions based on activations of that layer. The classifier weight matrices can be different per layer or shared across layers. During training, the model sample different sequences of exits such that the model is optimized with hidden states of different layers. The learning objective incorporates likelihood probabilities predicted at different layers, 
𝑛
=
1
,
…
,
𝑁
:



LL
𝑡
𝑛
=
log
⁡
𝑝
(
𝑦
𝑡
|
ℎ
𝑡
−
1
𝑛
)
LL
𝑛
=
∑
𝑡
=
1
|
𝑦
|
𝐿
𝐿
𝑡
𝑛

Adaptive depth classifiers outputs a parametric distribution 
𝑞
𝑡
. It is trained with cross entropy loss against an oracle distribution 
𝑞
𝑡
∗
. The paper explored three confiurations for how to learn such a classifier 
𝑞
𝑡
.

Illustration of three types of adaptive depth classifiers.
(Image source: Elabyad et al. 2020).

Sequence-specific depth classifier: All tokens of the same sequence share the same exit block. It depends on the average of the encoder representation of the sequence. Given an input sequence 
𝑥
 of length 
𝐿
, the classifier takes 
𝑥
¯
=
1
𝐿
∑
𝑡
=
1
𝐿
𝑥
𝑡
 as input and outputs a multinomial distribution of 
𝑁
 dimensions, corresponding to 
𝑁
 layers.

	


	


	


𝑞
(
𝑛
|
𝑥
)
	
=
softmax
(
𝑊
𝑛
𝑥
¯
+
𝑏
𝑛
)
∈
𝑅
𝑁


𝑞
lik
∗
(
𝑥
,
𝑦
)
	
=
𝛿
(
arg
⁡
max
𝑛
LL
𝑛
−
𝜆
𝑛
)


or 
𝑞
corr
∗
(
𝑥
,
𝑦
)
	
=
𝛿
(
arg
⁡
max
𝑛
𝐶
𝑛
−
𝜆
𝑛
)
 where 
𝐶
𝑛
=
|
{
𝑡
|
𝑦
𝑡
=
arg
⁡
max
𝑦
𝑝
(
𝑦
|
ℎ
𝑡
−
1
𝑛
)
}
|

where 
𝛿
 is dirac delta (unit impulse) function and 
−
𝜆
𝑛
 is a regularization term to encourage lower layer exits. The ground truth 
𝑞
∗
 can be prepared in two way, based on maximum likelihood 
𝑞
lik
∗
 or correctness 
𝑞
corr
∗
.



Token-specific depth classifier (multinomial): Each token is decoded with different exit block, predicted conditioned on the first decoder hidden state 
ℎ
𝑡
1
:

𝑞
𝑡
(
𝑛
|
𝑥
,
𝑦
<
𝑡
)
=
softmax
(
𝑊
𝑛
ℎ
𝑡
1
+
𝑏
𝑛
)



Token-specific depth classifier (geometric-like): A binary exit prediction distribution is made per layer per token, 
𝑋
𝑡
𝑛
. The RBF kernel 
𝜅
(
𝑡
,
𝑡
′
)
=
exp
⁡
(
|
𝑡
−
𝑡
′
|
2
𝜎
)
 is used to smooth the predictions to incorporate the impact of current decision on future time steps.

	

	
	

	

	





	

𝟙



𝑋
𝑡
𝑛
	
=
sigmoid
(
𝑤
𝑛
⊤
ℎ
𝑡
𝑛
+
𝑏
𝑛
)
∀
𝑛
∈
[
1
,
…
,
𝑁
−
1
]


𝑞
𝑡
(
𝑛
|
𝑥
,
𝑦
<
𝑡
)
	
=
{
𝑋
𝑡
𝑛
∏
𝑛
′
<
𝑛
(
1
−
𝑋
𝑡
𝑛
′
)
	
if 
𝑛
<
𝑁


∏
𝑛
′
<
𝑁
(
1
−
𝑋
𝑡
𝑛
′
)
	
otherwise


𝑞
lik
∗
(
𝑥
,
𝑦
)
	
=
𝛿
(
arg
⁡
max
𝑛
LL
~
𝑡
𝑛
−
𝜆
𝑛
)
 where 
LL
~
𝑡
𝑛
=
∑
𝑡
′
=
1
|
𝑦
|
𝜅
(
𝑡
,
𝑡
′
)
𝐿
𝐿
𝑡
′
𝑛


or 
𝑞
cor
∗
(
𝑥
,
𝑦
)
	
=
𝛿
(
arg
⁡
max
𝑛
𝐶
~
𝑡
𝑛
−
𝜆
𝑛
)
 where 
𝐶
𝑡
𝑛
=
1
[
𝑦
𝑡
=
arg
⁡
max
𝑦
𝑝
(
𝑦
|
ℎ
𝑡
−
1
𝑛
)
]
,
𝐶
~
𝑡
𝑛
=
∑
𝑡
′
=
1
|
𝑦
|
𝜅
(
𝑡
,
𝑡
′
)
𝐶
𝑡
′
𝑛

At inference time, the confidence threshold for making an exit decision needs to be calibrated. Depth-adaptive transformer finds such a threshold on a validation set via grid search. CALM (Schuster et al. 2022) applied the Learn then Test (LTT) framework (Angelopoulos et al. 2021) to identify a subset of valid thresholds and chose the minimum value as the threshold for inference. Except for training per-layer exit classifier, CALM also explored other methods for adaptive depth prediction, including the softmax responses (i.e. difference between top two softmax outputs) and hidden state saturation (i.e. 
cos
⁡
(
ℎ
𝑡
𝑛
,
ℎ
𝑡
𝑛
+
1
)
) as confidence scores for exit decisions. They found softmax responses result in best inference speedup.

Efficient Attention

The computation and memory cost of the vanilla Transformer grows quadratically with sequence length and hence it is hard to be applied on very long sequences. Many efficiency improvements for Transformer architecture have something to do with the self-attention module - making it cheaper, smaller or faster to run. See the survey paper on Efficient Transformers (Tay et al. 2020).

Sparse Attention Patterns
Fixed Local Context

A simple alternation to make self-attention less expensive is to restrict the attention span of each token to local context only, so that self-attention grows linearly with the sequence length.

The idea was introduced by Image Transformer (Parmer, et al 2018), which formulates image generation as sequence modeling using an encoder-decoder transformer architecture:

The encoder generates a contextualized, per-pixel-channel representation of the source image;
Then the decoder autoregressively generates an output image, one channel per pixel at each time step.

Let’s label the representation of the current pixel to be generated as the query 
𝑞
. Other positions whose representations will be used for computing 
𝑞
 are key vector 
𝑘
1
,
𝑘
2
,
…
 and they together form a memory matrix 
𝑀
. The scope of 
𝑀
 defines the context window for pixel query 
𝑞
.

Image Transformer introduced two types of localized 
𝑀
, as illustrated below.

Illustration of 1D and 2D attention span for visual inputs in Image Transformer. The black line marks a query block and the cyan outlines the actual attention span for pixel q. (Image source: Figure 2 in Parmer et al, 2018)

1D Local Attention: The input image is flattened in the raster scanning order, that is, from left to right and top to bottom. The linearized image is then partitioned into non-overlapping query blocks. The context window consists of pixels in the same query block as 
𝑞
 and a fixed number of additional pixels generated before this query block.



2D Local Attention: The image is partitioned into multiple non-overlapping rectangular query blocks. The query pixel can attend to all others in the same memory blocks. To make sure the pixel at the top-left corner can also have a valid context window, the memory block is extended to the top, left and right by a fixed amount, respectively.

Strided Context

Sparse Transformer (Child et al., 2019) introduced factorized self-attention, through sparse matrix factorization, making it possible to train dense attention networks with hundreds of layers on sequence length up to 16,384, which would be infeasible on modern hardware otherwise.

Given a set of attention connectivity pattern 
𝑆
=
{
𝑆
1
,
…
,
𝑆
𝑛
}
, where each 
𝑆
𝑖
 records a set of key positions that the 
𝑖
-th query vector attends to.

	
	
Attend
(
𝑋
,
𝑆
)
	
=
(
𝑎
(
𝑥
𝑖
,
𝑆
𝑖
)
)
𝑖
∈
{
1
,
…
,
𝐿
}


 where 
𝑎
(
𝑥
𝑖
,
𝑆
𝑖
)
	
=
softmax
(
(
𝑥
𝑖
𝑊
𝑞
)
(
𝑥
𝑗
𝑊
𝑘
)
𝑗
∈
𝑆
𝑖
⊤
𝑑
𝑘
)
(
𝑥
𝑗
𝑊
𝑣
)
𝑗
∈
𝑆
𝑖

Note that although the size of 
𝑆
𝑖
 is not fixed, 
𝑎
(
𝑥
𝑖
,
𝑆
𝑖
)
 is always of size 
𝑑
𝑣
 and thus 
Attend
(
𝑋
,
𝑆
)
∈
𝑅
𝐿
×
𝑑
𝑣
.

In auto-regressive models, one attention span is defined as 
𝑆
𝑖
=
{
𝑗
:
𝑗
≤
𝑖
}
 as it allows each token to attend to all the positions in the past.

In factorized self-attention, the set 
𝑆
𝑖
 is decomposed into a tree of dependencies, such that for every pair of 
(
𝑖
,
𝑗
)
 where 
𝑗
≤
𝑖
, there is a path connecting 
𝑖
 back to 
𝑗
 and 
𝑖
 can attend to 
𝑗
 either directly or indirectly.

Precisely, the set 
𝑆
𝑖
 is divided into 
𝑝
 non-overlapping subsets, where the 
𝑚
-th subset is denoted as 
𝐴
𝑖
(
𝑚
)
⊂
𝑆
𝑖
,
𝑚
=
1
,
…
,
𝑝
. Therefore the path between the output position 
𝑖
 and any 
𝑗
 has a maximum length 
𝑝
+
1
. For example, if 
(
𝑗
,
𝑎
,
𝑏
,
𝑐
,
…
,
𝑖
)
 is a path of indices between 
𝑖
 and 
𝑗
, we would have 
𝑗
∈
𝐴
𝑎
(
1
)
,
𝑎
∈
𝐴
𝑏
(
2
)
,
𝑏
∈
𝐴
𝑐
(
3
)
,
…
, so on and so forth.

Sparse Factorized Attention

Sparse Transformer proposed two types of fractorized attention. It is easier to understand the concepts as illustrated in Fig. 10 with 2D image inputs as examples.

The top row illustrates the attention connectivity patterns in (a) Transformer, (b) Sparse Transformer with strided attention, and (c) Sparse Transformer with fixed attention. The bottom row contains corresponding self-attention connectivity matrices. Note that the top and bottom rows are not in the same scale. (Image source: Child et al., 2019 + a few of extra annotations.)

Strided attention with stride 
ℓ
∼
𝑛
. This works well with image data as the structure is aligned with strides. In the image case, each pixel would attend to all the previous 
ℓ
 pixels in the raster scanning order (naturally cover the entire width of the image) and then those pixels attend to others in the same column (defined by another attention connectivity subset).

	

	
𝐴
𝑖
(
1
)
	
=
{
𝑡
,
𝑡
+
1
,
…
,
𝑖
}
, where 
𝑡
=
max
(
0
,
𝑖
−
ℓ
)


𝐴
𝑖
(
2
)
	
=
{
𝑗
:
(
𝑖
−
𝑗
)
mod
ℓ
=
0
}



Fixed attention. A small set of tokens summarize previous locations and propagate that information to all future locations.

	


	
𝐴
𝑖
(
1
)
	
=
{
𝑗
:
⌊
𝑗
ℓ
⌋
=
⌊
𝑖
ℓ
⌋
}


𝐴
𝑖
(
2
)
	
=
{
𝑗
:
𝑗
mod
ℓ
∈
{
ℓ
−
𝑐
,
…
,
ℓ
−
1
}
}

where 
𝑐
 is a hyperparameter. If 
𝑐
=
1
, it restricts the representation whereas many depend on a few positions. The paper chose 
𝑐
∈
{
8
,
16
,
32
}
 for 
ℓ
∈
{
128
,
256
}
.

Use Factorized Self-Attention in Transformer

There are three ways to use sparse factorized attention patterns in Transformer architecture:

One attention type per residual block and then interleave them,

attn
(
𝑋
)
=
Attend
(
𝑋
,
𝐴
(
𝑛
mod
𝑝
)
)
𝑊
𝑜
, where 
𝑛
 is the index of the current residual block.
Set up a single head which attends to locations that all the factorized heads attend to,

attn
(
𝑋
)
=
Attend
(
𝑋
,
∪
𝑚
=
1
𝑝
𝐴
(
𝑚
)
)
𝑊
𝑜
.
Use a multi-head attention mechanism, but different from vanilla Transformer, each head might adopt a pattern presented above, 1 or 2. 
→
 This option often performs the best.

Sparse Transformer also proposed a set of changes so as to train the Transformer up to hundreds of layers, including gradient checkpointing, recomputing attention & FF layers during the backward pass, mixed precision training, efficient block-sparse implementation, etc. Please check the paper for more details or my previous post on techniques for scaling up model training.

Blockwise Attention (Qiu et al. 2019) introduces a sparse block matrix to only allow each token to attend to a small set of other tokens. Each attention matrix of size 
𝐿
×
𝐿
 is partitioned into 
𝑛
×
𝑛
 smaller blocks of size 
𝐿
𝑛
×
𝐿
𝑛
 and a sparse block matrix 
𝑀
∈
{
0
,
1
}
𝐿
×
𝐿
 is defined by a permutation 
𝜋
 of 
1
,
…
,
𝑛
, which records the column index per row in the block matrix.

	

		
	
		

	
attn
(
𝑄
,
𝐾
,
𝑉
,
𝑀
)
	
=
softmax
(
𝑄
𝐾
⊤
𝑑
⊙
𝑀
)
𝑉


(
𝐴
⊙
𝑀
)
𝑖
𝑗
	
=
{
𝐴
𝑖
𝑗
	
if 
𝑀
𝑖
𝑗
=
1


−
∞
	
if 
𝑀
𝑖
𝑗
=
0


where 
𝑀
𝑖
𝑗
	
=
{
1
	
if 
𝜋
(
⌊
(
𝑖
−
1
)
𝑛
𝐿
+
1
⌋
)
=
⌊
(
𝑗
−
1
)
𝑛
𝐿
+
1
⌋


0
	
otherwise

The actual implementation of Blockwise Attention only stores QKV as block matrices, each of size 
𝑛
×
𝑛
:




Blockwise-attn
(
𝑄
,
𝐾
,
𝑉
,
𝑀
)
=
[
softmax
(
𝑞
^
1
𝑘
^
𝜋
(
1
)
⊤
𝑑
)
𝑣
^
𝜋
(
1
)


⋮


softmax
(
𝑞
^
𝑛
𝑘
^
𝜋
(
𝑛
)
⊤
𝑑
⊙
)
𝑣
^
𝜋
(
𝑛
)
]

where 
𝑞
^
𝑖
, 
𝑘
^
𝑖
 and 
𝑣
^
𝑖
 are the 
𝑖
-the row in the QKV block matrix respectively. Each 
𝑞
𝑖
𝑘
𝜋
(
𝑖
)
⊤
,
∀
𝑖
=
1
,
…
,
𝑛
 is of size 
𝑁
𝑛
×
𝑁
𝑛
 and therefore Blockwise Attention is able to reduce the memory complexity of attention matrix from 
𝑂
(
𝐿
2
)
 to 
𝑂
(
𝐿
𝑛
×
𝐿
𝑛
×
𝑛
)
=
𝑂
(
𝐿
2
/
𝑛
)
.

Combination of Local and Global Context

ETC (Extended Transformer Construction; Ainslie et al. 2019), Longformer (Beltagy et al. 2020) and Big Bird (Zaheer et al. 2020) models combine both local and global context when building an attention matrix. All these models can be initialized from existing pretrained models.

Global-Local Attention of ETC (Ainslie et al. 2019) takes two inputs, (1) the long input 
𝑥
𝑙
 of size 
𝑛
𝑙
 which is the regular input sequence and (2) the global input 
𝑥
𝑔
 of size 
𝑛
𝑔
 which contains a smaller number of auxiliary tokens, 
𝑛
𝑔
≪
𝑛
𝑙
. Attention is thus split into four components based on directional attention across these two inputs: g2g, g2l, l2g and l2l. Because the l2l attention piece can be very large, it is restricted to a fixed size attention span of radius 
𝑤
 (i.e. local attention span) and the l2l matrix can be reshaped to 
𝑛
𝑙
×
(
2
𝑤
+
1
)
.

ETC utilizes four binary matrices to handle structured inputs, 
𝑀
𝑔
2
𝑔
, 
𝑀
𝑔
2
𝑙
, 
𝑀
𝑙
2
𝑔
 and 
𝑀
𝑙
2
𝑙
. For example, each element 
𝑧
𝑖
𝑔
∈
𝑅
𝑑
 in the attention output 
𝑧
𝑔
=
(
𝑧
1
𝑔
,
…
,
𝑧
𝑛
𝑔
𝑔
)
 for g2g attention piece is formatted as:





𝑎
𝑖
𝑗
𝑔
2
𝑔
=
1
𝑑
𝑥
𝑖
𝑔
𝑊
𝑄
(
𝑥
𝑗
𝑔
𝑊
𝐾
+
𝑃
𝑖
𝑗
𝐾
)
⊤
−
(
1
−
𝑀
𝑖
𝑗
𝑔
2
𝑔
)
𝐶


𝐴
𝑖
𝑗
𝑔
2
𝑔
=
exp
⁡
(
𝑎
𝑖
𝑗
𝑔
2
𝑔
)
∑
𝑘
=
1
𝑛
𝑔
exp
⁡
(
𝑎
𝑖
𝑘
𝑔
2
𝑔
)
𝑧
𝑖
𝑔
=
∑
𝑗
=
1
𝑛
𝑔
𝐴
𝑖
𝑗
𝑔
2
𝑔
𝑥
𝑗
𝑔
𝑊
𝑉

where 
𝑃
𝑖
𝑗
𝐾
 is a learnable vector for relative position encoding and 
𝐶
 is a very large constant (
𝐶
=
10000
 in the paper) to offset any attention weights when mask is off.

Attention patterns of ETC, Longformer and Big Bird.

One more update in ETC is to incorporate a CPC (contrastive predictive coding) task using NCE loss into the pretraining stage, besides the MLM task: The representation of one sentence should be similar to the representation of context around it when this sentence is masked.

The global input 
𝑥
𝑔
 for ETC is constructed as follows: Assuming there are some segments within the long inputs (e.g. by sentence), each segment is attached with one auxiliary token to learn global inputs. Relative position encoding is used to mark the global segment tokens with the token position. Hard masking in one direction (i.e., tokens before vs after are labeled differently) is found to bring performance gains in some datasets.

Attention pattern in Longformer contains three components:

Local attention: Similar to ETC, local attention is controlled by a sliding window of fixed size 
𝑤
;
Global attention of preselected tokens: Longformer has a few pre-selected tokens (e.g. [CLS] token) assigned with global attention span, that is, attending to all other tokens in the input sequence.
Dilated attention: Dilated sliding window of fixed size 
𝑟
 and gaps of dilation size 
𝑑
, similar to Sparse Transformer;

Big Bird is quite similar to Longformer, equipped with both local attention and a few preselected tokens with global attention span, but Big Bird replaces dilated attention with a new mechanism where all tokens attend to a set of random tokens. The design is motivated by the fact that attention pattern can be viewed as a directed graph and a random graph has the property that information is able to rapidly flow between any pair of nodes.

Longformer uses smaller window size at lower layers and larger window sizes at higher layers. Ablation studies showed that this setup works better than reversed or fixed size config. Lower layers do not have dilated sliding windows to better learn to use immediate local context. Longformer also has a staged training procedure where initially the model is trained with small window size to learn from local context and then subsequent stages of training have window sizes increased and learning rate decreased.

Content-based Attention

The improvements proposed by Reformer (Kitaev, et al. 2020) aim to solve the following pain points in vanilla Transformer:

Quadratic time and memory complexity within self-attention module.
Memory in a model with 
𝑁
 layers is 
𝑁
-times larger than in a single-layer model because we need to store activations for back-propagation.
The intermediate FF layers are often quite large.

Reformer proposed two main changes:

Replace the dot-product attention with locality-sensitive hashing (LSH) attention, reducing the complexity from 
𝑂
(
𝐿
2
)
 to 
𝑂
(
𝐿
log
⁡
𝐿
)
.
Replace the standard residual blocks with reversible residual layers, which allows storing activations only once during training instead of 
𝑁
 times (i.e. proportional to the number of layers).

Locality-Sensitive Hashing Attention

In 
𝑄
𝐾
⊤
 part of the attention formula, we are only interested in the largest elements as only large elements contribute a lot after softmax. For each query 
𝑞
𝑖
∈
𝑄
, we are looking for row vectors in 
𝐾
 closest to 
𝑞
𝑖
. In order to find nearest neighbors quickly in high-dimensional space, Reformer incorporates Locality-Sensitive Hashing (LSH) into its attention mechanism.

A hashing scheme 
𝑥
↦
ℎ
(
𝑥
)
 is locality-sensitive if it preserves the distancing information between data points, such that close vectors obtain similar hashes while distant vectors have very different ones. The Reformer adopts a hashing scheme as such, given a fixed random matrix 
𝑅
∈
𝑅
𝑑
×
𝑏
/
2
 (where 
𝑏
 is a hyperparam), the hash function is 
ℎ
(
𝑥
)
=
arg
⁡
max
(
[
𝑥
𝑅
;
−
𝑥
𝑅
]
)
.

Illustration of Locality-Sensitive Hashing (LSH) attention. (Image source: right part of Figure 1 in Kitaev, et al. 2020).

In LSH attention, a query can only attend to positions in the same hashing bucket, 
𝑆
𝑖
=
{
𝑗
:
ℎ
(
𝑞
𝑖
)
=
ℎ
(
𝑘
𝑗
)
}
. It is carried out in the following process, as illustrated in Fig. 20:

(a) The attention matrix for full attention is often sparse.
(b) Using LSH, we can sort the keys and queries to be aligned according to their hash buckets.
(c) Set 
𝑄
=
𝐾
 (precisely 
𝑘
𝑗
=
𝑞
𝑗
/
|
𝑞
𝑗
|
), so that there are equal numbers of keys and queries in one bucket, easier for batching. Interestingly, this “shared-QK” config does not affect the performance of the Transformer.
(d) Apply batching where chunks of 
𝑚
 consecutive queries are grouped together.
The LSH attention consists of 4 steps: bucketing, sorting, chunking, and attention computation. (Image source: left part of Figure 1 in Kitaev, et al. 2020).

Reversible Residual Network

Another improvement by Reformer is to use reversible residual layers (Gomez et al. 2017). The motivation for reversible residual network is to design the architecture in a way that activations at any given layer can be recovered from the activations at the following layer, using only the model parameters. Hence, we can save memory by recomputing the activation during backprop rather than storing all the activations.

Given a layer 
𝑥
↦
𝑦
, the normal residual layer does 
𝑦
=
𝑥
+
𝐹
(
𝑥
)
, but the reversible layer splits both input and output into pairs 
(
𝑥
1
,
𝑥
2
)
↦
(
𝑦
1
,
𝑦
2
)
 and then executes the following:

𝑦
1
=
𝑥
1
+
𝐹
(
𝑥
2
)
,
𝑦
2
=
𝑥
2
+
𝐺
(
𝑦
1
)

and reversing is easy:

𝑥
2
=
𝑦
2
−
𝐺
(
𝑦
1
)
,
𝑥
1
=
𝑦
1
−
𝐹
(
𝑥
2
)

Reformer applies the same idea to Transformer by combination attention (
𝐹
) and feed-forward layers (
𝐺
) within a reversible net block:

𝑌
1
=
𝑋
1
+
Attention
(
𝑋
2
)
,
𝑌
2
=
𝑋
2
+
FeedForward
(
𝑌
1
)

The memory can be further reduced by chunking the feed-forward computation:

𝑌
2
=
[
𝑌
2
(
1
)
;
…
;
𝑌
2
(
𝑐
)
]
=
[
𝑋
2
(
1
)
+
FeedForward
(
𝑌
1
(
1
)
)
;
…
;
𝑋
2
(
𝑐
)
+
FeedForward
(
𝑌
1
(
𝑐
)
)
]

The resulting reversible Transformer does not need to store activation in every layer.

Routing Transformer (Roy et al. 2021) is also built on content-based clustering of keys and queries. Instead of using a static hashing function like LSH, it utilizes online 
𝑘
-means clustering and combines it with local, temporal sparse attention to reduce the attention complexity from 
𝑂
(
𝐿
2
)
 to 
𝑂
(
𝐿
1.5
)
.

Within routing attention, both keys and queries are clustered with 
𝑘
-means clustering method and the same set of centroids 
𝜇
=
(
𝜇
1
,
…
,
𝜇
𝑘
)
∈
𝑅
𝑘
×
𝑑
. Queries are routed to keys that get assigned to the same centroid. The total complexity is 
𝑂
(
𝐿
𝑘
𝑑
+
𝐿
2
𝑑
/
𝑘
)
, where 
𝑂
(
𝐿
𝑘
𝑑
)
 is for running clustering assignments and 
𝑂
(
𝐿
2
𝑑
/
𝑘
)
 is for attention computation. The cluster centroids are updated by EMA (exponential moving average) using all associated keys and queries.

In the experiments for Routing Transformer, some best config only has routing attention enabled in the last two layers of the model and half of the attention heads, while the other half utilizing local attention. They also observed that local attention is a pretty strong baseline and larger attention window always leads to better results.

Low-Rank Attention

Linformer (Wang et al. 2020) approximates the full attention matrix with a low rank matrix, reducing the time & space complexity to be linear. Instead of using expensive SVD to identify low rank decomposition, Linformer adds two linear projections 
𝐸
𝑖
,
𝐹
𝑖
∈
𝑅
𝐿
×
𝑘
 for key and value matrices, respectively, reducing their dimensions from 
𝐿
×
𝑑
 to 
𝑘
×
𝑑
. As long as 
𝑘
≪
𝐿
, the attention memory can be greatly reduced.

	

	

				

head
―
𝑖
	
=
attn
(
𝑋
𝑞
𝑊
𝑖
𝑞
,
𝐸
𝑖
𝑋
𝑘
𝑊
𝑖
𝑘
,
𝐹
𝑖
𝑋
𝑣
𝑊
𝑖
𝑣
)

	
=
softmax
(
𝑋
𝑞
𝑊
𝑖
𝑞
(
𝐸
𝑖
𝑋
𝑘
𝑊
𝑖
𝑘
)
⊤
𝑑
)
⏟
low rank attention matrix 
𝐴
¯
∈
𝑅
𝑘
×
𝑑
𝐹
𝑖
𝑋
𝑣
𝑊
𝑖
𝑣

Additional techniques can be applied to further improve efficiency of Linformer:

Parameter sharing between projection layers, such as head-wise, key-value and layer-wise (across all layers) sharing.
Use different 
𝑘
 at different layers, as heads in higher layers tend to have a more skewed distribution (lower rank) and thus we can use smaller 
𝑘
 at higher layers.
Use different types of projections; e.g. mean/max pooling, convolution layer with kernel and stride 
𝐿
/
𝑘
.
(Left) Informer has two projection layers added for keys and values. (Right) Plot of inference time as a function of sequence length. (Image source: Wang et al. 2020).

Random Feature Attention (RFA; Peng et al. 2021) relies on random feature methods (Rahimi & Recht, 2007) to approximate softmax operation in self-attention with low rank feature maps in order to achieve linear time and space complexity. Performers (Choromanski et al. 2021) also adopts random feature attention with improvements on the kernel construction to further reduce the kernel approximation error.

The main theorem behind RFA is from Rahimi & Recht, 2007:

Let 
𝜙
:
𝑅
𝑑
→
𝑅
2
𝐷
 be a nonlinear transformation:

𝜙
(
𝑥
)
=
1
𝐷
[
sin
⁡
(
𝑤
1
⊤
𝑥
)
,
…
,
sin
⁡
(
𝑤
𝐷
⊤
𝑥
)
,
cos
⁡
(
𝑤
1
⊤
𝑥
)
,
…
,
cos
⁡
(
𝑤
𝐷
⊤
𝑥
)
]
⊤
When 
𝑑
-dimensional random vectors 
𝑤
𝑖
 are i.i.d. from 
𝑁
(
0
,
𝜎
2
𝐼
𝑑
)
,
𝐸
𝑤
𝑖
[
𝜙
(
𝑥
)
⋅
𝜙
(
𝑦
)
]
=
exp
⁡
(
−
‖
𝑥
−
𝑦
‖
2
2
𝜎
2
)

An unbiased estimation of 
exp
⁡
(
𝑥
⋅
𝑦
)
 is:

	
	
	
	
	
	
	
	
exp
⁡
(
𝑥
⋅
𝑦
/
𝜎
2
)
	
=
exp
⁡
(
1
2
𝜎
2
(
‖
𝑥
‖
2
+
‖
𝑦
‖
2
−
‖
𝑥
−
𝑦
‖
2
)

	
=
exp
⁡
(
‖
𝑥
‖
2
2
𝜎
2
)
exp
⁡
(
‖
𝑦
‖
2
2
𝜎
2
)
(
−
‖
𝑥
−
𝑦
‖
2
2
𝜎
2
)

	
≈
exp
⁡
(
‖
𝑥
‖
2
2
𝜎
2
)
exp
⁡
(
‖
𝑦
‖
2
2
𝜎
2
)
𝜙
(
𝑥
)
⋅
𝜙
(
𝑦
)

	
=
exp
⁡
(
1
𝜎
2
)
𝜙
(
𝑥
)
⋅
𝜙
(
𝑦
)
	
; unit vectors

Then we can write the attention function as follows, where 
⊗
 is outer product operation and 
𝜎
2
 is the temperature:

	




	
attn
(
𝑞
𝑡
,
{
𝑘
𝑖
}
,
{
𝑣
𝑖
}
)
	
=
∑
𝑖
exp
⁡
(
𝑞
𝑡
⋅
𝑘
𝑖
/
𝜎
2
)
∑
𝑗
exp
⁡
(
𝑞
𝑡
⋅
𝑘
𝑗
/
𝜎
2
)
𝑣
𝑖
⊤
≈
∑
𝑖
𝜙
(
𝑞
𝑡
)
𝜙
(
𝑘
𝑖
)
𝑣
𝑖
⊤
∑
𝑗
𝜙
(
𝑞
𝑡
)
𝜙
(
𝑘
𝑗
)

	
=
𝜙
(
𝑞
𝑡
)
⊤
∑
𝑖
𝜙
(
𝑘
𝑖
)
⊗
𝑣
𝑖
𝜙
(
𝑞
𝑡
)
⊤
∑
𝑗
𝜙
(
𝑘
𝑗
)
=
RFA
(
𝑞
𝑡
,
{
𝑘
𝑖
}
,
{
𝑣
𝑖
}
)
(Left) The order of computation for default softmax operation. (Right) The order of computation when using random feature attention, a lot cheaper than default softmax. (Image source: Peng et al. 2021).

Causal Attention RFA has token at time step 
𝑡
 only attend to earlier keys and values 
{
𝑘
𝑖
}
𝑖
≤
𝑡
,
{
𝑣
𝑖
}
𝑖
≤
𝑡
. Let us use a tuple of variables, 
(
𝑆
𝑡
∈
𝑅
2
𝐷
×
𝑑
,
𝑧
∈
𝑅
2
𝐷
)
, to track the hidden state history at time step 
𝑡
, similar to RNNs:

	

	
	
causal-RFA
(
𝑞
𝑡
,
{
𝑘
𝑖
}
𝑖
≤
𝑡
,
{
𝑣
𝑖
}
𝑖
≤
𝑡
)
=
𝜙
(
𝑞
𝑡
)
⊤
𝑆
𝑡
𝜙
(
𝑞
𝑡
)
⋅
𝑧
𝑡

	
where 
𝑆
𝑡
=
𝑆
𝑡
−
1
+
𝜙
(
𝑘
𝑡
)
⊗
𝑣
𝑡
,
𝑧
𝑡
=
𝑧
𝑡
−
1
+
𝜙
(
𝑘
𝑡
)

where 
2
𝐷
 is the size of 
𝜙
(
.
)
 and 
𝐷
 should be no less than the model size 
𝑑
 for reasonable approximation.

RFA leads to significant speedup in autoregressive decoding and the memory complexity mainly depends on the choice of 
𝐷
 when constructing the kernel 
𝜙
(
.
)
.

Performer modifies the random feature attention with positive random feature maps to reduce the estimation error. It also keeps the randomly sampled 
𝑤
1
,
…
,
𝑤
𝐷
 to be orthogonal to further reduce the variance of the estimator.

Comparison of approximation error when using (Left) i.i.d vs orthogonal features and (Right) sin/cos vs positive random features. (Image source: Choromanski et al. 2021).
Transformers for Reinforcement Learning

The self-attention mechanism avoids compressing the whole past into a fixed-size hidden state and does not suffer from vanishing or exploding gradients as much as RNNs. Reinforcement Learning tasks can for sure benefit from these traits. However, it is quite difficult to train Transformer even in supervised learning, let alone in the RL context. It could be quite challenging to stabilize and train a LSTM agent by itself, after all.

The Gated Transformer-XL (GTrXL; Parisotto, et al. 2019) is one attempt to use Transformer for RL. GTrXL succeeded in stabilizing training with two changes on top of Transformer-XL:

The layer normalization is only applied on the input stream in a residual module, but NOT on the shortcut stream. A key benefit to this reordering is to allow the original input to flow from the first to last layer.
The residual connection is replaced with a GRU-style (Gated Recurrent Unit; Chung et al., 2014) gating mechanism.
	

	


	

	
𝑟
	
=
𝜎
(
𝑊
𝑟
(
𝑙
)
𝑦
+
𝑈
𝑟
(
𝑙
)
𝑥
)


𝑧
	
=
𝜎
(
𝑊
𝑧
(
𝑙
)
𝑦
+
𝑈
𝑧
(
𝑙
)
𝑥
−
𝑏
𝑔
(
𝑙
)
)


ℎ
^
	
=
tanh
⁡
(
𝑊
𝑔
(
𝑙
)
𝑦
+
𝑈
𝑔
(
𝑙
)
(
𝑟
⊙
𝑥
)
)


𝑔
(
𝑙
)
(
𝑥
,
𝑦
)
	
=
(
1
−
𝑧
)
⊙
𝑥
+
𝑧
⊙
ℎ
^

The gating function parameters are explicitly initialized to be close to an identity map - this is why there is a 
𝑏
𝑔
 term. A 
𝑏
𝑔
>
0
 greatly helps with the learning speedup.

Comparison of the model architecture of Transformer-XL, Transformer-XL with the layer norm reordered, and Gated Transformer-XL. (Image source: Figure 1 in Parisotto, et al. 2019)

Decision Transformer (DT; Chen et al 2021) formulates Reinforcement Learning problems as a process of conditional sequence modeling, outputting the optimal actions conditioned on the desired return, past states and actions. It therefore becomes straightforward to use Transformer architecture. Decision Transformer is for off-policy RL, where the model only has access to a fixed collection of trajectories collected by other policies.

To encourage the model to learn how to act in order to achieve a desired return, it feeds the model with desired future return 
𝑅
^
=
∑
𝑡
′
=
𝑡
𝑇
𝑟
𝑡
′
 instead of the current reward. The trajectory consists of a list of triplets, (return-to-go 
𝑅
^
𝑡
,
𝑠
𝑡
𝑎
𝑡
𝑒
s_t
,
𝑎
𝑐
𝑡
𝑖
𝑜
𝑛
a_t$), and it is used as an input sequence for Transformer:

𝜏
=
(
𝑅
^
1
,
𝑠
1
,
𝑎
1
,
𝑅
^
2
,
𝑠
2
,
𝑎
2
,
…
,
𝑅
^
𝑇
,
𝑠
𝑇
,
𝑎
𝑇
)

Three linear layers are added and trained for return-to-go, state and action respectively to extract token embeddings. The prediction head learns to predict 
𝑎
𝑡
 corresponding to the input token 
𝑠
𝑡
. The training uses cross-entropy loss for discrete actions or MSE for continuous actions. Predicting the states or return-to-go was not found to help improve the performance in their experiments.

The experiments compared DT with several model-free RL algorithm baselines and showed that:

DT is more efficient than behavior cloning in low data regime;
DT can model the distribution of returns very well;
Having a long context is crucial for obtaining good results;
DT can work with sparse rewards.
Citation

Cited as:

Weng, Lilian. (Jan 2023). The transformer family version 2.0. Lil’Log. https://lilianweng.github.io/posts/2023-01-27-the-transformer-family-v2/.

Or

@article{weng2023transformer,
  title   = "The Transformer Family Version 2.0",
  author  = "Weng, Lilian",
  journal = "lilianweng.github.io",
  year    = "2023",
  month   = "Jan",
  url     = "https://lilianweng.github.io/posts/2023-01-27-the-transformer-family-v2/"
}

References

[1] Ashish Vaswani, et al. “Attention is all you need.” NIPS 2017.

[2] Rami Al-Rfou, et al. “Character-level language modeling with deeper self-attention.” AAAI 2019.

[3] Olah & Carter, “Attention and Augmented Recurrent Neural Networks”, Distill, 2016.

[4] Sainbayar Sukhbaatar, et al. “Adaptive Attention Span in Transformers”. ACL 2019.

[5] Rewon Child, et al. “Generating Long Sequences with Sparse Transformers” arXiv:1904.10509 (2019).

[6] Nikita Kitaev, et al. “Reformer: The Efficient Transformer” ICLR 2020.

[7] Alex Graves. (“Adaptive Computation Time for Recurrent Neural Networks”)[https://arxiv.org/abs/1603.08983]

[8] Niki Parmar, et al. “Image Transformer” ICML 2018.

[9] Zihang Dai, et al. “Transformer-XL: Attentive Language Models Beyond a Fixed-Length Context.” ACL 2019.

[10] Aidan N. Gomez, et al. “The Reversible Residual Network: Backpropagation Without Storing Activations” NIPS 2017.

[11] Mostafa Dehghani, et al. “Universal Transformers” ICLR 2019.

[12] Emilio Parisotto, et al. “Stabilizing Transformers for Reinforcement Learning” arXiv:1910.06764 (2019).

[13] Rae et al. “Compressive Transformers for Long-Range Sequence Modelling.” 2019.

[14] Press et al. “Train Short, Test Long: Attention With Linear Biases Enables Input Length Extrapolation.” ICLR 2022.

[15] Wu, et al. “DA-Transformer: Distance Aware Transformer” 2021.

[16] Elabyad et al. “Depth-Adaptive Transformer.” ICLR 2020.

[17] Schuster et al. “Confident Adaptive Language Modeling” 2022.

[18] Qiu et al. “Blockwise self-attention for long document understanding” 2019

[19] Roy et al. “Efficient Content-Based Sparse Attention with Routing Transformers.” 2021.

[20] Ainslie et al. “ETC: Encoding Long and Structured Inputs in Transformers.” EMNLP 2019.

[21] Beltagy et al. “Longformer: The long-document transformer.” 2020.

[22] Zaheer et al. “Big Bird: Transformers for Longer Sequences.” 2020.

[23] Wang et al. “Linformer: Self-Attention with Linear Complexity.” arXiv preprint arXiv:2006.04768 (2020).

[24] Tay et al. 2020 “Sparse Sinkhorn Attention.” ICML 2020.

[25] Peng et al. “Random Feature Attention.” ICLR 2021.

[26] Choromanski et al. “Rethinking Attention with Performers.” ICLR 2021.

[27] Khandelwal et al. “Generalization through memorization: Nearest neighbor language models.” ICLR 2020.

[28] Yogatama et al. “Adaptive semiparametric language models.” ACL 2021.

[29] Wu et al. “Memorizing Transformers.” ICLR 2022.

[30] Su et al. “Roformer: Enhanced transformer with rotary position embedding.” arXiv preprint arXiv:2104.09864 (2021).

[31] Shaw et al. “Self-attention with relative position representations.” arXiv preprint arXiv:1803.02155 (2018).

[32] Tay et al. “Efficient Transformers: A Survey.” ACM Computing Surveys 55.6 (2022): 1-28.

[33] Chen et al., “Decision Transformer: Reinforcement Learning via Sequence Modeling” arXiv preprint arXiv:2106.01345 (2021).

Architecture
 
Attention
 
Transformer
 
Foundation
 
Long-Read
 
Reinforcement-Learning
«
Prompt Engineering
»
Large Transformer Model Inference Optimization
© 2026 Lil'Log Powered by Hugo & PaperMod
