/**
 * Inbox 管道单测：目录约定、URL 去重 upsert、微信 drop、截图扫描（无 OCR）
 */
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import {
  ensureInboxDirs,
  upsertInboxItem,
  ingestWechatDropFile,
  scanScreenshotDrop,
  formatInboxItemBody,
  resolveScreenshotWatchDir,
  parseXhsNotesFromApiJson,
  xhsInboxExternalId,
  shouldStopXhsIncrementalBatch,
  parseZhihuFavlistsJson,
  parseZhihuCollectionItemsJson,
  extractZhihuCollectionId,
  shouldStopZhihuIncrementalPage,
  parseBilibiliFavFoldersJson,
  parseBilibiliFavMediasJson,
  parseBilibiliToviewJson,
  bilibiliInboxExternalId,
  shouldStopBilibiliIncrementalPage,
} from "../infra/inboxPipeline.js";
import {
  inboxSyncXhsSchema,
  inboxSyncZhihuSchema,
  inboxSyncBilibiliSchema,
} from "@knowpilot/shared";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";

describe("inboxPipeline", () => {
  let root: string;
  const createdIds: string[] = [];

  beforeEach(() => {
    root = createTempProjectDir();
    createdIds.length = 0;
  });

  afterEach(async () => {
    if (createdIds.length) {
      await prisma.inboxItem.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
    }
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("ensureInboxDirs 创建 drop 与 wechat links.txt", () => {
    const config = createTestConfig(root);
    const dirs = ensureInboxDirs(config);
    expect(fs.existsSync(dirs.drop)).toBe(true);
    expect(fs.existsSync(dirs.wechatLinks)).toBe(true);
    expect(resolveScreenshotWatchDir(config)).toBe(dirs.drop);
  });

  it("formatInboxItemBody 含来源与原文链接", () => {
    const md = formatInboxItemBody({
      title: "测试标题",
      source: "wechat",
      url: "https://mp.weixin.qq.com/s/abc",
      content: "正文一段",
      tags: ["wechat"],
    });
    expect(md).toContain("# 测试标题");
    expect(md).toContain("https://mp.weixin.qq.com/s/abc");
    expect(md).toContain("正文一段");
  });

  it("upsertInboxItem 按 source+externalId 去重", async () => {
    const externalId = `https://example.com/inbox-test-${Date.now()}`;
    const a = await upsertInboxItem(prisma, {
      source: "url",
      externalId,
      title: "A",
      url: externalId,
    });
    createdIds.push(a.id);
    expect(a.created).toBe(true);
    const b = await upsertInboxItem(prisma, {
      source: "url",
      externalId,
      title: "A2",
      url: externalId,
      content: "updated",
    });
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    const row = await prisma.inboxItem.findUnique({ where: { id: a.id } });
    expect(row?.title).toBe("A2");
    expect(row?.content).toBe("updated");
  });

  it("ingestWechatDropFile 读取 links.txt 并归档", async () => {
    const config = createTestConfig(root);
    const { wechatLinks, wechat } = ensureInboxDirs(config);
    const u1 = `https://mp.weixin.qq.com/s/inbox-w1-${Date.now()}`;
    const u2 = `https://mp.weixin.qq.com/s/inbox-w2-${Date.now()}`;
    fs.writeFileSync(wechatLinks, `# comment\n${u1}\n${u2}\n`, "utf-8");
    const result = await ingestWechatDropFile(prisma, config, { fetchContent: false, maxUrls: 10 });
    expect(result.scanned).toBe(2);
    expect(result.created).toBe(2);
    for (const item of result.items) createdIds.push(item.id);
    expect(fs.existsSync(path.join(wechat, "links.done.txt"))).toBe(true);
    const remaining = fs.readFileSync(wechatLinks, "utf-8");
    expect(remaining).not.toContain("inbox-w1-");
  });

  it("inboxSyncZhihuSchema 默认增量且 URL 可选", () => {
    const parsed = inboxSyncZhihuSchema.parse({});
    expect(parsed.mode).toBe("incremental");
    expect(parsed.collectionUrl).toBeUndefined();
    expect(parsed.maxItemsPerCollection).toBe(5000);
    expect(extractZhihuCollectionId("https://www.zhihu.com/collection/12345")).toBe("12345");
    expect(shouldStopZhihuIncrementalPage(20, 0)).toBe(true);
    expect(shouldStopZhihuIncrementalPage(20, 1)).toBe(false);
    expect(shouldStopZhihuIncrementalPage(0, 0)).toBe(false);
  });

  it("parseZhihuFavlistsJson / items JSON", () => {
    const cols = parseZhihuFavlistsJson({
      data: [
        { id: 99, title: "我的夹", answer_count: 12 },
        { id: "bad", title: "x" },
      ],
    });
    expect(cols).toHaveLength(1);
    expect(cols[0]!.id).toBe("99");
    expect(cols[0]!.itemCount).toBe(12);
    expect(cols[0]!.url).toContain("/collection/99");

    const { items, isEnd } = parseZhihuCollectionItemsJson({
      data: [
        {
          content: {
            type: "answer",
            id: 2,
            question: { id: 1, title: "问" },
            author: { name: "甲" },
            excerpt: "摘要",
          },
        },
        { content: { type: "article", id: 8, title: "专栏文" } },
      ],
      paging: { is_end: true },
    });
    expect(isEnd).toBe(true);
    expect(items).toHaveLength(2);
    expect(items[0]!.url).toContain("/question/1/answer/2");
    expect(items[1]!.url).toContain("/p/8");
  });

  it("inboxSyncXhsSchema 默认 kinds + incremental", () => {
    const parsed = inboxSyncXhsSchema.parse({});
    expect(parsed.kinds).toEqual(["liked", "collect"]);
    expect(parsed.mode).toBe("incremental");
    expect(xhsInboxExternalId("liked", "abc")).toBe("like:abc");
    expect(xhsInboxExternalId("collect", "abc")).toBe("fav:abc");
    expect(shouldStopXhsIncrementalBatch(10, 0, true)).toBe(true);
    expect(shouldStopXhsIncrementalBatch(10, 0, false)).toBe(false);
    expect(shouldStopXhsIncrementalBatch(10, 2, true)).toBe(false);
  });

  it("parseXhsNotesFromApiJson 解析 note 列表", () => {
    const notes = parseXhsNotesFromApiJson(
      {
        data: {
          notes: [
            {
              note_id: "n1",
              display_title: "标题一",
              xsec_token: "tok",
              user: { nickname: "作者" },
            },
          ],
        },
      },
      "liked",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.noteId).toBe("n1");
    expect(notes[0]!.title).toBe("标题一");
    expect(notes[0]!.url).toContain("xsec_token=tok");
    expect(notes[0]!.author).toBe("作者");
  });

  it("inboxSyncBilibiliSchema 默认 kinds + incremental", () => {
    const parsed = inboxSyncBilibiliSchema.parse({});
    expect(parsed.kinds).toEqual(["fav", "toview"]);
    expect(parsed.mode).toBe("incremental");
    expect(bilibiliInboxExternalId("fav", "BV1xx411c7mD", "123")).toBe("fav:123:BV1xx411c7mD");
    expect(bilibiliInboxExternalId("toview", "BV1xx411c7mD")).toBe("toview:BV1xx411c7mD");
    expect(shouldStopBilibiliIncrementalPage(20, 0)).toBe(true);
    expect(shouldStopBilibiliIncrementalPage(20, 1)).toBe(false);
  });

  it("parseBilibili fav / toview JSON", () => {
    const folders = parseBilibiliFavFoldersJson({
      data: { list: [{ id: 42, title: "默认收藏夹", media_count: 9 }, { id: "bad", title: "x" }] },
    });
    expect(folders).toHaveLength(1);
    expect(folders[0]!.id).toBe("42");
    expect(folders[0]!.mediaCount).toBe(9);

    const { items, hasMore } = parseBilibiliFavMediasJson({
      data: {
        medias: [
          { bvid: "BV1xx411c7mD", title: "测试视频", upper: { name: "UP主" }, intro: "简介" },
          { bvid: "bad", title: "跳过" },
        ],
        has_more: true,
      },
    });
    expect(hasMore).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0]!.bvid).toBe("BV1xx411c7mD");
    expect(items[0]!.author).toBe("UP主");

    const toview = parseBilibiliToviewJson({
      data: {
        list: [{ bvid: "BV1yy411c7mE", title: "稍后再看", owner: { name: "乙" }, desc: "d" }],
      },
    });
    expect(toview).toHaveLength(1);
    expect(toview[0]!.bvid).toBe("BV1yy411c7mE");
  });

  it("B站收藏与稍后再看可各存一条同 bvid", async () => {
    const bvid = `BV1test${Date.now().toString(36)}`;
    const fav = await upsertInboxItem(prisma, {
      source: "bilibili",
      externalId: bilibiliInboxExternalId("fav", bvid, "99"),
      title: "收藏视频",
      url: `https://www.bilibili.com/video/${bvid}`,
      tags: ["bilibili", "favorite"],
      metadata: { collectionId: "99", collectionTitle: "默认收藏夹" },
    });
    const toview = await upsertInboxItem(prisma, {
      source: "bilibili",
      externalId: bilibiliInboxExternalId("toview", bvid),
      title: "稍后再看",
      url: `https://www.bilibili.com/video/${bvid}`,
      tags: ["bilibili", "toview"],
    });
    createdIds.push(fav.id, toview.id);
    expect(fav.created).toBe(true);
    expect(toview.created).toBe(true);
    expect(fav.id).not.toBe(toview.id);
  });

  it("小红书点赞与收藏可各存一条同 noteId", async () => {
    const noteId = `xhs-dual-${Date.now()}`;
    const liked = await upsertInboxItem(prisma, {
      source: "xhs",
      externalId: xhsInboxExternalId("liked", noteId),
      title: "点赞笔记",
      url: `https://www.xiaohongshu.com/explore/${noteId}`,
      tags: ["xhs", "like"],
    });
    const fav = await upsertInboxItem(prisma, {
      source: "xhs",
      externalId: xhsInboxExternalId("collect", noteId),
      title: "收藏笔记",
      url: `https://www.xiaohongshu.com/explore/${noteId}`,
      tags: ["xhs", "favorite"],
    });
    createdIds.push(liked.id, fav.id);
    expect(liked.created).toBe(true);
    expect(fav.created).toBe(true);
    expect(liked.id).not.toBe(fav.id);
  });

  it("scanScreenshotDrop 无 OCR 时按文件 hash 入库", async () => {
    const config = createTestConfig(root);
    const { drop } = ensureInboxDirs(config);
    const pngPath = path.join(drop, "shot.png");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    fs.writeFileSync(pngPath, png);
    const result = await scanScreenshotDrop(prisma, config, { runOcr: false, maxFiles: 10 });
    expect(result.scanned).toBe(1);
    expect(result.created).toBe(1);
    for (const item of result.items) createdIds.push(item.id);
    expect(fs.existsSync(pngPath)).toBe(false);
  });
});
