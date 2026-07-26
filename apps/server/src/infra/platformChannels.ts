/**
 * 平台能力通道登记（学 AgentReach 精华，弃其 CLI 胶水糟粕）
 *
 * - Tier 分层：装好即用 / 需登录或 Key / 重配置
 * - 有序 backends：优先官方/稳定，失败再降级（不装一堆 CLI）
 * - doctor：真探测本地态；可选 liveProbe 打轻量 HTTP（默认关，非交互）
 *
 * 不引入 AgentReach / OpenCLI / 万能 scrape 后门。
 */

import type { PrismaClient } from "@prisma/client";
import { loadCookies, type CookiePlatform } from "./cookieJar.js";
import {
  listPlatformLoginStatus,
  platformHasRealLoginCookies,
} from "./metablog/auth/platformLogin.js";
import { resolveZhihuAccessSecret } from "./zhihuOpenApi.js";

/** 0=免登录即用；1=需登录或 API Key；2=重配置/不稳定 */
export type PlatformCapabilityTier = 0 | 1 | 2;

export interface PlatformChannelDef {
  id: string;
  label: string;
  tier: PlatformCapabilityTier;
  /** 有序后端：下标 0 = 首选 */
  backends: string[];
  purpose: "inbox_sync" | "read_public" | "search";
  fixHint: string;
}

export const PLATFORM_CHANNELS: PlatformChannelDef[] = [
  {
    id: "zhihu_collections",
    label: "知乎收藏夹",
    tier: 1,
    backends: ["zhihu_openapi", "cookie_api", "playwright"],
    purpose: "inbox_sync",
    fixHint: "优先配 ZHIHU_ACCESS_SECRET；否则 platform_login(zhihu)",
  },
  {
    id: "xhs_library",
    label: "小红书点赞+收藏",
    tier: 1,
    backends: ["storage_state_playwright"],
    purpose: "inbox_sync",
    fixHint: "platform_login(xhs)：扫码后手机点确认，侧栏出现「我」",
  },
  {
    id: "bilibili_library",
    label: "B站收藏+稍后再看",
    tier: 1,
    backends: ["cookie_api"],
    purpose: "inbox_sync",
    fixHint: "platform_login(bilibili)，需 SESSDATA",
  },
  {
    id: "wechat_links",
    label: "微信 links.txt",
    tier: 0,
    backends: ["file_drop"],
    purpose: "inbox_sync",
    fixHint: "把链接写入 data/inbox/wechat/links.txt 后同步",
  },
  {
    id: "screenshot_drop",
    label: "截图 drop",
    tier: 0,
    backends: ["ocr_watch_dir"],
    purpose: "inbox_sync",
    fixHint: "图片放入 data/inbox/screenshots/drop",
  },
  {
    id: "read_article",
    label: "读公开/登录后文章",
    tier: 1,
    backends: ["http_fetcher", "playwright_storage_state", "tikhub_optional"],
    purpose: "read_public",
    fixHint: "公开页直接 read_article；需登录先 browser_login_status → platform_login",
  },
  {
    id: "web_search",
    label: "全网搜索",
    tier: 0,
    backends: ["search_router"],
    purpose: "search",
    fixHint: "web_search；无 Key 时走爬虫引擎降级",
  },
];

export interface ChannelDoctorRow {
  id: string;
  label: string;
  tier: PlatformCapabilityTier;
  backends: string[];
  activeBackend: string | null;
  status: "ok" | "needs_config" | "error";
  message: string;
  fixHint: string;
  liveProbed?: boolean;
}

