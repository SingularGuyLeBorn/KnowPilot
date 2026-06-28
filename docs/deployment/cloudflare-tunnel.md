# Cloudflare Tunnel 远程访问

通过 Cloudflare Tunnel 把本机 KnowPilot 暴露到公网，手机/外网浏览器可访问。

## 架构

```text
浏览器 ──HTTPS──► Cloudflare Edge ──Tunnel──► cloudflared ──► Next.js :3000
                                                              └── rewrite ──► Express :3010
```

**只暴露 3000 端口即可**：tRPC、SSE 流式 Chat、静态资源均由 Next.js `rewrites` 反代到本机 `3010`。

## 前置条件

1. 本机已 `pnpm install`
2. 安装 cloudflared：

```powershell
winget install Cloudflare.cloudflared
```

3. 启动应用（二选一）：

```bash
pnpm dev              # 开发 + db sync watch
pnpm dev:remote       # 同上，Web 监听 0.0.0.0（局域网调试）
```

## 方式 A：临时链接（最快，无需域名）

新开终端：

```bash
pnpm tunnel:quick
```

终端会输出类似：

```text
https://random-words.trycloudflare.com
```

用该 URL 在任意设备打开即可。**链接随进程退出失效**。

## 方式 B：固定域名（推荐长期使用）

1. 登录 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → **Create a tunnel**
2. 选择 **Cloudflared**，命名如 `knowpilot`
3. 在 **Public Hostname** 添加：
   - **Subdomain**：`knowpilot`（或任意）
   - **Domain**：你的域名
   - **Service Type**：HTTP
   - **URL**：`127.0.0.1:3000`
4. 复制安装命令中的 **Token**，写入项目根 `.env`：

```env
CLOUDFLARE_TUNNEL_TOKEN=eyJh...
PUBLIC_URL=https://knowpilot.yourdomain.com
CORS_ORIGINS=https://knowpilot.yourdomain.com
```

5. 启动隧道：

```bash
pnpm tunnel:run
```

6. 浏览器访问 `PUBLIC_URL`

### 可选：本地 config.yml

复制 `cloudflare/config.example.yml` → `cloudflare/config.yml`，填入 tunnel UUID 与 credentials，然后：

```bash
pnpm tunnel:run:config
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `PUBLIC_URL` | 公网访问地址（含 `https://`），用于 CORS 与文档 |
| `CORS_ORIGINS` | 逗号分隔的允许来源；不设则默认 localhost |
| `CLOUDFLARE_TUNNEL_TOKEN` | Zero Trust 隧道 Token |
| `SERVER_INTERNAL_URL` | Next.js rewrite 目标，默认 `http://127.0.0.1:3010` |
| `WEB_HOST` | Web dev 绑定地址，远程模式默认 `0.0.0.0` |

## 安全提醒

当前 KnowPilot 为**单用户无鉴权**模式。暴露到公网前务必：

1. 在 Cloudflare Zero Trust 为隧道 hostname 配置 **Access**（邮箱 OTP / Google 登录等）
2. 或使用 Cloudflare **WAF** 限制 IP
3. 勿将 `.env`、API Key 提交到 Git

## 故障排查

| 现象 | 处理 |
|---|---|
| 502 Bad Gateway | 确认 `pnpm dev` 已启动且 3000 可访问 |
| API 失败 | 确认 server 3010 正常；本机访问 `http://127.0.0.1:3010/health` |
| Chat 流式卡住 | Tunnel ingress 需 `Cache-Control: no-cache`（服务端已设置）；检查 Cloudflare 是否缓存 |
| CORS 错误 | 在 `.env` 设置 `CORS_ORIGINS` 为你的公网 URL |
