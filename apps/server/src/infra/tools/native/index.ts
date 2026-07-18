/**
 * Native 域工具注册入口
 * PR-4a：fs / web / shell；PR-4b：swarm / session / memory；PR-4c：integration。
 * 由 nativeTools.ensureNativeToolsRegistered 调用；测试清空 registry 后可再次灌入。
 */
import { registerFsTools } from "./fs.js";
import { registerWebTools } from "./web.js";
import { registerShellTools } from "./shell.js";
import { registerSwarmTools } from "./swarm.js";
import { registerSessionTools } from "./session.js";
import { registerMemoryTools } from "./memory.js";
import { registerIntegrationTools } from "./integration.js";
import { registerNotifyTools } from "./notify.js";
import { registerSkillsTools } from "./skills.js";

export function registerNativeDomains(): void {
  registerFsTools();
  registerWebTools();
  registerShellTools();
  registerSwarmTools();
  registerSessionTools();
  registerMemoryTools();
  registerIntegrationTools();
  registerNotifyTools();
  registerSkillsTools();
}

export type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
export { coerceToolBoolean } from "./types.js";
export {
  syncSearchEnvFromConfig,
  isUnreadableArticlePage,
  readArticleContentWarning,
} from "./web.js";