function cookiesToHeader(platform: CookiePlatform): string {
  return loadCookies(platform)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/** 轻量 HTTP 探测：知乎 /api/v4/me（不弹浏览器） */
async function liveProbeZhihuCookie(): Promise<{ ok: boolean; message: string }> {
  const header = cookiesToHeader("zhihu");
  if (!header) return { ok: false, message: "无知乎 cookie" };
  try {
    const res = await fetch("https://www.zhihu.com/api/v4/me", {
      headers: {
        Cookie: header,
        Accept: "application/json",
        Referer: "https://www.zhihu.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, message: `知乎 /me HTTP ${res.status}（cookie 可能过期）` };
    const data = (await res.json()) as { id?: unknown; name?: unknown };
    if (data.id != null || typeof data.name === "string") {
      return { ok: true, message: "知乎 cookie 在线有效" };
    }
    return { ok: false, message: "知乎 /me 无身份字段" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function liveProbeBilibiliCookie(): Promise<{ ok: boolean; message: string }> {
  const header = cookiesToHeader("bilibili");
  if (!header.includes("SESSDATA")) return { ok: false, message: "无 SESSDATA" };
  try {
    const res = await fetch("https://api.bilibili.com/x/web-interface/nav", {
      headers: {
        Cookie: header,
        Referer: "https://www.bilibili.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, message: `B站 nav HTTP ${res.status}` };
    const data = (await res.json()) as { code?: number; data?: { isLogin?: boolean } };
    if (data.code === 0 && data.data?.isLogin) {
      return { ok: true, message: "B站 SESSDATA 在线有效" };
    }
    return { ok: false, message: `B站未登录 code=${data.code}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 体检：默认只查本地态（非交互）；liveProbe=true 时对知乎/B站打轻量 HTTP。
 */
export async function doctorPlatformChannels(
  prisma: PrismaClient,
  opts: { liveProbe?: boolean } = {},
): Promise<{
  channels: ChannelDoctorRow[];
  login: ReturnType<typeof listPlatformLoginStatus>;
  hint: string;
}> {
  const live = opts.liveProbe === true;
  const login = listPlatformLoginStatus();
  const loginBy = Object.fromEntries(login.map((d) => [d.platform, d]));

  const openApiSecret = await resolveZhihuAccessSecret(prisma).catch(() => null);

  const channels: ChannelDoctorRow[] = [];

  for (const ch of PLATFORM_CHANNELS) {
    if (ch.id === "zhihu_collections") {
      if (openApiSecret) {
        channels.push({
          id: ch.id,
          label: ch.label,
          tier: ch.tier,
          backends: ch.backends,
          activeBackend: "zhihu_openapi",
          status: "ok",
          message: "开放平台 Access Secret 已配置（同步首选）",
          fixHint: ch.fixHint,
        });
      } else if (loginBy.zhihu?.loggedIn) {
        let message = "开放平台未配；本地知乎登录态可用 → cookie_api";
        let status: ChannelDoctorRow["status"] = "ok";
        let liveProbed = false;
        if (live) {
          const probe = await liveProbeZhihuCookie();
          liveProbed = true;
          if (!probe.ok) {
            status = "needs_config";
            message = `本地有登录文件但在线探测失败：${probe.message}`;
          } else {
            message = probe.message;
          }
        }
        channels.push({
          id: ch.id,
          label: ch.label,
          tier: ch.tier,
          backends: ch.backends,
          activeBackend: status === "ok" ? "cookie_api" : null,
          status,
          message,
          fixHint: ch.fixHint,
          liveProbed,
        });
      } else {
        channels.push({
          id: ch.id,
          label: ch.label,
          tier: ch.tier,
          backends: ch.backends,
          activeBackend: null,
          status: "needs_config",
          message: "无开放平台 Key，且未 platform_login(zhihu)",
          fixHint: ch.fixHint,
        });
      }
      continue;
    }

    if (ch.id === "xhs_library") {
      const ok = loginBy.xhs?.loggedIn === true;
      channels.push({
        id: ch.id,
        label: ch.label,
        tier: ch.tier,
        backends: ch.backends,
        activeBackend: ok ? "storage_state_playwright" : null,
        status: ok ? "ok" : "needs_config",
        message: ok
          ? "小红书本地登录态有效（离线 cookie/身份标记）"
          : "未登录小红书",
        fixHint: ch.fixHint,
      });
      continue;
    }

    if (ch.id === "bilibili_library") {
      const localOk = loginBy.bilibili?.loggedIn === true || platformHasRealLoginCookies("bilibili").loggedIn;
      let status: ChannelDoctorRow["status"] = localOk ? "ok" : "needs_config";
      let message = localOk ? "B站本地 SESSDATA 存在" : "未登录 B站";
      let liveProbed = false;
      if (live && localOk) {
        const probe = await liveProbeBilibiliCookie();
        liveProbed = true;
        if (!probe.ok) {
          status = "needs_config";
          message = `本地有 SESSDATA 但在线探测失败：${probe.message}`;
        } else {
          message = probe.message;
        }
      }
      channels.push({
        id: ch.id,
        label: ch.label,
        tier: ch.tier,
        backends: ch.backends,
        activeBackend: status === "ok" ? "cookie_api" : null,
        status,
        message,
        fixHint: ch.fixHint,
        liveProbed,
      });
      continue;
    }

    if (ch.id === "wechat_links" || ch.id === "screenshot_drop" || ch.id === "web_search") {
      channels.push({
        id: ch.id,
        label: ch.label,
        tier: ch.tier,
        backends: ch.backends,
        activeBackend: ch.backends[0] ?? null,
        status: "ok",
        message: "Tier 0：无需登录",
        fixHint: ch.fixHint,
      });
      continue;
    }

    if (ch.id === "read_article") {
      const anyLogin = login.some((d) => d.loggedIn);
      channels.push({
        id: ch.id,
        label: ch.label,
        tier: ch.tier,
        backends: ch.backends,
        activeBackend: anyLogin ? "playwright_storage_state" : "http_fetcher",
        status: "ok",
        message: anyLogin
          ? `已登录平台：${login.filter((d) => d.loggedIn).map((d) => d.platform).join(",")}；公开页仍走 http`
          : "未登录亦可读公开页；私密内容需 platform_login",
        fixHint: ch.fixHint,
      });
    }
  }

  return {
    channels,
    login,
    hint:
      "tier 0=免登录 · 1=需登录/Key · 2=重配置。" +
      "activeBackend 为当前可用首选；backends 为有序降级链。" +
      "默认不打在线探测（非交互）；传 liveProbe=true 才对知乎/B站做轻量 HTTP 校验。" +
      "不要整包接入 AgentReach CLI——本 doctor 已覆盖 Inbox/登录通道。",
  };
}
