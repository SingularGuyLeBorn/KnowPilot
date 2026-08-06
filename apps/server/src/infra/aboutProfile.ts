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

function parseFeaturedList(block: string): AboutProfile["featured"] {
  const items: NonNullable<AboutProfile["featured"]> = [];
  if (!block) return items;
  const chunks = block.split(/\n(?=\s*- title:)/).filter(Boolean);
  for (const chunk of chunks) {
    const title = chunk.match(/^\s*- title:\s*(.+)$/m)?.[1]?.trim();
    const description = chunk.match(/^\s+description:\s*(.+)$/m)?.[1]?.trim();
    const url = chunk.match(/^\s+url:\s*(.+)$/m)?.[1]?.trim();
    const tag = chunk.match(/^\s+tag:\s*(.+)$/m)?.[1]?.trim();
    const coverImage = chunk.match(/^\s+coverImage:\s*(.+)$/m)?.[1]?.trim();
    if (title && description) {
      items.push({
        title,
        description,
        url: url || undefined,
        tag: tag || undefined,
        coverImage: coverImage || undefined,
      });
    }
  }
  return items;
}

function parseGallery(block: string): NonNullable<AboutProfile["gallery"]> {
  const items: NonNullable<AboutProfile["gallery"]> = [];
  if (!block) return items;
  let current: Partial<NonNullable<AboutProfile["gallery"]>[number]> = {};
  for (const line of block.split("\n").map((l) => l.trimEnd())) {
    const urlMatch = line.match(/^-\s+url:\s*(.+)$/);
    if (urlMatch) {
      if (current.url) items.push(current as NonNullable<AboutProfile["gallery"]>[number]);
      current = { url: urlMatch[1].trim() };
      continue;
    }
    if (!current.url) continue;
    const captionMatch = line.match(/^\s+caption:\s*(.+)$/);
    if (captionMatch) current.caption = captionMatch[1].trim();
  }
  if (current.url) items.push(current as NonNullable<AboutProfile["gallery"]>[number]);
  return items;
}

function parseTagValueList(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
    .flatMap((l) => l.split(/[,，]/).map((s) => s.trim()))
    .filter(Boolean);
}

function parseKeyedList(block: string): Array<{ title: string; description: string }> {
  const items: Array<{ title: string; description: string }> = [];
  if (!block) return items;

  const lines = block.split("\n").map((l) => l.trimEnd());
  let current: { title: string; description: string } | null = null;

  for (const line of lines) {
    const titleMatch = line.match(/^\s*-\s*\*\*(.+?)\*\*\s*(?::|：)?\s*(.*)$/);
    if (titleMatch) {
      if (current) items.push(current);
      current = { title: titleMatch[1].trim(), description: titleMatch[2].trim() };
      continue;
    }

    const plainMatch = line.match(/^\s*-\s*(.+?)\s*(?::|：)\s*(.*)$/);
    if (plainMatch) {
      if (current) items.push(current);
      current = { title: plainMatch[1].trim(), description: plainMatch[2].trim() };
      continue;
    }

    if (current && line.startsWith("  ")) {
      current.description += ` ${line.trim()}`;
    }
  }

  if (current) items.push(current);
  return items;
}

function parseCategorizedList(block: string): Array<{ category: string; items: string[] }> {
  const groups: Array<{ category: string; items: string[] }> = [];
  if (!block) return groups;

  let current: { category: string; items: string[] } | null = null;
  for (const line of block.split("\n").map((l) => l.trimEnd())) {
    const catMatch = line.match(/^\s*-\s*\*\*(.+?)\*\*\s*[:：]\s*(.+)$/);
    if (catMatch) {
      if (current) groups.push(current);
      current = { category: catMatch[1].trim(), items: catMatch[2].split(/[,，]/).map((s) => s.trim()).filter(Boolean) };
      continue;
    }
    if (current && line.startsWith("  - ")) {
      current.items.push(line.replace(/^\s*-\s*/, "").trim());
    }
  }
  if (current) groups.push(current);
  return groups;
}

function parseTimeline(block: string): AboutProfile["timeline"] {
  const items: AboutProfile["timeline"] = [];
  if (!block) return items;

  let current: Partial<AboutProfile["timeline"][number]> = {};
  for (const line of block.split("\n").map((l) => l.trimEnd())) {
    const periodMatch = line.match(/^\s*-\s*([^：:\n]+)[:：]\s*(.+)$/);
    if (periodMatch) {
      if (current.period && current.title) items.push(current as AboutProfile["timeline"][number]);
      const rest = periodMatch[2].trim();
      const titleDesc = rest.match(/^(.+?)\s*(?:[-—]|\|\s*|,|，)\s*(.+)$/);
      current = {
        period: periodMatch[1].trim(),
        title: titleDesc ? titleDesc[1].trim() : rest,
        description: titleDesc ? titleDesc[2].trim() : "",
      };
      continue;
    }
    if (current && line.startsWith("  ")) {
      current.description = `${current.description || ""} ${line.trim()}`.trim();
    }
  }
  if (current.period && current.title) items.push(current as AboutProfile["timeline"][number]);
  return items;
}

