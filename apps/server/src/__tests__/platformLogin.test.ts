import { describe, expect, it } from "vitest";
import {
  PLATFORM_LOGIN_CONFIGS,
  collectNamedCookieMap,
  detectLoginCookieSignal,
  hasRequiredAuthCookies,
  isXhsAuthChallengeUrl,
  platformHasRealLoginCookies,
  textLooksLikeXhsLoginPending,
  type PlatformLoginConfig,
} from "../infra/metablog/auth/platformLogin.js";
import type { CookiePlatform } from "../infra/cookieJar.js";

/** 已知会误判的访客/设备 cookie —— 绝不能出现在 authCookieNames */
const FORBIDDEN_AUTH_COOKIES: Record<CookiePlatform, string[]> = {
  zhihu: ["d_c0"],
  wechat: [],
  xhs: ["web_session", "a1", "webId", "xsecappid"],
  douyin: ["ttwid", "__ac_nonce", "bd_ticket_guard_client_data"],
  bilibili: ["buvid3", "b_nut", "buvid4"],
  weibo: ["SINAGLOBAL", "UOR", "ULV"],
  juejin: ["__tea_cache_tokens_10006", "__tea_sdk_ab_version_10006"],
  csdn: ["uuid"],
  yuque: ["session_id"],
};

describe("platformLogin cookie rules (all platforms)", () => {
  it("九平台均配置身份 API 复核（或 requireAllAuth 强认证 cookie）", () => {
    for (const cfg of Object.values(PLATFORM_LOGIN_CONFIGS)) {
      expect(
        Boolean(cfg.verifyLogin) || Boolean(cfg.requireAllAuth),
        `${cfg.platform} 缺少 verifyLogin/requireAllAuth`,
      ).toBe(true);
    }
  });

  it("使用 sessionCookieNames 的平台必须有 verifyLogin", () => {
    for (const cfg of Object.values(PLATFORM_LOGIN_CONFIGS)) {
      if ((cfg.sessionCookieNames?.length ?? 0) > 0) {
        expect(cfg.verifyLogin, `${cfg.platform} session 触发器无 verify`).toBeTypeOf("function");
      }
    }
  });

  it("authCookieNames 不含各平台已知访客/设备 cookie", () => {
    for (const [platform, forbidden] of Object.entries(FORBIDDEN_AUTH_COOKIES) as Array<
      [CookiePlatform, string[]]
    >) {
      const auth = PLATFORM_LOGIN_CONFIGS[platform].authCookieNames;
      for (const name of forbidden) {
        expect(auth, `${platform} auth 含禁用 cookie ${name}`).not.toContain(name);
      }
    }
  });

  it("xhs：web_session 只在 sessionCookieNames，不在 auth；登录页用 explore", () => {
    const cfg = PLATFORM_LOGIN_CONFIGS.xhs;
    expect(cfg.authCookieNames).not.toContain("web_session");
    expect(cfg.sessionCookieNames).toContain("web_session");
    expect(cfg.loginUrl).toContain("xiaohongshu.com");
    expect(cfg.verifyLogin).toBeTypeOf("function");
  });

  it("zhihu 只认 z_c0", () => {
    expect(PLATFORM_LOGIN_CONFIGS.zhihu.authCookieNames).toEqual(["z_c0"]);
  });

  it("bilibili 只认 SESSDATA（不认单独 DedeUserID/buvid）", () => {
    expect(PLATFORM_LOGIN_CONFIGS.bilibili.authCookieNames).toEqual(["SESSDATA"]);
  });

  it("douyin / csdn requireAllAuth", () => {
    expect(PLATFORM_LOGIN_CONFIGS.douyin.requireAllAuth).toBe(true);
    expect(PLATFORM_LOGIN_CONFIGS.csdn.requireAllAuth).toBe(true);
  });
});

