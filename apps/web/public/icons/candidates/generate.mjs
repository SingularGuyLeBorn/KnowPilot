import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));

const icons = [
  {
    id: "01-oasis-eye",
    name: "见微之眼",
    d: '<circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="2.5"/><ellipse cx="32" cy="32" rx="12" ry="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="32" r="3.5" fill="currentColor"/>',
  },
  {
    id: "02-oasis-palm",
    name: "绿洲棕榈",
    d: '<path d="M32 54 V28" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M32 30 C20 18 12 22 14 14 C22 16 28 22 32 28 C36 22 42 16 50 14 C52 22 44 18 32 30 Z" fill="currentColor" opacity="0.9"/><path d="M24 52 H40" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  },
  {
    id: "03-garden-leaf",
    name: "花园叶",
    d: '<path d="M32 50 C18 40 14 22 32 12 C50 22 46 40 32 50 Z" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M32 48 V18" stroke="currentColor" stroke-width="2"/><path d="M32 30 C26 28 22 24 20 20" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M32 34 C38 32 42 28 44 24" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  },
  {
    id: "04-md-atom",
    name: "Markdown 原子",
    d: '<rect x="12" y="16" width="40" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M20 38 V26 L26 34 L32 26 V38" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M38 26 V38 M38 26 H46" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  },
  {
    id: "05-agent-node",
    name: "Agent 节点",
    d: '<circle cx="32" cy="22" r="8" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="16" cy="44" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="48" cy="44" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M28 28 L20 38 M36 28 L44 38" stroke="currentColor" stroke-width="2"/>',
  },
  {
    id: "06-swarm-hex",
    name: "Swarm 蜂巢",
    d: '<path d="M32 10 L48 19 V37 L32 46 L16 37 V19 Z" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M32 22 L40 27 V37 L32 42 L24 37 V27 Z" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.5"/>',
  },
  {
    id: "07-shield-nod",
    name: "待你点头盾",
    d: '<path d="M32 10 L50 18 V32 C50 44 40 52 32 56 C24 52 14 44 14 32 V18 Z" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M24 32 L30 38 L42 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    id: "08-inbox-tray",
    name: "Inbox 托盘",
    d: '<path d="M12 28 L20 14 H44 L52 28 V48 H12 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M12 28 H24 L28 34 H36 L40 28 H52" fill="none" stroke="currentColor" stroke-width="2"/>',
  },
  {
    id: "09-compass",
    name: "导航罗盘",
    d: '<circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M32 16 L36 32 L32 48 L28 32 Z" fill="currentColor"/><circle cx="32" cy="32" r="3" fill="#F4F7F2" stroke="currentColor" stroke-width="1.5"/>',
  },
  {
    id: "10-seedling",
    name: "萌芽",
    d: '<path d="M32 54 V30" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M32 34 C22 34 16 26 18 18 C26 20 32 26 32 34" fill="currentColor" opacity="0.85"/><path d="M32 38 C40 36 48 28 46 20 C40 22 34 30 32 38" fill="currentColor" opacity="0.55"/>',
  },
  {
    id: "11-star-garden",
    name: "星空花园",
    d: '<path d="M32 14 L35 26 H48 L38 34 L41 46 L32 39 L23 46 L26 34 L16 26 H29 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="18" cy="16" r="1.5" fill="currentColor"/><circle cx="48" cy="18" r="1.2" fill="currentColor"/><circle cx="50" cy="48" r="1.4" fill="currentColor"/>',
  },
  {
    id: "12-fountain",
    name: "绿洲泉",
    d: '<path d="M20 48 H44" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M24 48 V40 H40 V48" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="28" r="4" fill="currentColor"/><path d="M32 24 C22 18 18 28 26 32" fill="none" stroke="currentColor" stroke-width="2"/><path d="M32 24 C42 18 46 28 38 32" fill="none" stroke="currentColor" stroke-width="2"/>',
  },
  {
    id: "13-trail",
    name: "小径",
    d: '<path d="M16 48 C24 40 24 32 32 28 C40 24 40 16 48 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="16" cy="48" r="3" fill="currentColor"/><circle cx="32" cy="28" r="2.5" fill="currentColor"/><circle cx="48" cy="12" r="3" fill="currentColor"/>',
  },
  {
    id: "14-microscope",
    name: "见微显微镜",
    d: '<path d="M26 14 H38" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M32 14 V28" stroke="currentColor" stroke-width="2.5"/><circle cx="32" cy="36" r="8" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M22 52 H42 M28 44 L24 52 M36 44 L40 52" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  },
  {
    id: "15-nested-rings",
    name: "嵌套花园",
    d: '<circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="32" r="13" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="32" r="6" fill="currentColor"/>',
  },
  {
    id: "16-chat-leaf",
    name: "对话叶",
    d: '<path d="M16 18 H44 C48 18 52 22 52 26 V34 C52 38 48 42 44 42 H32 L24 50 V42 H20 C16 42 12 38 12 34 V26 C12 22 16 18 20 18 Z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M30 34 C26 30 26 24 30 22 C34 24 34 30 30 34 Z" fill="currentColor"/>',
  },
  {
    id: "17-local-key",
    name: "本地钥匙",
    d: '<circle cx="24" cy="32" r="10" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="24" cy="32" r="3" fill="currentColor"/><path d="M33 32 H52 M46 32 V40 M52 32 V38" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  },
  {
    id: "18-mcp-link",
    name: "MCP 链路",
    d: '<rect x="10" y="26" width="14" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="40" y="26" width="14" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 32 H40" stroke="currentColor" stroke-width="2.5"/><circle cx="32" cy="32" r="3" fill="currentColor"/>',
  },
  {
    id: "19-heartbeat",
    name: "心跳脉冲",
    d: '<path d="M8 34 H20 L26 18 L34 46 L40 28 H56" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    id: "20-quill",
    name: "羽笔",
    d: '<path d="M18 48 L28 20 C40 12 52 18 46 30 L34 48 Z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M28 20 L34 48" stroke="currentColor" stroke-width="1.5"/><path d="M16 50 H28" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  },
];

function wrap(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128" role="img" fill="none">
  <rect width="64" height="64" rx="14" fill="#F4F7F2"/>
  <g color="#2F4A3C">${inner}</g>
</svg>
`;
}

for (const icon of icons) {
  fs.writeFileSync(path.join(dir, `${icon.id}.svg`), wrap(icon.d), "utf8");
}

const cards = icons
  .map(
    (i) => `
  <a class="card" href="./${i.id}.svg" target="_blank" rel="noopener">
    <img src="./${i.id}.svg" alt="${i.name}" width="96" height="96"/>
    <div class="meta"><strong>${i.id}</strong><span>${i.name}</span></div>
  </a>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>见微 Icon 候选 × 20</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", "PingFang SC", sans-serif; background: #eef2ec; color: #1f2d26; }
    header { padding: 28px 24px 8px; max-width: 1100px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 1.5rem; }
    p { margin: 0; color: #5a6b60; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; padding: 24px; max-width: 1100px; margin: 0 auto 40px; }
    .card { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px 12px; background: #fff; border-radius: 18px; text-decoration: none; color: inherit; border: 1px solid #d7e0d6; box-shadow: 0 8px 24px rgba(47,74,60,.06); transition: transform .15s ease, box-shadow .15s ease; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(47,74,60,.12); }
    .meta { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
    .meta strong { font-size: 12px; font-weight: 600; }
    .meta span { font-size: 13px; color: #4d6356; }
  </style>
</head>
<body>
  <header>
    <h1>见微 / OasisMind · Icon 候选 20</h1>
    <p>点击卡片可直接打开对应 SVG。挑选后告诉我编号即可接入品牌位。开发时可打开 <code>/icons/candidates/</code>。</p>
  </header>
  <div class="grid">${cards}</div>
</body>
</html>
`;

fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
console.log(`wrote ${icons.length} svgs + index.html → ${dir}`);
