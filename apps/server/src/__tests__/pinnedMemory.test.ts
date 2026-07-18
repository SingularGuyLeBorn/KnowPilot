/**
 * L1 常驻层：硬预算截断 + 会话冻结快照
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  PINNED_MEMORY_USER_MAX_CHARS,
  PINNED_MEMORY_DIR,
  PINNED_MEMORY_USER_FILE,
} from "@knowpilot/shared";
import {
  truncatePinned,
  formatPinnedHint,
  loadPinnedFromDisk,
  writePinnedFile,
  ensurePinnedMemoryHint,
} from "../infra/pinnedMemory.js";
import { prisma } from "../db.js";
import { getServiceContainer, resetServiceContainerForTests } from "../infra/serviceContainer.js";
import { getEventBus } from "../infra/eventBus.js";
import { getAppConfig } from "../infra/config.js";

describe("truncatePinned / formatPinnedHint", () => {
  it("超预算截断并标记", () => {
    const long = "甲".repeat(PINNED_MEMORY_USER_MAX_CHARS + 50);
    const { text, truncated } = truncatePinned(long, PINNED_MEMORY_USER_MAX_CHARS);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(PINNED_MEMORY_USER_MAX_CHARS + 20);
    expect(text).toContain("已截断");
  });

  it("空内容不产出常驻节", () => {
    expect(formatPinnedHint("", "")).toBe("");
    expect(formatPinnedHint("偏好", "")).toContain("USER");
    expect(formatPinnedHint("", "约定")).toContain("AGENT");
  });
});

describe("磁盘读写 + 会话冻结", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kp-pinned-"));
  let sessionId = "";
  let services: ReturnType<typeof getServiceContainer>;

  beforeAll(async () => {
    resetServiceContainerForTests();
    services = getServiceContainer(prisma, getEventBus(), {
      ...getAppConfig(),
      projectRoot: tmpRoot,
    });
    const dir = path.join(tmpRoot, PINNED_MEMORY_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, PINNED_MEMORY_USER_FILE), "初始用户偏好-v1\n", "utf-8");
    const created = await services.session.create({
      title: "pinned-freeze-test",
      model: "deepseek-v4-flash",
    });
    sessionId = created.data!.id;
  });

  afterAll(async () => {
    if (sessionId) await services.session.delete(sessionId).catch(() => undefined);
    resetServiceContainerForTests();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("首轮冻结后写盘不改变本会话快照", async () => {
    const first = await ensurePinnedMemoryHint(services, sessionId);
    expect(first).toContain("初始用户偏好-v1");

    writePinnedFile(tmpRoot, "user", "改写后的偏好-v2");
    const disk = loadPinnedFromDisk(tmpRoot);
    expect(disk.user).toContain("改写后的偏好-v2");

    const second = await ensurePinnedMemoryHint(services, sessionId);
    expect(second).toBe(first);
    expect(second).toContain("初始用户偏好-v1");
    expect(second).not.toContain("改写后的偏好-v2");
  });
});