describe("detectLoginCookieSignal", () => {
  const xhs = PLATFORM_LOGIN_CONFIGS.xhs;

  it("首屏就有 web_session、值未变 → 无信号（不会秒关窗）", () => {
    const baseline = new Map([["web_session", "guest-aaa"]]);
    const signal = detectLoginCookieSignal(
      [{ name: "web_session", value: "guest-aaa" }, { name: "a1", value: "dev" }],
      baseline,
      xhs,
    );
    expect(signal.hit).toBe(false);
  });

  it("web_session 值变化 → 有信号（仍须 API 复核才落盘）", () => {
    const baseline = new Map([["web_session", "guest-aaa"]]);
    const signal = detectLoginCookieSignal(
      [{ name: "web_session", value: "logged-bbb" }],
      baseline,
      xhs,
    );
    expect(signal.hit).toBe(true);
    expect(signal.reason).toBe("session_change");
  });

  it("知乎仅有 d_c0 无 z_c0 → 无信号", () => {
    const cfg = PLATFORM_LOGIN_CONFIGS.zhihu;
    const baseline = collectNamedCookieMap([{ name: "d_c0", value: "device" }], cfg.authCookieNames);
    const signal = detectLoginCookieSignal(
      [
        { name: "d_c0", value: "device" },
        { name: "q_c1", value: "x" },
      ],
      baseline,
      cfg,
    );
    expect(signal.hit).toBe(false);
  });

  it("知乎 z_c0 新出现 → 有信号", () => {
    const cfg = PLATFORM_LOGIN_CONFIGS.zhihu;
    const baseline = new Map<string, string>();
    const signal = detectLoginCookieSignal([{ name: "z_c0", value: "token" }], baseline, cfg);
    expect(signal.hit).toBe(true);
    expect(signal.hitCookie).toBe("z_c0");
  });

  it("douyin requireAll：只有 sessionid 不够", () => {
    const cfg = PLATFORM_LOGIN_CONFIGS.douyin;
    const baseline = new Map<string, string>();
    const signal = detectLoginCookieSignal([{ name: "sessionid", value: "abc1234567890123" }], baseline, cfg);
    expect(signal.hit).toBe(false);
  });

  it("douyin requireAll：sessionid+sessionid_ss 齐且变化 → 有信号", () => {
    const cfg = PLATFORM_LOGIN_CONFIGS.douyin;
    const baseline = new Map<string, string>();
    const signal = detectLoginCookieSignal(
      [
        { name: "sessionid", value: "abc1234567890123" },
        { name: "sessionid_ss", value: "def1234567890123" },
      ],
      baseline,
      cfg,
    );
    expect(signal.hit).toBe(true);
    expect(signal.reason).toBe("auth_all");
  });
});

describe("hasRequiredAuthCookies", () => {
  it("csdn 需要 UserName+UserToken", () => {
    const cfg = PLATFORM_LOGIN_CONFIGS.csdn;
    expect(hasRequiredAuthCookies([{ name: "UserName", value: "u" }], cfg).ok).toBe(false);
    expect(
      hasRequiredAuthCookies(
        [
          { name: "UserName", value: "u" },
          { name: "UserToken", value: "tok" },
        ],
        cfg,
      ).ok,
    ).toBe(true);
  });

  it("xhs 仅 web_session 不算已登录（离线判定）", () => {
    const cfg = PLATFORM_LOGIN_CONFIGS.xhs;
    expect(hasRequiredAuthCookies([{ name: "web_session", value: "guest" }], cfg).ok).toBe(false);
  });
});

describe("isXhsAuthChallengeUrl", () => {
  it("登录页 / 安全验证 / verifyUuid 视为门禁", () => {
    expect(isXhsAuthChallengeUrl("https://www.xiaohongshu.com/login?redirectPath=/explore")).toBe(
      true,
    );
    expect(
      isXhsAuthChallengeUrl(
        "https://www.xiaohongshu.com/website-login/captcha?verifyUuid=a2cf5ff3-8af1",
      ),
    ).toBe(true);
    expect(isXhsAuthChallengeUrl("https://www.xiaohongshu.com/?verifyUuid=xxx")).toBe(true);
  });

  it("explore / 用户页不是门禁", () => {
    expect(isXhsAuthChallengeUrl("https://www.xiaohongshu.com/explore")).toBe(false);
    expect(isXhsAuthChallengeUrl("https://www.xiaohongshu.com/user/profile/abc")).toBe(false);
  });
});

describe("textLooksLikeXhsLoginPending", () => {
  it("扫码成功未确认 / 安全验证文案视为未完成", () => {
    expect(textLooksLikeXhsLoginPending("扫码成功，请在手机上确认登录")).toBe(true);
    expect(textLooksLikeXhsLoginPending("Security Verification")).toBe(true);
    expect(textLooksLikeXhsLoginPending("已扫码，等待确认")).toBe(true);
  });

  it("探索页推荐流常见词不算 pending（防误判已登录主页）", () => {
    expect(textLooksLikeXhsLoginPending("发现\n关注\n西安美食推荐")).toBe(false);
    expect(textLooksLikeXhsLoginPending("打开 App 扫一扫看更多")).toBe(false);
  });
});

describe("platformHasRealLoginCookies smoke", () => {
  it("xhs 离线判定：auth cookie 或 (强信号 loginMeta+web_session)；弱 meta 不认", () => {
    const r = platformHasRealLoginCookies("xhs");
    if (!r.loggedIn) {
      // 允许空；若本机只有历史弱 meta（dom_profile/web_session_change）必须报未登录
      return;
    }
    const allowed = new Set([
      "customer-sso-sid",
      "galaxy_creator_session_id",
      "web_session",
      "dom_me",
    ]);
    for (const name of r.hitCookies) {
      expect(allowed.has(name)).toBe(true);
    }
    expect(r.hitCookies).not.toContain("dom_profile");
    expect(r.hitCookies).not.toContain("web_session_change");
    expect(r.hitCookies).not.toContain("me_api");
  });

  it("配置自检：每个平台 authCookieNames 非空", () => {
    for (const cfg of Object.values(PLATFORM_LOGIN_CONFIGS) as PlatformLoginConfig[]) {
      expect(cfg.authCookieNames.length).toBeGreaterThan(0);
    }
  });
});
