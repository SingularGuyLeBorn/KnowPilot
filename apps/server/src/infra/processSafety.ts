/**
 * 进程级安全网 —— 兜住漏网的微任务 / Worker nextTick 未捕获异常，避免整站被打死。
 *
 * 与引擎隔离（Tesseract 子进程等）叠加：隔离堵已知洞，本模块堵未知漏网。
 * 策略：记录 + 继续（本地单用户优先可用性）；不在这里 process.exit。
 */

let installed = false;

/** 识别已知「可吞」原生/第三方噪声，避免刷屏；其余仍 warn */
function isBenignNoise(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg.includes("Error attempting to read image") ||
    msg.includes("pixReadStream") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE")
  );
}

export function installProcessSafetyHandlers(): void {
  if (installed) return;
  installed = true;

  process.on("unhandledRejection", (reason) => {
    const label = reason instanceof Error ? reason.stack || reason.message : String(reason);
    if (isBenignNoise(reason)) {
      console.warn("[processSafety] unhandledRejection (benign):", label.slice(0, 300));
      return;
    }
    console.error("[processSafety] unhandledRejection（已吞，服务继续）:\n", label);
  });

  process.on("uncaughtException", (err, origin) => {
    // 同步异常里若直接再抛会二次崩；只记日志。
    if (isBenignNoise(err)) {
      console.warn(
        `[processSafety] uncaughtException/${origin} (benign):`,
        err.message?.slice(0, 300),
      );
      return;
    }
    console.error(
      `[processSafety] uncaughtException/${origin}（已吞，服务继续）:`,
      err.stack || err.message,
    );
  });
}

/** 仅测试重置 */
export function __resetProcessSafetyForTests(): void {
  installed = false;
}
