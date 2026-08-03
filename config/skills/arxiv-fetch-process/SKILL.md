---
name: "arxiv-fetch-process"
description: "arxiv-fetch-process"
icon: "Sparkles"
trigger: "/arxiv-fetch-process"
enabled: true
kind: procedural
---
# arXiv 抓取与处理

把 arXiv 论文从 ID 到可读 Markdown 的标准化流水线。

## 何时加载

用户给 arXiv ID / 链接，要：下载 PDF、转 Markdown、精读、入库、写综述。

## 工具链（固定顺序）

| 步骤 | 工具 | 关键参数 |
|------|------|----------|
| 0. 搜索论文（可选） | `search_arxiv` | `query` 关键词，`max_results` 限制条数 |
| 1. 元数据+PDF链接 | `fetch_arxiv` | `id` = `2305.12345v2` 或 `abs/2305.12345` |
| 2. 下载 PDF 到 Workspace | `download_file` | `url` = fetch_arxiv 返回的 `pdf_url`，`filename` 建议 `arxiv-{id}.pdf` |
| 3. PDF → Markdown | `document_to_markdown` | `file_path` = 上一步保存路径 |
| 4. （可选）精读/摘要 | `read_article` | 对生成的 `.md` 用 offset 分段读 |
| 5. 落盘 | `write_file` / `post_create` | 存 Workspace 或数字花园 |

## 常见坑 & 对策

- **版本号**：`fetch_arxiv` 返回最新版；要旧版显式传 `v1`。
- **大 PDF**：`document_to_markdown` 可能超时 → 先 `download_file` 再分页处理，或只转前 N 页。
- **公式渲染**：转出的 Markdown 里的 LaTeX 已是 `$…$`/`$$…$$`，直接可用；不要再手改成 Unicode。
- **引用格式**：建议在报告里统一用 `title · year · arXiv:ID`。

## 最小可用片段（复制即跑）

```python
# 伪代码：把 ID 变成可读 Markdown 路径
meta = fetch_arxiv({id: "2401.12345"})
pdf_path = download_file({url: meta.pdf_url, filename: "arxiv-2401.12345.pdf"})
md_path = document_to_markdown({file_path: pdf_path})
# 现在 md_path 可直接 read_article / post_create
```

## 关联技能

- `deep-research`：把本技能作为「文献获取」子步骤调用。
- `literature-search`：先用 `literature_search` 拿 ID，再走本流程。
