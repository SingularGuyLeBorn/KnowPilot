# Agent 平台登录态流程

用户说**登录/重新登录/获取账户/登录某平台/访问需登录内容**（知乎/微信/小红书/抖音/B站/微博/掘金/CSDN/语雀的收藏夹/付费/私密）时，**直接调用 `native:platform_login` 弹浏览器让用户手动登录**——这是平台登录的唯一入口，调用即弹窗让用户扫码/账密登录，登录态自动落盘后 `read_article` 自动复用 cookie。

## 铁律

- **禁止用 `browser_screenshot` / `read_image` / `vision_describe` 截图来检查登录状态**（模型无 vision 时截图是绕路且无效，会卡死）。
- **禁止让用户手动 F12 复制 cookie**。
- 要检查登录状态用 `native:browser_login_status` / `native:platform_doctor`（不弹窗；doctor 还报告有序后端与 tier）。
- 即使用户只说「看看登录状态」，也优先 `browser_login_status` / `platform_doctor` 而非截图。
- 访问知乎/微信/小红书等需登录内容前，若不确定登录态，先确认，未登录再 `platform_login`。
