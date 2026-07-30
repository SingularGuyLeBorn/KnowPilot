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
  parseZhihuFavlistsJson,
  parseZhihuCollectionItemsJson,
  extractZhihuCollectionId,
  shouldStopIncrementalKnownStreak,
  INBOX_INCREMENTAL_KNOWN_STREAK,
  resolveZhihuFavlistNextOffset,
  parseBilibiliFavFoldersJson,
  parseBilibiliFavMediasJson,
  parseBilibiliToviewJson,
  bilibiliInboxExternalId,
  hasUsableInboxContent,
  looksLikeInboxFetchBlocked,
} from "../infra/inbox/index.js";
import {
  inboxSyncXhsSchema,
  inboxSyncZhihuSchema,
  inboxSyncBilibiliSchema,
  inboxEnrichSchema,
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
    expect(INBOX_INCREMENTAL_KNOWN_STREAK).toBe(10);
    expect(shouldStopIncrementalKnownStreak(9)).toBe(false);
    expect(shouldStopIncrementalKnownStreak(10)).toBe(true);
    expect(shouldStopIncrementalKnownStreak(0)).toBe(false);
    // 开放平台假 IsEnd + 无 NextOffset：Totals 未扫完则用 scanned 续翻
    expect(
      resolveZhihuFavlistNextOffset({
        currentOffset: 0,
        nextOffset: "",
        isEnd: true,
        pageItemCount: 19,
        scanned: 19,
        remoteCount: 1379,
      }),
    ).toEqual({ done: false, offset: 19 });
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
    expect(shouldStopIncrementalKnownStreak(10)).toBe(true);
    expect(shouldStopIncrementalKnownStreak(9)).toBe(false);
  });

  it("parseXhsNotesFromApiJson 解析 note 列表", () => {
    const notes = parseXhsNotesFromApiJson(
      {
        data: {
          notes: [
            {
              note_id: "n1abcdef",
              display_title: "标题一",
              xsec_token: "tok",
              user: { nickname: "作者" },
              cover: { url_default: "https://sns-webpic.example/cover.webp" },
            },
          ],
        },
      },
      "liked",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.noteId).toBe("n1abcdef");
    expect(notes[0]!.title).toBe("标题一");
    expect(notes[0]!.url).toContain("xsec_token=tok");
    expect(notes[0]!.author).toBe("作者");
    expect(notes[0]!.coverUrl).toBe("https://sns-webpic.example/cover.webp");
  });

  it("parseXhsNotesFromApiJson 提取 desc 与时间", () => {
    const notes = parseXhsNotesFromApiJson(
      {
        data: {
          notes: [
            {
              note_id: "n2abcdef",
              display_title: "标题二",
              desc: "这是摘要正文",
              time: 1700000000,
              user: { nickname: "乙" },
            },
          ],
        },
      },
      "collect",
    );
    expect(notes[0]!.excerpt).toBe("这是摘要正文");
    expect(notes[0]!.publishedAtMs).toBe(1700000000 * 1000);
  });

  it("parseXhsNotesFromApiJson 嵌套 time + 跳过 user.create_time", () => {
    const notes = parseXhsNotesFromApiJson(
      {
        data: {
          notes: [
            {
              note_card: {
                note_id: "n3nested1",
                display_title: "嵌套时间",
                user: { nickname: "丙", create_time: 1000000000 },
                interact_info: { liked: true },
                meta: { last_update_time: 1710000000 },
              },
            },
          ],
        },
      },
      "liked",
    );
    expect(notes[0]!.publishedAtMs).toBe(1710000000 * 1000);
  });

  it("coerceXhsEpochMs 拒绝相对文案与过小数", async () => {
    const { coerceXhsEpochMs } = await import("../infra/inbox/xhs.js");
    expect(coerceXhsEpochMs("3天前")).toBeUndefined();
    expect(coerceXhsEpochMs(123)).toBeUndefined();
    expect(coerceXhsEpochMs(1710000000)).toBe(1710000000 * 1000);
  });

  it("parseXhsNotesFromApiJson 兼容 items + noteCard", () => {
    const notes = parseXhsNotesFromApiJson(
      {
        data: {
          items: [
            {
              id: "feed99xyz",
              noteCard: { noteId: "card99xyz", displayTitle: "卡片标题", xsecToken: "t2" },
            },
          ],
        },
      },
      "collect",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.noteId).toBe("card99xyz");
    expect(notes[0]!.title).toBe("卡片标题");
  });

  it("parseXhsNotesFromApiJson 无 display_title 时用 desc 首行，不落成笔记 id", async () => {
    const { isXhsPlaceholderTitle, titleFromXhsDesc } = await import("../infra/inbox/xhs.js");
    expect(titleFromXhsDesc("做一个多模态 RAG\n#AI")).toBe("做一个多模态 RAG");
    expect(isXhsPlaceholderTitle("笔记 6a644bff0000000011004ed5")).toBe(true);
    const notes = parseXhsNotesFromApiJson(
      {
        data: {
          notes: [
            {
              note_id: "6a644bff0000000011004ed5",
              display_title: "",
              desc: "简单讲讲 @tool 装饰器是个啥?\n#Agent",
            },
          ],
        },
      },
      "liked",
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("简单讲讲 @tool 装饰器是个啥?");
    expect(isXhsPlaceholderTitle(notes[0]!.title, notes[0]!.noteId)).toBe(false);
  });

  it("inboxSyncBilibiliSchema 默认 kinds + incremental", () => {
    const parsed = inboxSyncBilibiliSchema.parse({});
    expect(parsed.kinds).toEqual(["fav", "toview"]);
    expect(parsed.mode).toBe("incremental");
    expect(bilibiliInboxExternalId("fav", "BV1xx411c7mD", "123")).toBe("fav:123:BV1xx411c7mD");
    expect(bilibiliInboxExternalId("toview", "BV1xx411c7mD")).toBe("toview:BV1xx411c7mD");
    expect(shouldStopIncrementalKnownStreak(10)).toBe(true);
    expect(shouldStopIncrementalKnownStreak(3)).toBe(false);
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

  it("hasUsableInboxContent / looksLikeInboxFetchBlocked 防风控判定", () => {
    expect(hasUsableInboxContent("短")).toBe(false);
    expect(hasUsableInboxContent("1 | " + "长程任务是指需要跨越较长时间跨度的复杂任务。".repeat(2))).toBe(
      true,
    );
    expect(looksLikeInboxFetchBlocked("当前请求存在异常，暂时限制本次访问")).toBe(true);
    expect(looksLikeInboxFetchBlocked(null, "login required")).toBe(true);
    expect(looksLikeInboxFetchBlocked("正常技术正文关于 Long-Horizon Agent 训练方法的讨论")).toBe(
      false,
    );
    expect(inboxEnrichSchema.parse({}).maxItems).toBe(12);
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
