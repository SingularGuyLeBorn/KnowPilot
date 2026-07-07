import { describe, it, expect, beforeAll, vi } from "vitest";
import { appRouter } from "../router.js";
import { createContextInner } from "../trpc/context.js";
import * as llmClient from "../infra/llmClient.js";

describe("tRPC Routers Comprehensive CRUD tests (All 18 Entities)", () => {
  let caller: any;

  beforeAll(async () => {
    process.env.REQUIRE_APPROVAL = "false";
    const ctx = await createContextInner();
    caller = appRouter.createCaller(ctx);
  });

  // 1. Post (文章)
  it("should perform CRUD on Post entity", async () => {
    const uniqueSlug = `test-post-slug-${Date.now()}`;
    const uniqueTitle = `Test Post Title ${Date.now()}`;

    // Create
    const created = await caller.post.create({
      title: uniqueTitle,
      slug: uniqueSlug,
      content: "This is a unit test post content.",
      category: "Test Category",
      tags: ["test", "integration"],
      published: true,
    });
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.slug).toBe(uniqueSlug);

    // Read by ID
    const fetchedId = await caller.post.getById({ id: created.data.id });
    expect(fetchedId.title).toBe(uniqueTitle);

    // Read by Slug
    const fetchedSlug = await caller.post.getBySlug({ slug: uniqueSlug });
    expect(fetchedSlug.title).toBe(uniqueTitle);

    // List
    const list = await caller.post.list({ page: 1, pageSize: 10, keyword: "unit test" });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    // Update
    const updated = await caller.post.update({
      id: created.data.id,
      title: `${uniqueTitle} Updated`,
    });
    expect(updated.success).toBe(true);
    expect(updated.data.title).toBe(`${uniqueTitle} Updated`);

    // Delete
    const deleted = await caller.post.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    // Verify deletion
    await expect(caller.post.getById({ id: created.data.id })).rejects.toThrow();
  });

  it("should support post search, tree, and publish filter", async () => {
    const uniqueSlug = `search-test-${Date.now()}`;
    const created = await caller.post.create({
      title: `Searchable Alpha ${Date.now()}`,
      slug: uniqueSlug,
      content: "keyword: galaxy-search-marker",
      published: true,
    });
    expect(created.success).toBe(true);

    const search = await caller.post.search({ query: "galaxy-search-marker", limit: 5 });
    expect(search.some((p: { id: string }) => p.id === created.data.id)).toBe(true);

    const draft = await caller.post.create({
      title: `Draft Beta ${Date.now()}`,
      slug: `draft-${uniqueSlug}`,
      content: "draft-only",
      published: false,
    });
    expect(draft.success).toBe(true);

    const draftList = await caller.post.list({ page: 1, pageSize: 10, published: false, keyword: "Draft Beta" });
    expect(draftList.items.some((item: { id: string }) => item.id === draft.data.id)).toBe(true);

    const tree = await caller.post.tree();
    expect(tree.some((p: { slug: string }) => p.slug === uniqueSlug)).toBe(true);

    await caller.post.delete({ id: created.data.id });
    await caller.post.delete({ id: draft.data.id });
  });

  // 2. Agent (智能体)
  it("should perform CRUD on Agent entity", async () => {
    const uniqueName = `Test Agent ${Date.now()}`;

    const created = await caller.agent.create({
      name: uniqueName,
      description: "Unit test agent description",
      model: "deepseek-chat",
      systemPrompt: "You are a test helper",
      tools: ["fetchWeb", "execCode"],
    });
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.name).toBe(uniqueName);

    const fetched = await caller.agent.getById({ id: created.data.id });
    expect(fetched.name).toBe(uniqueName);

    const list = await caller.agent.list({ page: 1, pageSize: 10, keyword: uniqueName });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.agent.update({
      id: created.data.id,
      description: "Updated agent description",
    });
    expect(updated.success).toBe(true);
    expect(updated.data.description).toBe("Updated agent description");

    const deleted = await caller.agent.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.agent.getById({ id: created.data.id })).rejects.toThrow();
  });

  // 3. Skill (技能)
  it("should perform CRUD on Skill entity", async () => {
    const uniqueName = `Test Skill ${Date.now()}`;

    const created = await caller.skill.create({
      name: uniqueName,
      description: "Unit test skill description",
      code: "export function test() { return 42; }",
      icon: "Wand2",
      trigger: "on_save",
      enabled: true,
    });
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.name).toBe(uniqueName);

    const fetched = await caller.skill.getById({ id: created.data.id });
    expect(fetched.name).toBe(uniqueName);

    const list = await caller.skill.list({ page: 1, pageSize: 10, keyword: uniqueName });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.skill.update({
      id: created.data.id,
      description: "Updated skill description",
    });
    expect(updated.success).toBe(true);
    expect(updated.data.description).toBe("Updated skill description");

    const deleted = await caller.skill.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.skill.getById({ id: created.data.id })).rejects.toThrow();
  });

  // 4. McpServer (MCP服务器)
  it("should perform CRUD on McpServer entity", async () => {
    const uniqueName = `Test Mcp ${Date.now()}`;

    const created = await caller.mcp.create({
      name: uniqueName,
      command: "node",
      args: ["test.js"],
      env: { TEST_ENV_VAR: "1" },
      enabled: true,
    });
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.name).toBe(uniqueName);

    const fetched = await caller.mcp.getById({ id: created.data.id });
    expect(fetched.name).toBe(uniqueName);

    const list = await caller.mcp.list({ page: 1, pageSize: 10, keyword: uniqueName });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.mcp.update({
      id: created.data.id,
      command: "bun",
    });
    expect(updated.success).toBe(true);
    expect(updated.data.command).toBe("bun");

    const deleted = await caller.mcp.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.mcp.getById({ id: created.data.id })).rejects.toThrow();
  });

  // 5. Memory (长期记忆)
  it("should perform CRUD on Memory entity", async () => {
    const uniqueContent = `Test Memory Content ${Date.now()}`;

    const created = await caller.memory.create({
      content: uniqueContent,
      type: "episodic",
      strength: 0.9,
      keywords: ["test", "memory"],
    });
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.content).toBe(uniqueContent);

    const fetched = await caller.memory.getById({ id: created.data.id });
    expect(fetched.content).toBe(uniqueContent);

    const list = await caller.memory.list({ page: 1, pageSize: 10, keyword: "Memory" });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.memory.update({
      id: created.data.id,
      strength: 0.5,
    });
    expect(updated.success).toBe(true);
    expect(updated.data.strength).toBe(0.5);

    const deleted = await caller.memory.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.memory.getById({ id: created.data.id })).rejects.toThrow();
  });

  // 6 & 7. ChatSession & ChatMessage (会话与消息)
  it("should perform CRUD on ChatSession and ChatMessage entities", async () => {
    const sessionTitle = `Test Session ${Date.now()}`;

    // Session Create
    const sessionCreated = await caller.session.create({
      title: sessionTitle,
      model: "deepseek-chat",
      systemPrompt: "Test System Prompt",
    });
    expect(sessionCreated.success).toBe(true);
    expect(sessionCreated.data.id).toBeDefined();

    // Message Create
    const msgCreated = await caller.message.create({
      sessionId: sessionCreated.data.id,
      role: "user",
      content: "Hello from Vitest!",
    });
    expect(msgCreated.success).toBe(true);
    expect(msgCreated.data.id).toBeDefined();
    expect(msgCreated.data.sessionId).toBe(sessionCreated.data.id);

    // List Messages for Session
    const msgList = await caller.message.list({ sessionId: sessionCreated.data.id, page: 1, pageSize: 10 });
    expect(msgList.items.some((msg: any) => msg.id === msgCreated.data.id)).toBe(true);

    // Message Update
    const msgUpdated = await caller.message.update({
      id: msgCreated.data.id,
      content: "Hello from Vitest Updated!",
    });
    expect(msgUpdated.success).toBe(true);
    expect(msgUpdated.data.content).toBe("Hello from Vitest Updated!");

    // Session Update
    const sessionUpdated = await caller.session.update({
      id: sessionCreated.data.id,
      title: `${sessionTitle} Updated`,
    });
    expect(sessionUpdated.success).toBe(true);
    expect(sessionUpdated.data.title).toBe(`${sessionTitle} Updated`);

    // Message Delete
    const msgDeleted = await caller.message.delete({ id: msgCreated.data.id });
    expect(msgDeleted.success).toBe(true);

    // Session Delete
    const sessionDeleted = await caller.session.delete({ id: sessionCreated.data.id });
    expect(sessionDeleted.success).toBe(true);

    await expect(caller.session.getById({ id: sessionCreated.data.id })).rejects.toThrow();
  });

  // 8. File (文件带 Base64 上传)
  it("should perform CRUD on File entity including upload", async () => {
    const testFileName = `vitest-test-file-${Date.now()}.txt`;
    const dummyBase64 = Buffer.from("Hello from KnowPilot file upload test!").toString("base64");

    // Test upload
    const uploaded = await caller.file.upload({
      name: testFileName,
      mimeType: "text/plain",
      size: 40,
      data: dummyBase64,
    });
    expect(uploaded.success).toBe(true);
    expect(uploaded.data.id).toBeDefined();
    expect(uploaded.data.name).toBe(testFileName);
    expect(uploaded.data.url).toContain("/uploads/");

    // GetById
    const fetched = await caller.file.getById({ id: uploaded.data.id });
    expect(fetched.name).toBe(testFileName);

    // List
    const list = await caller.file.list({ page: 1, pageSize: 10, keyword: "vitest-test" });
    expect(list.items.some((item: any) => item.id === uploaded.data.id)).toBe(true);

    // Update
    const updated = await caller.file.update({
      id: uploaded.data.id,
      name: `updated-${testFileName}`,
    });
    expect(updated.success).toBe(true);
    expect(updated.data.name).toBe(`updated-${testFileName}`);

    // Delete
    const deleted = await caller.file.delete({ id: uploaded.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.file.getById({ id: uploaded.data.id })).rejects.toThrow();
  });

  // 9. Log (日志)
  it("should perform CRUD on Log entity", async () => {
    const uniqueMsg = `Test Log Message ${Date.now()}`;

    const created = await caller.log.create({
      level: "info",
      component: "test-suite",
      event: "vitest.test",
      message: uniqueMsg,
      metadata: { debug: true },
    });
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.message).toBe(uniqueMsg);

    const fetched = await caller.log.getById({ id: created.data.id });
    expect(fetched.message).toBe(uniqueMsg);

    const list = await caller.log.list({ page: 1, pageSize: 10, keyword: uniqueMsg });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.log.update({
      id: created.data.id,
      message: `${uniqueMsg} Updated`,
    });
    expect(updated.success).toBe(true);
    expect(updated.data.message).toBe(`${uniqueMsg} Updated`);

    const deleted = await caller.log.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.log.getById({ id: created.data.id })).rejects.toThrow();
  });

  // 10. GitRepo (Git仓库)
  it("should perform CRUD on GitRepo entity", async () => {
    // 安全：GitRepo.path 必须在 projectRoot 之内（绝对路径会被 resolveSafePath 拒绝）
    const uniquePath = `tmp/test-git-${Date.now()}`;
    const uniqueName = `Git Test ${Date.now()}`;

    const created = await caller.git.create({
      name: uniqueName,
      path: uniquePath,
      branch: "develop",
      remoteUrl: "https://github.com/knowpilot/git-test.git",
    });
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.path).toBe(uniquePath);

    const fetched = await caller.git.getById({ id: created.data.id });
    expect(fetched.path).toBe(uniquePath);

    const list = await caller.git.list({ page: 1, pageSize: 10 });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.git.update({
      id: created.data.id,
      branch: "main",
    });
    expect(updated.success).toBe(true);
    expect(updated.data.branch).toBe("main");

    const deleted = await caller.git.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.git.getById({ id: created.data.id })).rejects.toThrow();
  });

  it("should reject GitRepo with absolute path or .. traversal (P0-3 沙箱)", async () => {
    // 绝对路径：Zod 放行但 resolveSafePath 拒绝 → 返回 success:false
    const absRes = await caller.git.create({ name: "abs-path", path: "D:/Windows", branch: "main" });
    expect(absRes.success).toBe(false);
    // .. 穿越：Zod 直接拒绝 → 抛 TRPCError
    await expect(
      caller.git.create({ name: "traversal", path: "../escape", branch: "main" }),
    ).rejects.toThrow();
  });

  it("should require approval for git.commit / git.pull (P0-4 反射面收紧)", async () => {
    // 无 approvalId → 触发待审批，抛 FORBIDDEN
    await expect(
      caller.git.commit({ repoPath: "tmp/p0-4-test", message: "should require approval" }),
    ).rejects.toThrow();
    await expect(
      caller.git.pull({ repoPath: "tmp/p0-4-test" }),
    ).rejects.toThrow();
  });

  // 11. Task (任务)
  it("should perform CRUD on Task entity", async () => {
    const uniqueName = `Test Task ${Date.now()}`;

    const created = await caller.task.create({
      name: uniqueName,
      type: "oneshot",
      status: "pending",
      input: { url: "http://example.com" },
    });
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.name).toBe(uniqueName);

    const fetched = await caller.task.getById({ id: created.data.id });
    expect(fetched.name).toBe(uniqueName);

    const list = await caller.task.list({ page: 1, pageSize: 10, keyword: uniqueName });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.task.update({
      id: created.data.id,
      status: "running",
    });
    expect(updated.success).toBe(true);
    expect(updated.data.status).toBe("running");

    const deleted = await caller.task.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.task.getById({ id: created.data.id })).rejects.toThrow();
  });

  // 12. Workspace (工作区)
  it("should perform CRUD on Workspace entity", async () => {
    const uniqueName = `Test Workspace ${Date.now()}`;
    const uniquePath = `D:/temp/test-workspace-${Date.now()}`;

    const created = await caller.workspace.create({
      name: uniqueName,
      description: "A test workspace created by vitest",
      path: uniquePath,
    });

    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.name).toBe(uniqueName);

    const fetched = await caller.workspace.getById({ id: created.data.id });
    expect(fetched.name).toBe(uniqueName);

    const list = await caller.workspace.list({
      page: 1,
      pageSize: 10,
      keyword: "Test",
    });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.workspace.update({
      id: created.data.id,
      description: "Updated description",
    });
    expect(updated.success).toBe(true);
    expect(updated.data.description).toBe("Updated description");

    const deleted = await caller.workspace.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.workspace.getById({ id: created.data.id })).rejects.toThrow();
  });

  // 13. Trigger (触发器)
  it("should perform CRUD on Trigger entity", async () => {
    const uniqueName = `Test Trigger ${Date.now()}`;

    const created = await caller.trigger.create({
      name: uniqueName,
      type: "file_change",
      source: "post.created",
      actionType: "run_task",
      actionId: "some-dummy-task-id",
      enabled: true,
    });
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.name).toBe(uniqueName);

    const fetched = await caller.trigger.getById({ id: created.data.id });
    expect(fetched.name).toBe(uniqueName);

    const list = await caller.trigger.list({ page: 1, pageSize: 10, keyword: uniqueName });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.trigger.update({
      id: created.data.id,
      enabled: false,
    });
    expect(updated.success).toBe(true);
    expect(updated.data.enabled).toBe(false);

    const deleted = await caller.trigger.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.trigger.getById({ id: created.data.id })).rejects.toThrow();
  });

  // 14. Approval (审批队列)
  it("should perform CRUD on Approval entity", async () => {
    const created = await caller.approval.create({
      toolName: "test.tool",
      args: { input: "ok" },
      status: "pending",
    });
    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.toolName).toBe("test.tool");

    const fetched = await caller.approval.getById({ id: created.data.id });
    expect(fetched.toolName).toBe("test.tool");

    const list = await caller.approval.list({ page: 1, pageSize: 10, status: "pending" });
    expect(list.items.some((item: any) => item.id === created.data.id)).toBe(true);

    const updated = await caller.approval.update({
      id: created.data.id,
      status: "approved",
    });
    expect(updated.success).toBe(true);
    expect(updated.data.status).toBe("approved");

    const deleted = await caller.approval.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.approval.getById({ id: created.data.id })).rejects.toThrow();
  });

  it("should require approval for agent.delete and execute after approve", async () => {
    process.env.REQUIRE_APPROVAL = "true";

    const agent = await caller.agent.create({
      name: `ApprovalGate_${Date.now()}`,
      description: "approval gate test",
      tools: ["skill:*"],
      model: "deepseek-chat",
    });
    expect(agent.success).toBe(true);
    const agentId = agent.data!.id;

    await expect(caller.agent.delete({ id: agentId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const pending = await caller.approval.list({ page: 1, pageSize: 20, status: "pending" });
    const record = pending.items.find(
      (item: { toolName: string; args: { id?: string } }) =>
        item.toolName === "agent.delete" && item.args?.id === agentId,
    );
    expect(record).toBeDefined();

    const executed = await caller.approval.approveAndExecute({ id: record!.id });
    expect(executed.success).toBe(true);

    await expect(caller.agent.getById({ id: agentId })).rejects.toThrow();

    process.env.REQUIRE_APPROVAL = "false";
  });

  it("should run task with db:sync action", async () => {
    const task = await caller.task.create({
      name: `SyncTask_${Date.now()}`,
      type: "oneshot",
      status: "pending",
      input: { action: "db:sync" },
    });
    expect(task.success).toBe(true);

    const run = await caller.task.run({ id: task.data!.id });
    expect(run.success).toBe(true);
    expect(run.data?.status).toBe("success");
  }, 120_000);

  // 15. Tool (工具注册表)
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

  // 16. Run (Agent执行记录)
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

  // 17. Prompt (提示词模板)
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

  // 18. Credential (凭据管理)
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
    // 安全：update 返回遮蔽预览而非明文，末 4 位应保留
    expect(updated.data.valuePreview).toBe("sk-u••••-456");
    expect((updated.data as any).value).toBeUndefined();
    expect(updated.data.scope).toContain("llm");
    expect(updated.data.scope).not.toContain("mcp");

    const deleted = await caller.credential.delete({ id: created.data.id });
    expect(deleted.success).toBe(true);

    await expect(caller.credential.getById({ id: created.data.id })).rejects.toThrow();
  });

  it("should expose agent.llmProviders and native.list for runtime", async () => {
    const providers = await caller.agent.llmProviders();
    expect(Array.isArray(providers)).toBe(true);

    const nativeTools = await caller.native.list();
    expect(nativeTools.length).toBeGreaterThan(0);
    expect(nativeTools.some((t: { name: string }) => t.name === "web_search")).toBe(true);
  });

  it("native.capabilities 应返回运行时能力及 infoSources 计数", async () => {
    const caps = await caller.native.capabilities();
    expect(Array.isArray(caps.search.engines)).toBe(true);
    expect(typeof caps.readArticle.cookies.zhihu).toBe("boolean");
    expect(typeof caps.infoSources?.enabled).toBe("number");
  });

  it("agent.chat 失败时仍保留 sessionId，用户消息不丢失", async () => {
    const spy = vi.spyOn(llmClient, "chatCompletion").mockRejectedValueOnce(
      new Error("LLM mock failure for unit test"),
    );

    try {
      const res = await caller.agent.chat({
        message: `test-fail-${Date.now()}`,
        model: "deepseek-v4-flash",
      });

      expect(res.success).toBe(false);
      expect(res.state?.sessionId).toBeTruthy();

      const sessionId = res.state!.sessionId as string;
      const session = await caller.session.getById({ id: sessionId });
      expect(session.messages?.some((m: { role: string }) => m.role === "user")).toBe(true);

      await caller.session.delete({ id: sessionId });
    } finally {
      spy.mockRestore();
    }
  }, 15_000);

  it("should search globally across entities", async () => {
    const result = await caller.search.global({ query: "KnowPilot", limit: 10 });
    expect(result.tookMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.hits)).toBe(true);
  });

  it("should return analytics dashboard metrics", async () => {
    const dash = await caller.analytics.dashboard({});
    expect(typeof dash.posts.total).toBe("number");
    expect(typeof dash.agents.total).toBe("number");
    expect(typeof dash.runs.total).toBe("number");
  });

  it("should load about profile from content/about/profile.md", async () => {
    const profile = await caller.about.getProfile();
    expect(profile.name).toBeTruthy();
    expect(Array.isArray(profile.focus)).toBe(true);
    expect(typeof profile.bodyMarkdown).toBe("string");
  });

  it("should expose auth.status for remote access info", async () => {
    const status = await caller.auth.status();
    expect(typeof status.enabled).toBe("boolean");
    expect(typeof status.authenticated).toBe("boolean");
    expect(status.remote).toBeDefined();
  });
});
