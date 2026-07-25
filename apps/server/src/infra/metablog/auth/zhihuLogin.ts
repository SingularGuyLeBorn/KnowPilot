/**
 * 知乎登录态获取：委托给泛化的 capturePlatformLoginState（保持向后兼容）。
 * 原实现已泛化为多平台版本，见 platformLogin.ts。
 */

import { capturePlatformLoginState, type PlatformLoginResult } from "./platformLogin.js";

export interface LoginResult {
  success: boolean;
  message: string;
  authPath: string;
  fileSize: number;
  cookieCount?: number;
}

export async function captureZhihuLoginState(timeoutSec: number = 120): Promise<LoginResult> {
  const r: PlatformLoginResult = await capturePlatformLoginState("zhihu", timeoutSec);
  return {
    success: r.success,
    message: r.message,
    authPath: r.authPath,
    fileSize: r.fileSize,
    cookieCount: r.cookieCount,
  };
}
