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

    expect(created.id).toBeDefined();
    expect(created.name).toBe(uniqueName);

    // 2. Read (getById)
    const fetched = await caller.workspace.getById({ id: created.id });
    expect(fetched.name).toBe(uniqueName);

    // 3. Read (list)
    const list = await caller.workspace.list({
      page: 1,
      pageSize: 10,
      keyword: "Test",
    });
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.some((item: any) => item.id === created.id)).toBe(true);

    // 4. Update
    const updated = await caller.workspace.update({
      id: created.id,
      description: "Updated description",
    });
    expect(updated.description).toBe("Updated description");

    // 5. Delete
    const deleted = await caller.workspace.delete({ id: created.id });
    expect(deleted.success).toBe(true);

    // Verify deletion
    await expect(caller.workspace.getById({ id: created.id })).rejects.toThrow();
  });
});
