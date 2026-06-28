import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "../trpc/router.js";
import { createContextInner } from "../trpc/context.js";

describe("tRPC Routers CRUD tests", () => {
  let caller: any;

  beforeAll(async () => {
    const ctx = await createContextInner();
    caller = appRouter.createCaller(ctx);
  });

  it("should perform CRUD on Workspace entity", async () => {
    // 1. Create
    const uniqueName = `Test Workspace ${Date.now()}`;
    const uniquePath = `D:/temp/test-workspace-${Date.now()}`;

    const created = await caller.workspace.create({
      name: uniqueName,
      description: "A test workspace created by vitest",
      path: uniquePath,
    });

    expect(created.success).toBe(true);
    expect(created.data).toBeDefined();
    expect(created.data.id).toBeDefined();
    expect(created.data.name).toBe(uniqueName);

    // 2. Read (getById)
    const fetched = await caller.workspace.getById({ id: created.data.id });
    expect(fetched.name).toBe(uniqueName);

    // 3. Read (list)
    const list = await caller.workspace.list({
      page: 1,
      pageSize: 10,
      keyword: "Test",
    });
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    // 4. Update
    const updated = await caller.workspace.update({
      id: created.data.id,
      description: "Updated description",
    });
    expect(updated.success).toBe(true);
    expect(updated.data.description).toBe("Updated description");

    // 5. Delete
    const deleted = await caller.workspace.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    // Verify deletion
    await expect(caller.workspace.getById({ id: created.data.id })).rejects.toThrow();
  });

  it("should perform CRUD on Tool entity", async () => {
    const uniqueName = `Test Tool ${Date.now()}`;

    const created = await caller.tool.create({
      name: uniqueName,
      type: "native",
      description: "A test tool",
      parametersSchema: JSON.stringify({ type: "object", properties: {} }),
    });

    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.name).toBe(uniqueName);

    const fetched = await caller.tool.getById({ id: created.data.id });
    expect(fetched.name).toBe(uniqueName);

    const list = await caller.tool.list({ page: 1, pageSize: 10, keyword: uniqueName });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.tool.update({
      id: created.data.id,
      description: "Updated tool description",
    });
    expect(updated.success).toBe(true);
    expect(updated.data.description).toBe("Updated tool description");

    const deleted = await caller.tool.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.tool.getById({ id: created.data.id })).rejects.toThrow();
  });

  it("should perform CRUD on Run entity", async () => {
    const created = await caller.run.create({
      status: "pending",
      input: { query: "hello" },
    });

    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.status).toBe("pending");

    const fetched = await caller.run.getById({ id: created.data.id });
    expect(fetched.id).toBe(created.data.id);

    const list = await caller.run.list({ page: 1, pageSize: 10 });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.run.update({
      id: created.data.id,
      status: "success",
      output: { result: "done" },
      durationMs: 1234,
    });
    expect(updated.success).toBe(true);
    expect(updated.data.status).toBe("success");

    const deleted = await caller.run.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.run.getById({ id: created.data.id })).rejects.toThrow();
  });

  it("should perform CRUD on Prompt entity", async () => {
    const uniqueName = `Test Prompt ${Date.now()}`;

    const created = await caller.prompt.create({
      name: uniqueName,
      content: "You are a helpful assistant.",
      description: "A test prompt",
      variables: ["userName", "question"],
      tags: ["test", "assistant"],
    });

    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.name).toBe(uniqueName);
    expect(created.data.variables).toContain("userName");
    expect(created.data.tags).toContain("test");

    const fetched = await caller.prompt.getById({ id: created.data.id });
    expect(fetched.name).toBe(uniqueName);

    const list = await caller.prompt.list({ page: 1, pageSize: 10, keyword: uniqueName });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.prompt.update({
      id: created.data.id,
      content: "You are an expert assistant.",
      tags: ["test", "expert"],
    });
    expect(updated.success).toBe(true);
    expect(updated.data.content).toBe("You are an expert assistant.");
    expect(updated.data.tags).toContain("expert");

    const deleted = await caller.prompt.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.prompt.getById({ id: created.data.id })).rejects.toThrow();
  });

  it("should perform CRUD on Credential entity", async () => {
    const uniqueName = `Test Credential ${Date.now()}`;

    const created = await caller.credential.create({
      name: uniqueName,
      type: "api_key",
      value: "sk-test-123",
      scope: ["llm", "mcp"],
    });

    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.name).toBe(uniqueName);
    expect(created.data.scope).toContain("llm");

    const fetched = await caller.credential.getById({ id: created.data.id });
    expect(fetched.name).toBe(uniqueName);

    const list = await caller.credential.list({ page: 1, pageSize: 10, keyword: uniqueName });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.credential.update({
      id: created.data.id,
      value: "sk-updated-456",
      scope: ["llm"],
    });
    expect(updated.success).toBe(true);
    expect(updated.data.value).toBe("sk-updated-456");
    expect(updated.data.scope).toContain("llm");
    expect(updated.data.scope).not.toContain("mcp");

    const deleted = await caller.credential.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.credential.getById({ id: created.data.id })).rejects.toThrow();
  });
});
