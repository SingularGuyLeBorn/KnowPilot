import { describe, it, expect } from "vitest";
import {
  executeSkillInSandbox,
  skillToolName,
  parseSkillToolName,
  buildSkillToolSchema,
} from "../infra/skillRunner.js";
import { makeSkillEntity } from "./helpers/toolTestFixtures.js";

describe("Skill 工具命名", () => {
  it("skillToolName 清理非法字符", () => {
    expect(skillToolName("ui/ux pro")).toBe("skill__ui_ux_pro");
  });

  it("parseSkillToolName 非 skill 名返回 null", () => {
    expect(parseSkillToolName("read_file")).toBeNull();
  });

  it("buildSkillToolSchema 含 description", () => {
    const schema = buildSkillToolSchema(makeSkillEntity({ name: "test", description: "做测试" }));
    expect(schema.function.description).toBe("做测试");
  });
});

describe("Skill TS 沙箱", () => {
  it("执行 run(input) 函数并返回结果", async () => {
    const result = await executeSkillInSandbox(
      makeSkillEntity({
        name: "calc",
        code: `function run(input) { return { doubled: input.length * 2, text: input }; }`,
      }),
      "hello",
    );
    expect(result.mode).toBe("sandbox");
    expect((result.result as { doubled: number }).doubled).toBe(10);
  });

  it("module.exports = run 可执行", async () => {
    const result = await executeSkillInSandbox(
      makeSkillEntity({
        name: "mod",
        code: `module.exports = function run(input) { return input.toUpperCase(); };`,
      }),
      "abc",
    );
    expect(result.result).toBe("ABC");
  });

  it("console.log 写入 logs", async () => {
    const result = await executeSkillInSandbox(
      makeSkillEntity({
        name: "loggy",
        code: `function run(input) { console.log("step", input); return 1; }`,
      }),
      "x",
    );
    expect(result.logs.some((l) => l.includes("step"))).toBe(true);
  });

  it("fenced code block 可被提取执行", async () => {
    const result = await executeSkillInSandbox(
      makeSkillEntity({
        name: "fenced",
        code: "```javascript\nfunction run(input) { return input.split('').reverse().join(''); }\n```",
      }),
      "abc",
    );
    expect(result.result).toBe("cba");
  });

  it("缺少 run 函数时抛错", async () => {
    await expect(
      executeSkillInSandbox(makeSkillEntity({ name: "bad", code: `const x = 1;` }), "hi"),
    ).rejects.toThrow(/run/);
  });
});
