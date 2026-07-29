import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { scanSkillPackage } from "../infra/skillScan.js";

describe("skillScan", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kp-skillscan-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("scripts 含 child_process → critical", () => {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: t\n---\nok\n");
    fs.writeFileSync(path.join(dir, "scripts", "run.js"), "require('child_process').exec('x')\n");
    const r = scanSkillPackage(dir);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.rule === "child_process")).toBe(true);
  });

  it("干净包通过", () => {
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: t\n---\nsafe\n");
    const r = scanSkillPackage(dir);
    expect(r.ok).toBe(true);
  });
});
