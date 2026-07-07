/**
 * ServiceContainer — 服务容器（IoC）
 *
 * 统一管理所有 Service 的实例化和依赖注入。
 * 通过 tRPC Context 注入到每个请求中。
 */

import type { PrismaClient } from "@prisma/client";
import type { AppEventBus } from "./eventBus.js";
import type { AppConfig } from "./config.js";

// Service imports
import {
  PostService,
  AgentService,
  SkillService,
  McpService,
  MemoryService,
  SessionService,
  MessageService,
  FileService,
  LogService,
  GitService,
  TaskService,
  WorkspaceService,
  TriggerService,
  ApprovalService,
  ToolService,
  RunService,
  PromptService,
  CredentialService,
  InfoSourceService,
} from "../services.js";

export class ServiceContainer {
  readonly prisma: PrismaClient;
  readonly post: PostService;
  readonly agent: AgentService;
  readonly skill: SkillService;
  readonly mcp: McpService;
  readonly memory: MemoryService;
  readonly session: SessionService;
  readonly message: MessageService;
  readonly file: FileService;
  readonly log: LogService;
  readonly git: GitService;
  readonly task: TaskService;
  readonly workspace: WorkspaceService;
  readonly trigger: TriggerService;
  readonly approval: ApprovalService;
  readonly tool: ToolService;
  readonly run: RunService;
  readonly prompt: PromptService;
  readonly credential: CredentialService;
  readonly infoSource: InfoSourceService;

  constructor(prisma: PrismaClient, eventBus: AppEventBus, config: AppConfig) {
    this.prisma = prisma;
    this.post = new PostService(prisma, eventBus, config);
    this.agent = new AgentService(prisma, eventBus, config);
    this.skill = new SkillService(prisma, eventBus, config);
    this.mcp = new McpService(prisma, eventBus, config);
    this.memory = new MemoryService(prisma, eventBus, config);
    this.session = new SessionService(prisma, eventBus, config);
    this.message = new MessageService(prisma, eventBus, config);
    this.file = new FileService(prisma, eventBus, config);
    this.log = new LogService(prisma, eventBus, config);
    this.git = new GitService(prisma, eventBus, config);
    this.task = new TaskService(prisma, eventBus, config);
    this.workspace = new WorkspaceService(prisma, eventBus, config);
    this.trigger = new TriggerService(prisma, eventBus, config);
    this.approval = new ApprovalService(prisma, eventBus, config);
    this.tool = new ToolService(prisma, eventBus, config);
    this.run = new RunService(prisma, eventBus, config);
    this.prompt = new PromptService(prisma, eventBus, config);
    this.credential = new CredentialService(prisma, eventBus, config);
    this.infoSource = new InfoSourceService(prisma, eventBus, config);
  }
}

/* ─── 全局单例 ─── */

let _container: ServiceContainer | null = null;

export function getServiceContainer(
  prisma: PrismaClient,
  eventBus: AppEventBus,
  config: AppConfig,
): ServiceContainer {
  if (!_container) {
    _container = new ServiceContainer(prisma, eventBus, config);
  }
  return _container;
}
