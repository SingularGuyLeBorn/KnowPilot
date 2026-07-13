/**
 * LoopContract 纯逻辑单测（不依赖 Prisma / LLM）
 */

import { describe, it, expect } from "vitest";
import {
  closeLoopGate,
  ensureLoopContract,
  evidenceFingerprint,
  recordEvidence,
  resumeLoopContract,
  shouldSkipHeartbeat,
} from "../infra/loopContract.js";

describe("LoopContract", () => {
  it("ensureLoopContract 缺省可跑", () => {
    const c = ensureLoopContract("整理收件箱", null, { maxStaleRounds: 3, maxEvidence: 10 });
    expect(c.goal).toBe("整理收件箱");
    expect(c.handoff).toBe(true);
    expect(c.gateOpen).toBe(true);
    expect(c.staleRounds).toBe(0);
    expect(shouldSkipHeartbeat(c).skip).toBe(false);
  });

  it("gate 关闭或 handoff=false 时跳过心跳", () => {
    const c = ensureLoopContract("g", null);
    expect(shouldSkipHeartbeat(closeLoopGate(c)).skip).toBe(true);
    expect(shouldSkipHeartbeat({ ...c, handoff: false, stoppedReason: "x" }).reason).toMatch(/handoff/);
  });

  it("连续相同 evidence 触发 stopRule", () => {
    let c = ensureLoopContract("g", null, { maxStaleRounds: 3, maxEvidence: 20 });
    const summary = "无新事项";
    // 第 1 轮：新 evidence → stale=0；随后 3 轮相同 → stale=3 触发 stop
    for (let i = 0; i < 4; i++) {
      c = recordEvidence(
        c,
        { at: new Date(i).toISOString(), summary, status: "success" },
        { maxStaleRounds: 3, maxEvidence: 20 },
      );
    }
    expect(c.staleRounds).toBe(3);
    expect(c.handoff).toBe(false);
    expect(c.stoppedReason).toMatch(/stopRule/);
    expect(shouldSkipHeartbeat(c).skip).toBe(true);
  });

  it("新 fingerprint 清零 staleRounds", () => {
    let c = ensureLoopContract("g", null, { maxStaleRounds: 3, maxEvidence: 20 });
    c = recordEvidence(c, { at: "1", summary: "A", status: "success" });
    c = recordEvidence(c, { at: "2", summary: "A", status: "success" });
    expect(c.staleRounds).toBe(1);
    c = recordEvidence(c, { at: "3", summary: "B-new", status: "success" });
    expect(c.staleRounds).toBe(0);
    expect(c.handoff).toBe(true);
  });

  it("失败不算进展（stale++）", () => {
    let c = ensureLoopContract("g", null, { maxStaleRounds: 2, maxEvidence: 10 });
    c = recordEvidence(c, { at: "1", summary: "boom", status: "failed" });
    c = recordEvidence(c, { at: "2", summary: "boom2", status: "failed" });
    expect(c.handoff).toBe(false);
  });

  it("resume 恢复 gate/handoff", () => {
    const stopped = closeLoopGate(ensureLoopContract("g", null), "人工");
    const r = resumeLoopContract(stopped);
    expect(r.gateOpen).toBe(true);
    expect(r.handoff).toBe(true);
    expect(r.stoppedReason).toBeNull();
    expect(r.staleRounds).toBe(0);
  });

  it("evidenceFingerprint 稳定", () => {
    expect(evidenceFingerprint("  Hello   World ")).toBe(evidenceFingerprint("hello world"));
  });
});
