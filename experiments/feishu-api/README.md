# 飞书 API 测试实验室

用 Python 快速验证飞书 Open API 的各项能力,为 Agent 工具开发提供依据. 

## 文件结构

```
feishu-api/
├── README.md                    # 本文件
├── requirements.txt             # Python 依赖
├── feishu_client.py             # 飞书 API 客户端封装
├── test_feishu_client.py        # pytest 测试套件
├── 99_feishu_api_showcase.ipynb # 全流程验证 Notebook
└── ...
```

## 快速开始

### 1. 安装依赖

```bash
cd project/experiments/feishu-api
pip install -r requirements.txt
```

### 2. 配置环境变量

在项目根目录 `.env` 文件中添加：

```env
FEISHU_APP_ID=cli_a968d68370f8dbd6
FEISHU_APP_SECRET=XeqfWpdmyCjW6uPVUVJYcgD41aTNz57f

# 可选：设置后文档创建时自动授予你编辑权限
FEISHU_OWNER_OPEN_ID=ou_xxx

# 可选：用于用户查找测试
FEISHU_TEST_EMAIL=your@email.com
```

### 3. 启动 Jupyter

```bash
jupyter lab
```

按顺序运行 Notebook：
1. `01_auth_and_token.ipynb` — 验证认证是否成功
2. `02_doc_crud.ipynb` — 测试文档核心操作
3. `03_search_msg_user.ipynb` — 测试搜索、消息、用户
4. `04_advanced_blocks.ipynb` — 测试各种块类型

## 关键发现(待验证)

| 能力 | API 端点 | 状态 |
|------|----------|------|
| 获取 tenant_access_token | `POST /auth/v3/tenant_access_token/internal` | 待验证 |
| 创建文档 | `POST /docx/v1/documents` | 待验证 |
| 读取纯文本 | `GET /docx/v1/documents/{id}/raw_content` | 待验证 |
| 获取块结构 | `GET /docx/v1/documents/{id}/blocks/{id}/children` | 待验证 |
| 追加块 | `POST /docx/v1/documents/{id}/blocks/{id}/children` | 待验证 |
| 更新块 | `PATCH /docx/v1/documents/{id}/blocks/{block_id}` | 待验证 |
| 删除块 | `DELETE /docx/v1/documents/{id}/blocks/{block_id}` | 待验证 |
| 搜索文档 | `POST /drive/v1/files/search` | 待验证 |
| 发送消息 | `POST /im/v1/messages` | 待验证 |
| 查找用户 | `POST /contact/v3/users/batch_get_id` | 待验证 |
| 授予权限 | `POST /drive/v1/permissions/{id}/members` | 待验证 |

## 参考资源

- [joeseesun/qiaomu-feishu-lark-agent](https://github.com/joeseesun/qiaomu-feishu-lark-agent) — 零依赖 Python CLI
- [飞书开放平台文档](https://open.feishu.cn/document/server-docs)
- [飞书文档 API 概述](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/docx-overview)
