/**
 * 批量清理 content/posts 下的 Markdown：
 * 1. 删除 emoji 字符
 * 2. 去重 \tag{...}
 * 3. 规范化 display math 块，让 $$ 单独成行、\tag 不独占一行
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import createEmojiRegex from "emoji-regex";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const POSTS_DIR = path.join(ROOT, "content/posts");
const emojiRegex = createEmojiRegex();

function walk(dir) {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      entries.push(...walk(full));
    } else if (stat.isFile() && name.endsWith(".md")) {
      entries.push(full);
    }
  }
  return entries;
}

function deduplicateTags(content) {
  // 把同一公式里连续重复的 \tag{x} 合并成一个
  return content.replace(
    /(\\tag\{([^}]+)\})(?:\s*\\tag\{[^}]+\})+/g,
    "$1"
  );
}

function normalizeDisplayMath(content) {
  // 匹配 display math 块（避免破坏行内 $...$）
  return content.replace(/\$\$[\s\S]*?\$\$/g, (block) => {
    // 确认确实是 $$ 而不是 $$$...$$$ 这类边界情况
    if (!block.startsWith("$$") || !block.endsWith("$$")) return block;
    let inner = block.slice(2, -2);

    // 去掉首尾空白行
    inner = inner.replace(/^\n+/, "").replace(/\n+$/, "");

    // 把独占一行的 \tag{x} 合并到前一行末尾
    inner = inner.replace(/\n\\tag\{([^}]+)\}\s*$/g, " \\tag{$1}");
    inner = inner.replace(/\\tag\{([^}]+)\}\s*\n/g, " \\tag{$1} ");

    // 确保公式体内部没有只剩空白的行
    inner = inner.replace(/[ \t]+$/gm, "");

    return "$$\n" + inner + "\n$$";
  });
}

function cleanEmojis(content) {
  return content
    .replace(emojiRegex, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, ""); // 去掉修饰符
}

function main() {
  if (!fs.existsSync(POSTS_DIR)) {
    console.error(`目录不存在: ${POSTS_DIR}`);
    process.exit(1);
  }

  const files = walk(POSTS_DIR);
  let changedCount = 0;
  let tagFixedCount = 0;
  let emojiRemovedCount = 0;
  let mathNormalizedCount = 0;

  for (const file of files) {
    const original = fs.readFileSync(file, "utf-8");
    let cleaned = deduplicateTags(original);
    cleaned = normalizeDisplayMath(cleaned);
    cleaned = cleanEmojis(cleaned);

    if (cleaned !== original) {
      const tagDiff = (original.match(/\\tag\{/g) || []).length - (cleaned.match(/\\tag\{/g) || []).length;
      const emojiDiff = (original.match(emojiRegex) || []).length;
      if (emojiDiff) emojiRemovedCount += emojiDiff;
      if (tagDiff !== 0) tagFixedCount += tagDiff;
      if (normalizeDisplayMath(original) !== original) mathNormalizedCount++;

      fs.writeFileSync(file, cleaned, "utf-8");
      changedCount++;
      console.log(`[OK] ${path.relative(ROOT, file)}`);
    }
  }

  console.log(`\n完成：处理 ${files.length} 个文件，修改 ${changedCount} 个。`);
  console.log(`  - 去重 tag：${tagFixedCount} 处`);
  console.log(`  - 移除 emoji：${emojiRemovedCount} 个`);
  console.log(`  - 规范化公式块：${mathNormalizedCount} 个文件`);
}

main();
