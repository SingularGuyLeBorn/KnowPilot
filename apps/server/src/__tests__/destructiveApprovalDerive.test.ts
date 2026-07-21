/**
 * D6：destructive 审批清单从 registry 派生，禁止硬编码漂移
 *
 * 负向断言（旧硬编码 Set 红 → 派生后绿）：
 * - agent_delete_sub 标 destructive 但不在旧清单 → AGENT_DESTRUCTIVE_APPROVAL=true 时必须触发审批
 * - 派生集合 === registry 上 destructive && !approvalExempt
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { listNativeTools } from "../infra/nativeTools.js";
import {
  listTools,
  listDestructiveNativeOpsForApproval,
} from "../infra/tools/registry.js";
import {
  toolRequiresApproval,
  getDestructiveNativeOps,
} from "../infra/approvalGate.js";

describe("D6 destructive 审批清单派生", () => {
  const prevDestructive = process.env.AGENT_DESTRUCTIVE_APPROVAL;
  const prevRequire = process.env.REQUIRE_APPROVAL;

  beforeAll(() => {
    // 触发 ensureNativeToolsRegistered，不清空全局 registry（避免污染并行用例）
    expect(listNativeTools().length).toBeGreaterThan(0);
  });

  beforeEach(() => {
    delete process.env.REQUIRE_APPROVAL;
    delete process.env.AGENT_DESTRUCTIVE_APPROVAL;
  });

  afterEach(() => {
    if (prevDestructive === undefined) delete process.env.AGENT_DESTRUCTIVE_APPROVAL;
    else process.env.AGENT_DESTRUCTIVE_APPROVAL = prevDestructive;
    if (prevRequire === undefined) delete process.env.REQUIRE_APPROVAL;
    else process.env.REQUIRE_APPROVAL = prevRequire;
  });

  it("agent_delete_sub 在 AGENT_DESTRUCTIVE_APPROVAL=true 时必须触发审批", () => {
    process.env.AGENT_DESTRUCTIVE_APPROVAL = "true";
    const tool = listTools("native").find((t) => t.name === "agent_delete_sub");
    expect(tool?.destructive).toBe(true);
    expect(tool?.approvalExempt).not.toBe(true);
    expect(toolRequiresApproval("agent_delete_sub")).toBe(true);
  });

  it("派生清单与 registry destructive&&!approvalExempt 集合相等", () => {
    const fromRegistry = listDestructiveNativeOpsForApproval();
    const fromGate = getDestructiveNativeOps();
    expect([...fromGate].sort()).toEqual([...fromRegistry].sort());

    const expected = new Set(
      listTools("native")
        .filter((t) => t.destructive === true && t.approvalExempt !== true)
        .map((t) => t.name),
    );
    expect([...fromRegistry].sort()).toEqual([...expected].sort());
    expect(fromRegistry.has("agent_delete_sub")).toBe(true);
    expect(fromRegistry.has("agent_delete")).toBe(true);
    // 豁免的创建/写入类不得入清单
    expect(fromRegistry.has("write_file")).toBe(false);
    expect(fromRegistry.has("memory_create")).toBe(false);
  });

  it("默认关闭 destructive 时 agent_delete_sub 不拦", () => {
    expect(toolRequiresApproval("agent_delete_sub")).toBe(false);
  });
});
