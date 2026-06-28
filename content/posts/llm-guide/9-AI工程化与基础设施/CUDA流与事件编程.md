---
title: "9 CUDA 流与事件编程"
date: 2026-05-16
tags: [CUDA, Stream, Event, 异步, GPU, 并行]
---

# CUDA 流与事件编程

> 本文介绍 CUDA 流(Stream)和事件(Event)的核心概念,展示如何利用流实现内核并行执行、异步数据传输,以及事件用于精确计时和同步. 

---

## 1. CUDA 流的核心概念

### 1.1 什么是流

**流(Stream)** 是 GPU 上的独立任务队列. 同一流内的操作按顺序执行,不同流之间可以并行执行. 

默认情况下,所有 CUDA 操作在**默认流(Default Stream)** 中执行. 默认流是特殊的流,其行为取决于运行模式(legacy 或 per-thread). 

### 1.2 为什么需要流

场景: 需要 normalize 10 个独立的数组
- 无流: 逐个 normalize,GPU 串行执行
- 多流: 每个数组一个流,10 个 normalize 并行执行

**收益**: 充分利用 GPU 的并行计算能力,显著降低总运行时间. 

---

## 2. 流的基本用法

### 2.1 创建和使用流

```python
import numba
from numba import cuda

# 创建流
stream = cuda.stream()

# 在流中执行数据传输(异步)
dev_a = cuda.to_device(a, stream=stream)

# 在流中启动内核
kernel[blocks, threads, stream](dev_a, dev_b)

# 在流中执行数据回传(异步)
dev_b.copy_to_host(b, stream=stream)

# 同步流
stream.synchronize()
```

### 2.2 自动同步上下文

```python
with cuda.pinned(a):
    stream = cuda.stream()
    with stream.auto_synchronize():
        dev_a = cuda.to_device(a, stream=stream)
        kernel[blocks, threads, stream](dev_a)
        dev_a.copy_to_host(a, stream=stream)
    # 退出上下文时自动同步
```

### 2.3 固定内存(Pinned Memory)

**问题**: 主机内存可能被操作系统分页到磁盘,CUDA 不允许从可分页内存异步传输到 GPU. 

**解决**: 使用 `cuda.pinned()` 锁定内存,确保数据始终在 RAM 中. 

```python
with cuda.pinned(a):
    # 此上下文中的数组被锁定在 RAM 中
    dev_a = cuda.to_device(a, stream=stream)  # 异步传输
```

---

## 3. 多流并行示例

### 3.1 多个独立任务

```python
N_streams = 10
streams = [cuda.stream() for _ in range(N_streams)]

with cuda.defer_cleanup():
    for i, stream in enumerate(streams):
        dev_a = cuda.to_device(arrays[i], stream=stream)
        dev_out = cuda.device_array_like(dev_a, stream=stream)
        normalize_kernel[blocks, threads, stream](dev_a, dev_out)
        dev_out.copy_to_host(results[i], stream=stream)
    
    # 同步所有流
    for stream in streams:
        stream.synchronize()
```

### 3.2 流的依赖关系

虽然不同流可以并行,但有时需要建立依赖关系: 

```python
# 流 2 的操作依赖流 1 的某个事件完成
event = cuda.event()
stream1.record(event)
stream2.wait(event)
```

---

## 4. CUDA 事件

### 4.1 事件的作用

- **计时**: 精确测量 GPU 操作的时间
- **同步**: 在不同流之间建立同步点

### 4.2 事件的用法

```python
# 创建事件
start_event = cuda.event()
end_event = cuda.event()

# 记录事件
start_event.record(stream)
kernel[blocks, threads, stream](dev_a)
end_event.record(stream)

# 计算耗时(毫秒)
elapsed_ms = cuda.event_elapsed_time(start_event, end_event)
```

---

## 5. 工程实践建议

| 场景 | 建议 |
|:-----|:-----|
| 独立任务并行 | 为每个任务创建独立流 |
| 数据传输 + 计算重叠 | H2D 在一个流,计算在另一个流,D2H 在第三个流 |
| 精确计时 | 使用事件而非 CPU 计时 |
| 异步传输 | 务必使用 pinned memory |
| 流数量 | 通常 4-32 个流即可,过多反而增加调度开销 |

---

## 6. 总结

CUDA 流和事件是 GPU 编程的核心工具: 

- **流**: 实现任务级并行,最大化 GPU 利用率
- **事件**: 精确计时和跨流同步
- **Pinned Memory**: 异步传输的前提

> 参考来源: [从头开始进行 CUDA 编程: 流和事件](https://zhuanlan.zhihu.com/p/585914275)
