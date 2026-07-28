import { describe, expect, it } from "vitest";
import { parseArxivAtom } from "../infra/tools/native/literature.js";
import fs from "fs";
import path from "path";
import os from "os";
import mammoth from "mammoth";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const TurndownService = require("turndown") as new (opts?: Record<string, unknown>) => {
  turndown(html: string): string;
};

describe("literature parseArxivAtom", () => {
  it("parses a minimal Atom entry", () => {
    const xml = `<?xml version="1.0"?>
<feed>
<entry>
  <id>http://arxiv.org/abs/2301.12345v1</id>
  <title>Hello Diffusion Models</title>
  <summary>An abstract about diffusion.</summary>
  <published>2023-01-15T00:00:00Z</published>
  <author><name>Ada Lovelace</name></author>
  <author><name>Alan Turing</name></author>
</entry>
</feed>`;
    const items = parseArxivAtom(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toContain("Hello Diffusion");
    expect(items[0]!.arxivId).toBe("2301.12345");
    expect(items[0]!.authors).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(items[0]!.year).toBe(2023);
    expect(items[0]!.url).toContain("arxiv.org/abs/2301.12345");
  });
});

describe("docx → markdown via mammoth+turndown", () => {
  it("converts a tiny generated docx-like html path through turndown", () => {
    // mammoth needs a real docx; unit-test the HTML→MD path used by document.ts
    const html = "<h1>Title</h1><p>Hello <strong>world</strong>.</p><ul><li>one</li></ul>";
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    const md = td.turndown(html);
    expect(md).toMatch(/# Title/);
    expect(md).toMatch(/\*\*world\*\*/);
    expect(md).toMatch(/one/);
  });

  it("mammoth convertToHtml is available", async () => {
    // Create minimal valid-ish empty file would fail; just assert API exists
    expect(typeof mammoth.convertToHtml).toBe("function");
    // write a tiny invalid file → mammoth should reject without crashing process
    const tmp = path.join(os.tmpdir(), `kp-docx-${Date.now()}.docx`);
    fs.writeFileSync(tmp, "not-a-docx");
    await expect(mammoth.convertToHtml({ path: tmp })).rejects.toBeTruthy();
    fs.unlinkSync(tmp);
  });
});
