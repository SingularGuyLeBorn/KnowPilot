/**
 * 发现 content/ 下的花园 id（供 sync-posts / sync-gardens / ensure 共用）
 */
import fs from "fs";
import path from "path";
import {
  isReservedContentDir,
  isValidGardenIdFormat,
  SEED_GARDENS,
} from "@knowpilot/shared";

export const GARDEN_META_FILE = "_garden.md";

export function discoverGardenIds(contentRoot: string): string[] {
  if (!fs.existsSync(contentRoot)) return [];
  const ids = new Set<string>();
  for (const ent of fs.readdirSync(contentRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const id = ent.name;
    if (!isValidGardenIdFormat(id) || isReservedContentDir(id)) continue;
    const meta = path.join(contentRoot, id, GARDEN_META_FILE);
    if (fs.existsSync(meta)) ids.add(id);
  }
  for (const seed of SEED_GARDENS) {
    const dir = path.join(contentRoot, seed);
    if (fs.existsSync(dir)) ids.add(seed);
  }
  return Array.from(ids).sort();
}
