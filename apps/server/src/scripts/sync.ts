/**
 * Markdown ↔ SQLite 同步编译脚本
 *
 * 扫描 content/posts/ 目录下的所有 .md 文件，
 * 解析其 Frontmatter 和正文，同步写入 SQLite 数据库中。
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 定位 content/posts 目录 (自适应执行路径)
let postsDir = path.resolve(process.cwd(), "content/posts");
if (!fs.existsSync(postsDir)) {
  postsDir = path.resolve(process.cwd(), "../../content/posts");
}

/** 递归获取所有 .md 文件路径 */
function getMarkdownFilesRecursive(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      // 忽略 images 或 资源目录
      if (file !== "images" && file !== "public") {
        results = results.concat(getMarkdownFilesRecursive(filePath));
      }
    } else if (file.endsWith(".md")) {
      results.push(filePath);
    }
  });
  return results;
}

async function syncPosts() {
  console.log(`\n🔄 开始同步 Markdown 文章至数据库...`);
  console.log(`📂 文章源目录: ${postsDir}`);

  if (!fs.existsSync(postsDir)) {
    console.error(`❌ 错误: 找不到文章目录 "${postsDir}"`);
    process.exit(1);
  }

  // 1. 递归获取所有 .md 文件路径
  const filePaths = getMarkdownFilesRecursive(postsDir);
  console.log(`📝 检测到 ${filePaths.length} 篇本地文章（含子目录）。`);

  const activeSlugs: string[] = [];

  // 2. 循环处理每篇文章
  for (const filePath of filePaths) {
    // 生成基于相对路径的唯一 slug (使用正斜杠 /，且去掉 .md 后缀)
    const relativePath = path.relative(postsDir, filePath);
    const slug = relativePath.replace(/\\/g, "/").replace(/\.md$/, "");
    activeSlugs.push(slug);

    const fileContent = fs.readFileSync(filePath, "utf-8");
    const fileName = path.basename(filePath);

    try {
      // 解析 YAML Frontmatter 和正文
      const { data, content } = matter(fileContent);

      const title = data.title || slug;
      const category = data.category || null;
      const excerpt = data.excerpt || null;
      const published = typeof data.published === "boolean" ? data.published : true;
      
      // 处理标签 (数组转逗号分隔字符串)
      let tags = "";
      if (Array.isArray(data.tags)) {
        tags = data.tags.filter(Boolean).map((t: string) => t.trim()).join(",");
      } else if (typeof data.tags === "string") {
        tags = data.tags;
      }

      // Upsert 到数据库
      await prisma.post.upsert({
        where: { slug },
        update: {
          title,
          content,
          excerpt,
          published,
          category,
          tags,
        },
        create: {
          slug,
          title,
          content,
          excerpt,
          published,
          category,
          tags,
        },
      });

      console.log(`  ✅ [已同步] ${title} \n     slug: "${slug}" (${fileName}) -> 数据库`);
    } catch (e: any) {
      console.error(`  ❌ [解析失败] 文件 ${fileName}:`, e.message);
    }
  }

  // 3. 清理已删除的本地文件对应的数据库记录 (保持 Git 作为唯一事实源)
  const allPostsInDb = await prisma.post.findMany({ select: { slug: true, title: true } });
  
  for (const dbPost of allPostsInDb) {
    if (!activeSlugs.includes(dbPost.slug)) {
      await prisma.post.delete({ where: { slug: dbPost.slug } });
      console.log(`  🗑️ [已清理] 数据库文章 "${dbPost.title}" (本地文件已被删除)`);
    }
  }

  console.log(`🎉 文章同步完成！\n`);
}

syncPosts()
  .catch((e) => {
    console.error("❌ 同步脚本执行失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
