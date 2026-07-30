/**
 * McpServer Service（FileSync，从 services.ts 拆出的叶子）。
 */

import type {
  CreateMcpServerInput,
  UpdateMcpServerInput,
  ListMcpServersInput,
} from "@knowpilot/shared";
import { FileSyncService, ServiceValidationError } from "../../services.js";
import { failure } from "../../trpc/result.js";

/** McpServer MCP 数据源服务器 */
export interface McpServerEntity {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string | null;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class McpService extends FileSyncService<CreateMcpServerInput, UpdateMcpServerInput, ListMcpServersInput, McpServerEntity> {
  readonly entityName = "mcp";
  readonly contentDirName = "mcp";
  readonly fileExtension = ".json";

  protected get delegate() { return this.prisma.mcpServer; }

  protected formatEntity(raw: any): McpServerEntity {
    const transport = raw.transport === "http" ? "http" : "stdio";
    return {
      ...raw,
      transport,
      command: raw.command ?? "",
      args: typeof raw.args === "string" ? JSON.parse(raw.args) : (raw.args || []),
      env: typeof raw.env === "string" ? JSON.parse(raw.env) : (raw.env || {}),
      url: raw.url ?? null,
      headers: typeof raw.headers === "string" ? JSON.parse(raw.headers) : (raw.headers || {}),
    };
  }

  protected buildListWhere(input: ListMcpServersInput): any {
    const where: any = {};
    if (input.keyword) {
      where.OR = [
        { name: { contains: input.keyword } },
        { command: { contains: input.keyword } },
        { url: { contains: input.keyword } },
      ];
    }
    return where;
  }

  protected buildCreateData(input: CreateMcpServerInput): any {
    return {
      name: input.name,
      transport: input.transport ?? "stdio",
      command: input.command ?? "",
      args: JSON.stringify(input.args ?? []),
      env: JSON.stringify(input.env ?? {}),
      url: input.url?.trim() || null,
      headers: JSON.stringify(input.headers ?? {}),
      enabled: input.enabled,
    };
  }

  protected buildUpdateData(input: UpdateMcpServerInput): any {
    const { id: _id, args, env, headers, ...data } = input;
    const updateData: any = { ...data };
    if (args !== undefined) updateData.args = JSON.stringify(args);
    if (env !== undefined) updateData.env = JSON.stringify(env);
    if (headers !== undefined) updateData.headers = JSON.stringify(headers);
    if (input.url !== undefined) updateData.url = input.url?.trim() || null;
    return updateData;
  }

  protected serializeToFile(entity: McpServerEntity): string {
    const body: Record<string, unknown> = {
      name: entity.name,
      transport: entity.transport,
      enabled: entity.enabled,
    };
    if (entity.transport === "http") {
      body.url = entity.url;
      body.headers = entity.headers ?? {};
      if (entity.command) body.command = entity.command;
    } else {
      body.command = entity.command;
      body.args = entity.args;
      body.env = entity.env;
    }
    return JSON.stringify(body, null, 2) + "\n";
  }

  protected getFileSlug(entity: McpServerEntity): string { return entity.name; }

  // A9：MCP CRUD 后 emit 事件；D5：FTS 增量挂钩
  protected override async afterCreate(entity: McpServerEntity, input: CreateMcpServerInput): Promise<void> {
    await super.afterCreate(entity, input);
    await this.syncFts("mcp", entity.id, entity.name, entity.command ?? "");
    this.eventBus.emit("mcp.created", entity);
  }
  protected override async afterUpdate(entity: McpServerEntity, existing: any, input: UpdateMcpServerInput): Promise<void> {
    await super.afterUpdate(entity, existing, input);
    await this.syncFts("mcp", entity.id, entity.name, entity.command ?? "");
    this.eventBus.emit("mcp.updated", entity);
  }
  protected override async afterDelete(existing: any): Promise<void> {
    await super.afterDelete(existing);
    await this.removeFts("mcp", existing.id);
    this.eventBus.emit("mcp.deleted", existing);
  }

  protected override async validateCreate(input: CreateMcpServerInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
    this.assertMcpTransport(input.transport ?? "stdio", input.command, input.url);
  }

  protected override async validateUpdate(input: UpdateMcpServerInput, existing: any): Promise<void> {
    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertUnique("name", input.name, "更新", input.id);
    }
    const transport = (input.transport ?? existing.transport ?? "stdio") as "stdio" | "http";
    const command = input.command !== undefined ? input.command : existing.command;
    const url = input.url !== undefined ? input.url : existing.url;
    this.assertMcpTransport(transport, command, url);
  }

  private assertMcpTransport(
    transport: "stdio" | "http",
    command: string | null | undefined,
    url: string | null | undefined,
  ): void {
    if (transport === "stdio" && !String(command ?? "").trim()) {
      throw new ServiceValidationError(
        failure({
          code: "BAD_REQUEST",
          message: "stdio 传输必须填写 command",
          retryable: false,
          operation: "validate",
          entity: this.entityName,
        }),
      );
    }
    if (transport === "http" && !String(url ?? "").trim()) {
      throw new ServiceValidationError(
        failure({
          code: "BAD_REQUEST",
          message: "http 传输必须填写 url",
          retryable: false,
          operation: "validate",
          entity: this.entityName,
        }),
      );
    }
  }

  protected override buildDeleteSummary(existing: any): Record<string, unknown> {
    return { id: existing.id, name: existing.name };
  }
}
