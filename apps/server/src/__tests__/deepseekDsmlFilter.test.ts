import { describe, it, expect } from "vitest";
import {
  DsmlStreamFilter,
  looksLikeDsmlLeak,
  stripDsmlToolMarkup,
} from "../infra/deepseekDsmlFilter.js";

const LEAK_FW =
  `<｜DSML｜tool_calls><｜DSML｜invoke name="web_search"><｜DSML｜parameter name="query" string>true</｜DSML｜parameter>llm-interview</｜DSML｜invoke></｜DSML｜tool_calls>`;

const LEAK_ASCII =
  `<|DSML|tool_calls><|DSML|invoke name="web_search"><|DSML|parameter name="query" string>true</|DSML|parameter>q</|DSML|invoke></|DSML|tool_calls>`;

describe("stripDsmlToolMarkup", () => {
  it("去掉全角 DSML tool_calls 块，保留正文", () => {
    expect(stripDsmlToolMarkup(`先看看目录\n${LEAK_FW}\n然后继续`)).toBe("先看看目录\n\n然后继续");
  });

  it("去掉 ASCII DSML 块", () => {
    expect(stripDsmlToolMarkup(`hi${LEAK_ASCII}bye`)).toBe("hibye");
  });

  it("无 DSML 时原样返回", () => {
    expect(stripDsmlToolMarkup("普通回复")).toBe("普通回复");
  });
});

describe("DsmlStreamFilter", () => {
  it("跨 chunk 泄漏：不向外发 DSML 碎片", () => {
    const f = new DsmlStreamFilter();
    const parts = ["\n\n", "<", "｜DSML｜", "tool_calls>", '<｜DSML｜invoke name="web_search">', "x", "</｜DSML｜tool_calls>"];
    let out = "";
    for (const p of parts) out += f.push(p);
    out += f.flush();
    expect(out).not.toMatch(/DSML/i);
    expect(looksLikeDsmlLeak(out)).toBe(false);
  });

  it("见到 structured tool_calls 后丢弃后续 DSML content", () => {
    const f = new DsmlStreamFilter();
    expect(f.push("正文")).toBe("正文");
    f.markStructuredToolCalls();
    expect(f.push(LEAK_FW)).toBe("");
  });

  it("普通文本含单独 < 不误吞", () => {
    const f = new DsmlStreamFilter();
    expect(f.push("a < b")).toBe("a < b");
    expect(f.flush()).toBe("");
  });
});
