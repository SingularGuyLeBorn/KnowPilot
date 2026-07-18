# Cloudflare Tunnel：把本机 KnowPilot 暴露到公网

KnowPilot 已内置 Tunnel 脚本与 CORS / 鉴权挂钩。**不要**把路由器端口映射到 3000/3010；用 Cloudflare Tunnel 出站建隧道即可，本机无需公网 IP。

手机远程访问时，请用文末的 Tunnel URL；界面底栏与 Chat 单栏叠层见移动端改造说明。系统设置页（`/settings`）也可查看 `PUBLIC_URL` 与鉴权状态。

---

## 架构（你需要知道的）

```text
手机 / 外网浏览器
    │  HTTPS
    ▼
Cloudflare Edge（*.trycloudflare.com 或你的域名）
    │  Tunnel（出站，无需开端口）
    ▼
本机 cloudflared  →  http://127.0.0.1:3000（Next.js）
                          │  next.config rewrites
                          ▼
                     http://127.0.0.1:3010（Express / tRPC / SSE）
```

只暴露 **3000**。API 与 SSE 走 Web 同源 rewrite，不要单独把 3010 挂到公网。

---

## 方案 A：临时链接（最快，适合试一下）

适合：临时演示、自己手机试连。链接每次重启会变，有速率/稳定性限制。

### 1. 安装 cloudflared

```powershell
winget install Cloudflare.cloudflared
# 或把 cloudflared.exe 放到仓库 cloudflare\ 目录
```

### 2. 启动本地服务

```powershell
# 在仓库根目录
pnpm install
pnpm db:sync
pnpm dev
# 确认本机可打开 http://localhost:3000
```

公网试用前建议在 `.env` 打开密码（见下方「必开鉴权」）。

### 3. 开临时隧道

另开一个终端：

```powershell
pnpm tunnel:quick
```

终端会出现类似：

```text
https://xxxx-xxxx.trycloudflare.com
```

用手机浏览器打开该地址即可。

临时隧道没有固定域名时，可把该 URL 临时写入 `.env`：

```env
PUBLIC_URL=https://xxxx-xxxx.trycloudflare.com
AUTH_MODE=password
AUTH_PASSWORD=换成强密码
```

改完 `.env` 后**重启** `pnpm dev`，让 CORS 与鉴权生效。

---

## 方案 B：固定域名（推荐日常远程用）

适合：长期用自己的域名（如 `https://kp.example.com`），地址稳定。

### 1. Cloudflare 侧

1. 域名已接入 Cloudflare DNS。
2. 打开 [Zero Trust → Networks → Tunnels](https://one.dash.cloudflare.com/) → **Create a tunnel**。
3. 选 **Cloudflared**，复制安装用的 **Token**。
4. Public Hostname 示例：
   - **Subdomain / Domain**：`kp` + `example.com`
   - **Service**：`HTTP` → `http://127.0.0.1:3000`

### 2. 本机 `.env`

从 `.env.example` 复制并填写（勿提交真实密钥）：

```env
CLOUDFLARE_TUNNEL_TOKEN=eyJh...你的Token...
PUBLIC_URL=https://kp.example.com

# 公网必须开鉴权
AUTH_MODE=password
AUTH_PASSWORD=换成强密码
# AUTH_TOKEN=   # 可选；不设则与 AUTH_PASSWORD 相同

# 一般不必写；PUBLIC_URL 已会并入 CORS
# CORS_ORIGINS=https://kp.example.com
```

### 3. 启动

终端 1 — 业务进程：

```powershell
pnpm dev
# 或需要绑定 0.0.0.0 时：
# pnpm dev:remote
```

终端 2 — 隧道：

```powershell
pnpm tunnel:run
```

浏览器打开 `PUBLIC_URL`，应跳到登录页；输入 `AUTH_PASSWORD` 后进入控制台。

### 可选：配置文件模式

不用 Token 时，可复制示例配置：

```powershell
copy cloudflare\config.example.yml cloudflare\config.yml
# 编辑 hostname / tunnel / credentials-file
pnpm tunnel:run:config
```

`config.example.yml` 已注明：ingress 只指到 `127.0.0.1:3000`，并放宽 SSE 相关 originRequest。

---

## 方案 C：Docker Compose 里挂 Tunnel

全栈容器已跑起来时：

```powershell
# .env 中已设置 CLOUDFLARE_TUNNEL_TOKEN 与 AUTH_*
docker compose --profile cloudflare up -d cloudflare
```

见根目录 `docker-compose.yml` 的 `cloudflare` 服务（`cloudflare/cloudflared` + `TUNNEL_TOKEN`）。

---

## 必开鉴权（公网安全）

| 变量 | 说明 |
|---|---|
| `AUTH_MODE=password` | 开启登录；请求带 `Authorization: Bearer …` |
| `AUTH_PASSWORD` | 登录密码 |
| `AUTH_TOKEN` | 可选；不设则 Token = 密码 |

`PUBLIC_URL` 已配置但 `AUTH_MODE` 仍为 `none` 时，`/settings` 会提示「建议开启鉴权」。**Agent 工具仍在你这台机器上执行**——Tunnel 只是门禁，不是沙箱；密码要够强，不要把链接发到公开群。

进阶：在 Zero Trust 再套一层 **Cloudflare Access**（邮箱 OTP / SSO），与应用密码可叠加。

---

## 手机使用要点

1. 只用 Tunnel 的 `https://…` 地址，不要指望家里局域网 IP 穿网。
2. 首次打开会要求登录（`AUTH_MODE=password`）。
3. 窄屏有底栏：首页 / 博客 / Chat / 更多；Chat 左栏为全屏叠层。
4. 浏览器菜单可「添加到主屏幕」（轻量 PWA，**不支持离线**）。
5. 状态与告警：桌面打开 `/settings` →「手机远程访问」卡片。

---

## 常用命令速查

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 本地 Web + Server |
| `pnpm dev:remote` | Web 绑 `0.0.0.0`（局域网/特殊网络） |
| `pnpm tunnel:quick` | 临时 `*.trycloudflare.com` |
| `pnpm tunnel:run` | 用 `.env` 的 `CLOUDFLARE_TUNNEL_TOKEN` |
| `pnpm tunnel:run:config` | 用 `cloudflare/config.yml` |

脚本实现：[`scripts/tunnel.ps1`](../../scripts/tunnel.ps1)。

---

## 排错

| 现象 | 处理 |
|---|---|
| 隧道起来了但页面空白 / CORS 报错 | `.env` 写上当前公网 URL 到 `PUBLIC_URL`，重启 `pnpm dev` |
| 能打开但 API 401 | 确认 `AUTH_MODE=password`，重新登录；清站点数据后再试 |
| Chat 流式卡住 | 确认只暴露 3000；勿把 3010 单独映射；命名隧道看 `config.example.yml` 的 originRequest |
| `未找到 cloudflared` | `winget install Cloudflare.cloudflared` |
| Token 模式失败 | Zero Trust 里确认 Tunnel 状态为 Healthy；Token 无多余空格/引号 |
| 临时链接隔天失效 | 正常；改用方案 B 固定域名 |

---

## 相关文件

- `.env.example` — `CLOUDFLARE_*` / `PUBLIC_URL` / `AUTH_*`
- `cloudflare/config.example.yml` — 命名隧道 ingress 示例
- `scripts/tunnel.ps1` — `quick` / `run`
- `docker-compose.yml` — `profile: cloudflare`
- 应用内：`/settings` — 远程与鉴权状态