function parseProjects(block: string): AboutProfile["projects"] {
  const items: AboutProfile["projects"] = [];
  if (!block) return items;

  const chunks = block.split(/\n(?=\s*- name:)/).filter(Boolean);
  for (const chunk of chunks) {
    const name = chunk.match(/^\s*- name:\s*(.+)$/m)?.[1]?.trim();
    const tagline = chunk.match(/^\s+tagline:\s*(.+)$/m)?.[1]?.trim();
    const description = chunk.match(/^\s+description:\s*(.+)$/m)?.[1]?.trim();
    const stackMatch = chunk.match(/^\s+stack:\s*(.+)$/m)?.[1]?.trim();
    const href = chunk.match(/^\s+href:\s*(.+)$/m)?.[1]?.trim();
    const highlight = chunk.match(/^\s+highlight:\s*(.+)$/m)?.[1]?.trim();

    if (name && description) {
      items.push({
        name,
        tagline: tagline || "",
        description,
        stack: stackMatch ? stackMatch.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
        href: href || undefined,
        highlight: highlight || undefined,
      });
    }
  }
  return items;
}

function parseContents(block: string): AboutProfile["contents"] {
  const items: AboutProfile["contents"] = [];
  if (!block) return items;

  let current: Partial<AboutProfile["contents"][number]> = {};
  for (const line of block.split("\n").map((l) => l.trimEnd())) {
    const titleMatch = line.match(/^-\s*title:\s*(.+)$/);
    if (titleMatch) {
      if (current.title) items.push(current as AboutProfile["contents"][number]);
      current = { title: titleMatch[1].trim() };
      continue;
    }
    if (!current.title) continue;

    const typeMatch = line.match(/^\s+type:\s*(.+)$/);
    if (typeMatch) {
      current.type = typeMatch[1].trim();
      continue;
    }
    const descMatch = line.match(/^\s+description:\s*(.+)$/);
    if (descMatch) {
      current.description = descMatch[1].trim();
      continue;
    }
    const urlMatch = line.match(/^\s+url:\s*(.+)$/);
    if (urlMatch) {
      current.url = urlMatch[1].trim();
    }
  }
  if (current.title) items.push(current as AboutProfile["contents"][number]);
  return items;
}

function parseSocials(block: string): AboutProfile["socials"] {
  const items: AboutProfile["socials"] = [];
  if (!block) return items;

  for (const line of block.split("\n").map((l) => l.trimEnd())) {
    const match = line.match(/^\s*-\s*(.+?)\s*[:：]\s*(https?:\/\/.+)$/);
    if (match) items.push({ platform: match[1].trim(), url: match[2].trim() });
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
    : path.join(config.contentPaths.about, "profile.md");

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, body } = parseFrontmatter(raw);

  const focusBlock = data.focus || "";
  const hasRichFocus = focusBlock.includes("**");

  const stackBlock = data.stack || "";
  const hasCategorizedStack = stackBlock.includes("**");

  const philosophyBlock = data.philosophy || "";
  const hasRichPhilosophy = philosophyBlock.includes("**");

  return {
    name: data.name || "OasisMind",
    title: data.title || "Creator",
    tagline: data.tagline || "",
    oneLiner: data.oneLiner || "",
    location: data.location || "",
    github: data.github || "",
    site: data.site || "",
    email: data.email || "",
    mbti: data.mbti?.trim() || undefined,
    avatar: data.avatar || undefined,
    focus: hasRichFocus ? parseKeyedList(focusBlock) : parseSimpleList(focusBlock).map((t) => ({ title: t, description: "" })),
    roles: parseTagValueList(data.roles || ""),
    stack: hasCategorizedStack
      ? parseCategorizedList(stackBlock)
      : [{ category: "常用", items: parseSimpleList(stackBlock) }],
    timeline: parseTimeline(data.timeline || ""),
    projects: parseProjects(data.projects || ""),
    contents: parseContents(data.contents || ""),
    toolbox: parseCategorizedList(data.toolbox || ""),
    philosophy: hasRichPhilosophy
      ? parseKeyedList(philosophyBlock)
      : parseSimpleList(philosophyBlock).map((t) => ({ title: t, description: "" })),
    bodyMarkdown: body,
    socials: parseSocials(data.socials || ""),
    now: parseSimpleList(data.now || ""),
    storyCards: parseKeyedList(data.storyCards || ""),
    featured: parseFeaturedList(data.featured || ""),
    gallery: parseGallery(data.gallery || ""),
  };
}
