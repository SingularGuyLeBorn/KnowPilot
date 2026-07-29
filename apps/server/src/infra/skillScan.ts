/**
 * Skill 安全扫描（DeerFlow SkillScan 启发）：装包/写入后确定性检查，拦高危模式。
 * 不依赖 Semgrep；只扫 scripts/ 与 SKILL.md 正文。
 */

import fs from "fs";
import path from "path";

export type SkillScanFinding = {
  severity: "critical" | "warning";
  path: string;
  rule: string;
  detail: string;
};

export type SkillScanReport = {
  ok: boolean;
  findings: SkillScanFinding[];
  scannedFiles: number;
};

const CRITICAL_PATTERNS: Array<{ re: RegExp; rule: string; detail: string }> = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, rule: "private_key", detail: "疑似私钥内容" },
  { re: /\bchild_process\b/, rule: "child_process", detail: "scripts 引用 child_process" },
  { re: /\b(?:execSync|spawnSync|execFileSync)\s*\(/, rule: "sync_exec", detail: "同步进程执行" },
  { re: /\beval\s*\(/, rule: "eval", detail: "使用 eval(" },
  { re: /\bnew\s+Function\s*\(/, rule: "new_function", detail: "使用 new Function(" },
  { re: /\bprocess\.env\.[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)/i, rule: "env_secret", detail: "读取敏感环境变量" },
];

const WARNING_PATTERNS: Array<{ re: RegExp; rule: string; detail: string }> = [
  { re: /\bfetch\s*\(/, rule: "fetch", detail: "网络 fetch（请确认必要性）" },
  { re: /\bhttps?:\/\//, rule: "url", detail: "含硬编码 URL" },
  { re: /\brm\s+-rf\b/, rule: "rm_rf", detail: "文档/脚本含 rm -rf" },
];

const BLOCKED_EXT = new Set([".exe", ".dll", ".bat", ".cmd", ".ps1", ".msi", ".scr"]);

function scanText(rel: string, text: string, findings: SkillScanFinding[]): void {
  for (const p of CRITICAL_PATTERNS) {
    if (p.re.test(text)) {
      findings.push({ severity: "critical", path: rel, rule: p.rule, detail: p.detail });
    }
  }
  for (const p of WARNING_PATTERNS) {
    if (p.re.test(text)) {
      findings.push({ severity: "warning", path: rel, rule: p.rule, detail: p.detail });
    }
  }
}

/** 扫描 procedural 包目录或单个 .md 文件 */
export function scanSkillPackage(targetAbs: string): SkillScanReport {
  const findings: SkillScanFinding[] = [];
  let scannedFiles = 0;

  if (!fs.existsSync(targetAbs)) {
    return { ok: false, findings: [{ severity: "critical", path: targetAbs, rule: "missing", detail: "路径不存在" }], scannedFiles: 0 };
  }

  const stat = fs.statSync(targetAbs);
  const files: string[] = [];

  if (stat.isFile()) {
    files.push(targetAbs);
  } else if (stat.isDirectory()) {
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        if (name === ".archive" || name === "node_modules") continue;
        const abs = path.join(dir, name);
        const st = fs.statSync(abs);
        if (st.isDirectory()) walk(abs);
        else files.push(abs);
      }
    };
    walk(targetAbs);
  }

  const root = stat.isDirectory() ? targetAbs : path.dirname(targetAbs);

  for (const abs of files) {
    const rel = path.relative(root, abs).replace(/\\/g, "/");
    const ext = path.extname(abs).toLowerCase();
    if (BLOCKED_EXT.has(ext)) {
      findings.push({
        severity: "critical",
        path: rel,
        rule: "blocked_ext",
        detail: `禁止的二进制/脚本扩展名 ${ext}`,
      });
      scannedFiles += 1;
      continue;
    }
    // 只扫文本类
    if (!/\.(md|js|mjs|cjs|ts|tsx|py|sh|json|ya?ml|txt)$/i.test(abs) && !rel.endsWith("SKILL.md")) {
      continue;
    }
    let text = "";
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    scannedFiles += 1;
    // scripts/ 下 critical 全开；其余文件只扫私钥类
    if (rel.startsWith("scripts/") || rel.includes("/scripts/")) {
      scanText(rel, text, findings);
    } else {
      for (const p of CRITICAL_PATTERNS.filter((x) => x.rule === "private_key" || x.rule === "env_secret")) {
        if (p.re.test(text)) {
          findings.push({ severity: "critical", path: rel, rule: p.rule, detail: p.detail });
        }
      }
    }
  }

  const hasCritical = findings.some((f) => f.severity === "critical");
  return { ok: !hasCritical, findings, scannedFiles };
}
