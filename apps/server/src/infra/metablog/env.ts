/**
 * MetaBlog 搜索/平台模块环境变量读取 — 与 MetaBlog getEnv 行为一致
 */

export function getEnv(key: string, fallback = ""): string {
  const direct = process.env[key];
  if (direct !== undefined && direct !== "") return direct;
  if (key.startsWith("SEARCH_")) {
    const alt = process.env[key.slice("SEARCH_".length)];
    if (alt !== undefined && alt !== "") return alt;
  }
  return fallback;
}
