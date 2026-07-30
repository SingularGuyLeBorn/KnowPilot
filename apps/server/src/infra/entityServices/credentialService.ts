/**
 * Credential 凭据 Service（从 services.ts 拆出的第一片叶子）。
 * 继承 BaseService；API 响应永不返回明文 value。
 */

import type {
  CreateCredentialInput,
  UpdateCredentialInput,
  ListCredentialsInput,
} from "@knowpilot/shared";
import {
  encryptCredentialValue,
  decryptCredentialValue,
  maskSecret,
  invalidateIntegrationCredentials,
} from "../credentialVault.js";
import { BaseService } from "../../services.js";

/** Credential 凭据管理 */
export class CredentialService extends BaseService<
  CreateCredentialInput,
  UpdateCredentialInput,
  ListCredentialsInput,
  any
> {
  readonly entityName = "credential";
  protected get delegate() {
    return this.prisma.credential;
  }

  protected formatEntity(raw: any) {
    // 安全：API 响应永不返回明文 value，仅返回遮蔽后的 valuePreview。
    // 明文仅在 credentialVault 内部（getCredentialValue 等）解密使用。
    const { value: _encryptedValue, ...rest } = raw;
    return {
      ...rest,
      valuePreview: maskSecret(decryptCredentialValue(raw.value)),
      scope: raw.scope ? raw.scope.split(",").filter(Boolean).map((s: string) => s.trim()) : [],
      metadata: raw.metadata ? safeJsonParse(raw.metadata) : null,
    };
  }

  protected buildListWhere(input: ListCredentialsInput) {
    const where: any = {};
    if (input.type) where.type = input.type;
    if (input.keyword) where.name = { contains: input.keyword };
    return where;
  }

  protected buildCreateData(input: CreateCredentialInput) {
    return {
      name: input.name,
      type: input.type,
      value: encryptCredentialValue(input.value),
      scope: input.scope.join(","),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    };
  }

  protected buildUpdateData(input: UpdateCredentialInput) {
    const { id: _id, scope, expiresAt, metadata, value, ...data } = input;
    const updateData: any = { ...data };
    if (value !== undefined) updateData.value = encryptCredentialValue(value);
    if (scope !== undefined) updateData.scope = scope.join(",");
    if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (metadata !== undefined) updateData.metadata = metadata ? JSON.stringify(metadata) : null;
    return updateData;
  }

  protected override async validateCreate(input: CreateCredentialInput): Promise<void> {
    await this.assertUnique("name", input.name, "创建");
  }
  protected override async validateUpdate(input: UpdateCredentialInput, existing: any): Promise<void> {
    if (input.name && input.name !== existing.name) {
      await this.assertUnique("name", input.name, "更新", input.id);
    }
  }
  // P1-5 / P1：CRUD 后清 credential vault 缓存 + 立即重新注入 config.integrations
  protected override async afterCreate(): Promise<void> {
    await invalidateIntegrationCredentials(this.config, this.prisma);
  }
  protected override async afterUpdate(): Promise<void> {
    await invalidateIntegrationCredentials(this.config, this.prisma);
  }
  protected override async afterDelete(): Promise<void> {
    await invalidateIntegrationCredentials(this.config, this.prisma);
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
