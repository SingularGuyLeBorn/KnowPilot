/**
 * 将 5 段 cron 转成简短中文描述（心跳频率用）。
 * 覆盖常见预设与「每天 N 点」等自定义；无法解析则回退原文。
 */

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseIntField(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 描述单段 cron，供 UI「当前：…」与自定义下拉使用 */
export function describeCron(cron: string | undefined | null): string {
  if (!cron?.trim()) return "未设置";
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;

  const [min, hour, dom, mon, dow] = parts;

  // */N * * * * → 每 N 分钟
  if (min?.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    const n = parseIntField(min.slice(2));
    if (n && n > 0) return `每 ${n} 分钟`;
  }

  // 0 */N * * * → 每 N 小时
  if (min === "0" && hour?.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    const n = parseIntField(hour.slice(2));
    if (n && n > 0) return `每 ${n} 小时`;
  }

  // 0 H * * * → 每天 H:00
  if (min === "0" && dom === "*" && mon === "*" && dow === "*") {
    const h = parseIntField(hour ?? "");
    if (h !== null && h >= 0 && h <= 23) return `每天 ${h}:00`;
  }

  // M H * * * → 每天 H:MM
  if (dom === "*" && mon === "*" && dow === "*") {
    const m = parseIntField(min ?? "");
    const h = parseIntField(hour ?? "");
    if (m !== null && h !== null && m >= 0 && m <= 59 && h >= 0 && h <= 23) {
      return `每天 ${h}:${pad2(m)}`;
    }
  }

  // 0 H * * D → 每周X H:00
  if (min === "0" && dom === "*" && mon === "*") {
    const h = parseIntField(hour ?? "");
    const d = parseIntField(dow ?? "");
    if (h !== null && d !== null && d >= 0 && d <= 6) {
      return `每周${WEEKDAYS[d]} ${h}:00`;
    }
  }

  // 0 H D * * → 每月 D 日 H:00
  if (min === "0" && mon === "*" && dow === "*") {
    const h = parseIntField(hour ?? "");
    const d = parseIntField(dom ?? "");
    if (h !== null && d !== null && d >= 1 && d <= 31) {
      return `每月 ${d} 日 ${h}:00`;
    }
  }

  return cron;
}

/** 自定义下拉项文案：中文描述 + cron */
export function describeCronOption(cron: string): string {
  const text = describeCron(cron);
  if (text === cron) return `自定义（${cron}）`;
  return `自定义 · ${text}（${cron}）`;
}
