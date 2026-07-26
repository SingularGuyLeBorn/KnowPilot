/**
 * 全局代理初始化（国内环境访问国外 LLM / 站点）。
 *
 * Node 18+ 的全局 fetch 基于 undici，默认不读 HTTP_PROXY/HTTPS_PROXY 环境变量、
 * 也不走系统代理。这里在 server 启动最早处一次性 setGlobalDispatcher(ProxyAgent)，
 * 让所有 fetch（LLM 调用 / web_search / read_article / 免费_key 同步）都走代理。
 *
 * 优先级：KP_HTTPS_PROXY > HTTPS_PROXY > HTTP_PROXY > KP_HTTP_PROXY（与 curl/axios 习惯一致）。
 * 不设任何代理变量 → 不动 dispatcher，保持直连。
 *
 * 用法（.env）：
 *   HTTPS_PROXY=http://127.0.0.1:7890      # Clash / v2ray 本地混合端口
 *   # 或 KP_HTTPS_PROXY=http://127.0.0.1:7890  # KnowPilot 专用，避免污染其他工具
 */

import { setGlobalDispatcher, ProxyAgent, getGlobalDispatcher } from "undici";

let initialized = false;
let activeProxyUrl: string | null = null;

export function initGlobalProxy(): { proxyUrl: string | null } {
  if (initialized) return { proxyUrl: activeProxyUrl };
  initialized = true;

  const proxyUrl =
    process.env.KP_HTTPS_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.KP_HTTP_PROXY?.trim() ||
    "";

  if (!proxyUrl) {
    activeProxyUrl = null;
    return { proxyUrl: null };
  }

  try {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    activeProxyUrl = proxyUrl;
    console.log(`[Proxy] 全局代理已启用: ${proxyUrl}（所有 fetch 走代理）`);
  } catch (err) {
    console.warn(
      `[Proxy] 代理初始化失败（${proxyUrl}）: ${err instanceof Error ? err.message : String(err)}，回退直连`,
    );
    activeProxyUrl = null;
  }
  return { proxyUrl: activeProxyUrl };
}

/** 仅供测试复位 */
export function __resetProxyForTests(): void {
  initialized = false;
  activeProxyUrl = null;
  try {
    setGlobalDispatcher(getGlobalDispatcher());
  } catch {
    // 忽略
  }
}
