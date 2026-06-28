/**
 * About Me — 从 content/about/profile.md 读取（Markdown 为真相源）
 */

import fs from "fs";
import path from "path";
import type { AboutProfile } from "@knowpilot/shared";
import { getAppConfig } from "./config.js";

function parseSimpleList(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}

function parseProjects(block: string): AboutProfile["projects"] {
  const items: AboutProfile["projects"] = [];
  const chunks = block.split(/\n(?=- name:)/).filter(Boolean);
  for (const chunk of chunks) {
    const name = chunk.match(/^- name:\s*(.+)$/m)?.[1]?.trim();
    const description = chunk.match(/^\s+description:\s*(.+)$/m)?.[1]?.trim();
    const href = chunk.match(/^\s+href:\s*(.+)$/m)?.[1]?.trim();
    if (name && description) items.push({ name, description, href: href || undefined });
  }
  return items;
}

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const fm = match[1];
  const body = match[2].trim();
  const data: Record<string, string> = {};
  let key = "";
  let buf = "";
  for (const line of fm.split("\n")) {
    if (/^[a-zA-Z][\w-]*:\s*$/.test(line)) {
      if (key) data[key] = buf.trimEnd();
      key = line.replace(":", "").trim();
      buf = "";
    } else if (/^[a-zA-Z][\w-]*:\s*.+/.test(line) && !line.startsWith("  ")) {
      if (key) data[key] = buf.trimEnd();
      const idx = line.indexOf(":");
      key = line.slice(0, idx).trim();
      buf = line.slice(idx + 1).trim();
    } else {
      buf += `${line}\n`;
    }
  }
  if (key) data[key] = buf.trimEnd();
  return { data, body };
}

export function loadAboutProfile(): AboutProfile {
  const config = getAppConfig();
  const envPath = process.env.ABOUT_PROFILE_PATH?.trim();
  const filePath = envPath
    ? path.resolve(envPath)
    : path.join(config.contentDir, "about", "profile.md");

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, body } = parseFrontmatter(raw);

  return {
    name: data.name || "KnowPilot",
    title: data.title || "Creator",
    tagline: data.tagline || "",
    location: data.location || "",
    github: data.github || "",
    site: data.site || "",
    email: data.email || "",
    focus: parseSimpleList(data.focus || ""),
    stack: parseSimpleList(data.stack || ""),
    projects: parseProjects(data.projects || ""),
    philosophy: parseSimpleList(data.philosophy || ""),
    bodyMarkdown: body,
  };
}
