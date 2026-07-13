/**
 * Native 域工具注册入口（PR-4a：fs / web / shell）
 * 由 nativeTools.ensureNativeToolsRegistered 调用；测试清空 registry 后可再次灌入。
 */
import { registerFsTools } from "./fs.js";
import { registerWebTools } from "./web.js";
import { registerShellTools } from "./shell.js";

export function registerNativeDomains(): void {
  registerFsTools();
  registerWebTools();
  registerShellTools();
}

export type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
export { coerceToolBoolean } from "./types.js";
export {
  syncSearchEnvFromConfig,
  isUnreadableArticlePage,
  readArticleContentWarning,
} from "./web.js";
