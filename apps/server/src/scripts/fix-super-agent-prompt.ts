/**
 * 一次性脚本：给现有 super/manager tier Agent 的 systemPrompt 追加「平台登录态」指引段落。
 *
 * 根因：super.md/manager.md 模板早期不含 platform_login 指引，已创建的超级 Agent 的 systemPrompt
 * 固化了旧版本（无 platform_login 铁律），导致超级 Agent 遇到登录墙时用 browser_screenshot 截图
 * 而不是 platform_login 弹浏览器登录。resolveAgent 只读化（W9）不自动修补 systemPrompt。
 * 本脚本运行后可删（数据迁移走一次性脚本，不留代码分支）。
 *
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/fix-super-agent-prompt.ts
 */
import { prisma } from "../db.js";

const PLATFORM_LOGIN_SECTION = `
## 平台登录态（铁律）
用户说**登录/重新登录/获取账户/登录某平台/访问需登录内容**（知乎/微信/小红书/抖音/B站/微博/掘金/CSDN/语雀的收藏夹/付费/私密）时，**直接调用 native:platform_login 弹浏览器让用户手动登录**——这是平台登录的唯一入口，调用即弹窗让用户扫码/账密登录，登录态自动落盘后 read_article 自动复用 cookie。
- **禁止用 browser_screenshot/read_image/vision_describe 截图来检查登录状态**（模型无 vision 时截图是绕路且无效，会卡死）
- **禁止让用户手动 F12 复制 cookie**
- 要检查登录状态用 native:browser_login_status（返各平台 storageState 大小 + cookie 条数，不弹窗）
- 即使用户只说「看看登录状态」，也优先 browser_login_status 而非截图
- 访问知乎/微信/小红书等需登录内容前，若不确定登录态，先 browser_login_status 确认，未登录再 platform_login`;

async function main() {
  const agents = await prisma.agent.findMany({
    where: { tier: { in: ["super", "manager"] } },
    select: { id: true, name: true, tier: true, systemPrompt: true },
  });
  console.log(`找到 ${agents.length} 个 super/manager Agent`);

  let updated = 0;
  for (const agent of agents) {
    const current = agent.systemPrompt || "";
    if (current.includes("platform_login")) {
      console.log(`  - ${agent.name} (${agent.tier}) 已含 platform_login 指引，跳过`);
      continue;
    }
    const next = current.trimEnd() + "\n\n" + PLATFORM_LOGIN_SECTION;
    await prisma.agent.update({ where: { id: agent.id }, data: { systemPrompt: next } });
    updated++;
    console.log(`  ✓ ${agent.name} (${agent.tier}) 追加平台登录态指引`);
  }
  console.log(`完成：${updated}/${agents.length} 个 Agent 已追加 platform_login 指引`);
}

main()
  .catch((err) => {
    console.error("脚本失败:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
