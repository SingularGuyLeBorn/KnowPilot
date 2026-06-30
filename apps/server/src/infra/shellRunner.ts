/**
 * 受限 Shell 执行 — 主机模式，项目根目录内、超时与输出上限、危险命令拦截
 *
 * 沙箱方案：host_restricted（用户选定，2026-06-28）
 * - Skill 代码沙箱仍使用 node:vm（见 skillRunner.ts），与此模块无关
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import type { AppConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export type ShellMode = "disabled" | "host_restricted" | "host_full" | "docker";

/** 明显危险的命令片段（大小写不敏感） */
const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+(-[^\s]*\s+)*-rf?\s+(\/|\\|~\s|\*\s)/i,
  /\bdel\s+\/([sfq]|.*\s+[sfq])/i,
  /\bformat\s+[a-z]:/i,
  /\b(shutdown|reboot|poweroff|halt)\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/[a-z]/i,
  /\bchmod\s+(-[^\s]*\s+)*777\s+\//i,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*(C:\\|\\\\)/i,
  /\breg\s+delete\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bcurl[^\n|]*\|\s*(ba)?sh\b/i,
  /\bwget[^\n|]*\|\s*(ba)?sh\b/i,
];

export function assertShellEnabled(config: AppConfig): void {
  if (config.shell.mode === "disabled" || !config.shell.enabled) {
    throw new Error("Shell 工具未启用。请在 .env 设置 SHELL_ENABLED=true 且 SHELL_MODE=host_restricted");
  }
  if (config.shell.mode === "docker") {
    throw new Error("SHELL_MODE=docker 尚未实现，请使用 host_restricted");
  }
  if (config.shell.mode === "host_full") {
    throw new Error("SHELL_MODE=host_full 尚未开放，请使用 host_restricted");
  }
}

export function validateShellCommand(command: string): void {
  const trimmed = command.trim();
  if (!trimmed) throw new Error("command 不能为空");
  if (trimmed.length > 8000) throw new Error("command 过长（上限 8000 字符）");
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(`命令被安全策略拒绝：匹配危险模式 ${pattern.source.slice(0, 40)}…`);
    }
  }
}

export function resolveShellCwd(config: AppConfig, cwdArg?: string): string {
  const rel = (cwdArg || ".").replace(/\\/g, "/").replace(/^\/+/, "");
  if (rel.includes("..")) throw new Error("cwd 不允许包含 ..");
  const abs = path.resolve(config.projectRoot, rel);
  const root = path.resolve(config.projectRoot);
  if (!abs.startsWith(root)) throw new Error("cwd 超出项目根目录范围");
  return abs;
}

function resolveShellExecutable(config: AppConfig, shell?: string): { file: string; argsPrefix: string[] } {
  const prefer = shell || config.shell.shell || "auto";
  const isWin = process.platform === "win32";

  if (prefer === "bash") {
    return { file: "bash", argsPrefix: ["-lc"] };
  }
  if (prefer === "cmd") {
    return isWin
      ? { file: "cmd.exe", argsPrefix: ["/d", "/s", "/c"] }
      : { file: "sh", argsPrefix: ["-c"] };
  }
  if (prefer === "powershell") {
    return isWin
      ? { file: "powershell.exe", argsPrefix: ["-NoProfile", "-NonInteractive", "-Command"] }
      : { file: "sh", argsPrefix: ["-c"] };
  }

  if (isWin) {
    return { file: "powershell.exe", argsPrefix: ["-NoProfile", "-NonInteractive", "-Command"] };
  }
  return { file: "bash", argsPrefix: ["-lc"] };
}

export interface ShellRunResult {
  command: string;
  cwd: string;
  shell: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

export async function runShellRestricted(
  config: AppConfig,
  command: string,
  opts?: { cwd?: string; shell?: string },
): Promise<ShellRunResult> {
  assertShellEnabled(config);
  validateShellCommand(command);

  const cwd = resolveShellCwd(config, opts?.cwd);
  const { file, argsPrefix } = resolveShellExecutable(config, opts?.shell);
  const args = [...argsPrefix, command];
  const maxBuffer = config.shell.maxOutputChars * 4;
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd,
      timeout: config.shell.timeoutMs,
      maxBuffer,
      windowsHide: true,
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1",
      },
    });
    const out = (stdout || "").slice(0, config.shell.maxOutputChars);
    const err = (stderr || "").slice(0, config.shell.maxOutputChars);
    const combinedLen = (stdout || "").length + (stderr || "").length;
    return {
      command,
      cwd,
      shell: file,
      exitCode: 0,
      stdout: out,
      stderr: err,
      truncated: combinedLen > config.shell.maxOutputChars,
      durationMs: Date.now() - start,
    };
  } catch (e: unknown) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    if (err.killed || err.signal === "SIGTERM") {
      throw new Error(`命令执行超时（${config.shell.timeoutMs}ms）`);
    }
    const stdout = (err.stdout || "").slice(0, config.shell.maxOutputChars);
    const stderr = (err.stderr || "").slice(0, config.shell.maxOutputChars);
    const exitCode = typeof err.code === "number" ? err.code : 1;
    return {
      command,
      cwd,
      shell: file,
      exitCode,
      stdout,
      stderr: stderr || (e instanceof Error ? e.message : String(e)),
      truncated: false,
      durationMs: Date.now() - start,
    };
  }
}

export async function waitMs(ms: number): Promise<{ waitedMs: number }> {
  const clamped = Math.max(0, Math.min(ms, 300_000));
  await new Promise((r) => setTimeout(r, clamped));
  return { waitedMs: clamped };
}
