/**
 * 飞书写文档：Markdown→docx 块 + children 入参校验 + 工具已注册
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  markdownToDocxBlocks,
  stripTableCellContents,
  feishuCreateDocChildren,
  FEISHU_TEXT_RUN_MAX_CHARS,
  FEISHU_CHILDREN_BATCH_MAX,
} from "../infra/feishuClient.js";
import { listNativeTools } from "../infra/nativeTools.js";
import { getTool } from "../infra/tools/registry.js";

describe("feishu append doc helpers", () => {
  it("markdownToDocxBlocks：空串 → 空数组", () => {
    expect(markdownToDocxBlocks("")).toEqual([]);
    expect(markdownToDocxBlocks("   \n\n  ")).toEqual([]);
  });

  it("markdownToDocxBlocks：标题 / 加粗 / 分割线 → 原生 block_type", () => {
    const md = [
      "# 2027年浙江中考数学模拟卷",
      "",
      "**考试时间：120分钟 | 满分：120分**",
      "",
      "---",
      "",
      "## 一、选择题（每题3分，共30分）",
      "",
      "1. 计算 $(-2)^2 + \\sqrt{9}$ 的值是（）",
    ].join("\n");
    const blocks = markdownToDocxBlocks(md);

    expect(blocks[0]?.block_type).toBe(3); // heading1
    expect((blocks[0] as { heading1?: { elements: unknown[] } }).heading1?.elements?.[0]).toMatchObject({
      text_run: { content: "2027年浙江中考数学模拟卷" },
    });

    const boldBlock = blocks.find((b) => b.block_type === 2);
    expect(boldBlock).toBeTruthy();
    const boldEl = (boldBlock!.text?.elements ?? []).find(
      (el) => (el as { text_run?: { text_element_style?: { bold?: boolean } } }).text_run?.text_element_style?.bold,
    );
    expect(boldEl).toBeTruthy();

    expect(blocks.some((b) => b.block_type === 22)).toBe(true); // divider
    expect(blocks.some((b) => b.block_type === 4)).toBe(true); // heading2
    expect(blocks.some((b) => b.block_type === 13)).toBe(true); // ordered
  });

  it("markdownToDocxBlocks：无序列表用 - ；* 列表会降级并仍可写入", () => {
    const ok = markdownToDocxBlocks("- 项目甲\n- 项目乙");
    expect(ok.every((b) => b.block_type === 12)).toBe(true);
    expect((ok[0] as { bullet?: { elements: Array<{ text_run?: { content?: string } }> } }).bullet?.elements?.[0]?.text_run?.content).toBe(
      "项目甲",
    );
  });

  it("markdownToDocxBlocks：超长行按 FEISHU_TEXT_RUN_MAX_CHARS 切片", () => {
    const long = "x".repeat(FEISHU_TEXT_RUN_MAX_CHARS + 500);
    const blocks = markdownToDocxBlocks(long);
    expect(blocks).toHaveLength(1);
    const els = blocks[0].text?.elements ?? [];
    const c0 = (els[0] as { text_run: { content: string } }).text_run.content;
    const c1 = (els[1] as { text_run: { content: string } }).text_run.content;
    expect(c0.length).toBe(FEISHU_TEXT_RUN_MAX_CHARS);
    expect(c1.length).toBe(500);
  });

  it("markdownToDocxBlocks：55 段 → ≥55 块（供 append 分批）", () => {
    const text = Array.from({ length: 55 }, (_, i) => `p${i}`).join("\n\n");
    const blocks = markdownToDocxBlocks(text);
    expect(blocks.length).toBe(55);
    expect(Math.ceil(blocks.length / FEISHU_CHILDREN_BATCH_MAX)).toBe(2);
  });

  it("markdownToDocxBlocks：GFM 表格 → 原生 table + _cell_contents（MetaBlog 多步填格入参）", () => {
    const md = ["| A | B |", "| --- | --- |", "| 1 | $n_h$ |"].join("\n");
    const blocks = markdownToDocxBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.block_type).toBe(31);
    const cells = blocks[0]?._cell_contents as Array<
      Array<{ text_run?: { content?: string }; equation?: { content?: string } }>
    >;
    expect(cells).toHaveLength(4);
    expect(cells[0]?.[0]?.text_run?.content).toBe("A");
    expect(cells[3]?.some((el) => el.equation?.content === "n_h")).toBe(true);

    // children 直写只能带空表壳；_cell_contents 留给 PATCH 填格
    const shell = stripTableCellContents(blocks[0]!);
    expect(shell._cell_contents).toBeUndefined();
    expect(shell.block_type).toBe(31);
    expect((shell.table as { property?: { column_size?: number } })?.property?.column_size).toBe(2);
  });

  it("markdownToDocxBlocks：缺分隔行仍识别为原生表格", () => {
    const md = [
      "| 方法 | KV Cache 压缩 |",
      "| MQA | $n_h$ 倍 |",
      "| MLA | $2 n_h d_h / d_c$ 倍 |",
    ].join("\n");
    const blocks = markdownToDocxBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.block_type).toBe(31);
    const prop = (blocks[0]?.table as { property?: { row_size?: number; column_size?: number } })?.property;
    expect(prop?.row_size).toBe(3);
    expect(prop?.column_size).toBe(2);
  });

  it("feishuCreateDocChildren：空 children / 超批次 → 同步抛错", async () => {
    const prisma = {} as never;
    const config = {} as never;
    await expect(feishuCreateDocChildren("doc1", [], undefined, prisma, config)).rejects.toThrow(
      /children 不能为空/,
    );
    const tooMany = Array.from({ length: FEISHU_CHILDREN_BATCH_MAX + 1 }, () => ({
      block_type: 2,
      text: { elements: [{ text_run: { content: "x" } }] },
    }));
    await expect(feishuCreateDocChildren("doc1", tooMany, undefined, prisma, config)).rejects.toThrow(
      new RegExp(`最多 ${FEISHU_CHILDREN_BATCH_MAX}`),
    );
  });
});

describe("feishu append native 工具注册", () => {
  beforeAll(() => {
    listNativeTools();
  });

  it("feishu_append_doc_text / feishu_append_doc_blocks 已注册且 reentrant 标记正确", () => {
    const textTool = getTool("feishu_append_doc_text");
    const blocksTool = getTool("feishu_append_doc_blocks");
    expect(textTool).toBeTruthy();
    expect(blocksTool).toBeTruthy();
    expect(textTool?.reentrant).toBe(true);
    expect(textTool?.schema().description).toMatch(/Markdown|原生块/);
    expect(blocksTool?.schema().description).toMatch(/children|画板|block_type/);
  });

  it("feishu_update_doc 描述禁止新建、引导 append", () => {
    const upd = getTool("feishu_update_doc");
    expect(upd?.schema().description).toMatch(/禁止/);
    expect(upd?.schema().description).toMatch(/append_doc/);
  });
});
