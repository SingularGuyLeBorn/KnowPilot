/**
 * Context-overflow 恢复：压缩一次后用原请求重试一次（仅一次）。
 * 接入点在 reactLoop transport.complete（W4 钩子链之后）。
 */

import { isContextOverflowError } from "./resilientLlmClient.js";

export async function completeWithOverflowCompact<T>(opts: {
  complete: () => Promise<T>;
  /** 触发一次压缩；返回是否实际压缩（未压缩也可重试一次） */
  compactOnce: () => Promise<{ didCompact: boolean }>;
}): Promise<T> {
  try {
    return await opts.complete();
  } catch (err) {
    if (!isContextOverflowError(err)) throw err;
    await opts.compactOnce();
    return await opts.complete();
  }
}
