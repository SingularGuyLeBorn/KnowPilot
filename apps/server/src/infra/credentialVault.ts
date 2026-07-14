/**
 * Credential Vault — 运行时凭据统一管理层
 *
 * 1. 让 Credential 表成为原生工具/集成的运行时凭证来源，.env 作为 fallback。
 * 2. 支持可选 AES-256-GCM 加密（CREDENTIAL_MASTER_KEY）。
 * 3. 提供按 scope/name 查询、自动更新 lastUsedAt、注入 config.integrations。
 */

import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import { LLM_PROVIDER_DEEPSEEK } from "@knowpilot/shared";

const ENC_PREFIX = "enc:";

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const val = process.env[key];
    if (val && val.trim()) return val.trim();
  }
  return "";
}

function getMasterKey(): string | undefined {
  return readEnv("CREDENTIAL_MASTER_KEY") || undefined;
}

function deriveKey(masterKey: string): Buffer {
  return crypto.createHash("sha256").update(masterKey).digest();
}

export function encryptCredentialValue(plain: string, masterKey?: string): string {
  const key = masterKey || getMasterKey();
  if (!key) {
    // 生产模式强制加密：无 master key 时拒绝明文落库，避免 dev.db 被复制即泄露全部密钥。
    // 开发模式保留明文回退以便本地快速试用，但启动时会 warn（见 assertCredentialEncryptionAvailable）。
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "生产环境必须配置 CREDENTIAL_MASTER_KEY 才能存储凭据，当前为空（拒绝明文落库）。",
      );
    }
    return plain;
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(key), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString("base64");
  return `${ENC_PREFIX}${payload}`;
}

/** 启动时凭据加密护栏：生产模式无 key 抛错；开发模式 warn。 */
export function assertCredentialEncryptionAvailable(): void {
  const key = getMasterKey();
  if (key) return;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "生产环境启动被拒：未配置 CREDENTIAL_MASTER_KEY，凭据将以明文落库。请设置该环境变量后重启。",
    );
  }
  console.warn(
    "⚠️ [安全] 未配置 CREDENTIAL_MASTER_KEY，凭据将以明文存储到 dev.db。生产环境必须配置该变量。",
  );
}

export function decryptCredentialValue(value: string, masterKey?: string): string {
  const key = masterKey || getMasterKey();
  if (!key || !value.startsWith(ENC_PREFIX)) return value;
  const payload = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
  const iv = payload.subarray(0, 16);
  const authTag = payload.subarray(16, 32);
  const encrypted = payload.subarray(32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(key), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export interface CredentialRecord {
  id: string;
  name: string;
  type: string;
  value: string;
  scope: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

function formatCredential(raw: any): CredentialRecord {
  let metadata: Record<string, unknown> | null = null;
  if (raw.metadata) {
    try {
      metadata = JSON.parse(raw.metadata);
    } catch {
      metadata = null;
    }
  }
  return {
    ...raw,
    value: decryptCredentialValue(raw.value),
    scope: raw.scope ? raw.scope.split(",").filter(Boolean).map((s: string) => s.trim()) : [],
    metadata,
  };
}

/** 将明文密钥遮蔽为预览串：仅留首 4 + 末 4，中间以 •••• 占位。运行时 API 永远不返回明文。 */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

/** 内存缓存：按 scope 的凭据列表，TTL 30 秒 */
const cache = new Map<string, { at: number; items: CredentialRecord[] }>();
const CACHE_TTL_MS = 30_000;

function cacheKey(scope: string, name?: string): string {
  return name ? `${scope}::${name}` : scope;
}

export async function listCredentialsByScope(
  prisma: PrismaClient,
  scope: string,
): Promise<CredentialRecord[]> {
  const key = cacheKey(scope);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.items;
  }
  // P1-5：scope 精确匹配。DB 存逗号分隔字符串，contains 子串会误命中（如 "llm" 命中 "myllm"）。
  // 改为拉全量后内存按 scope 数组精确包含过滤（凭据数量少，可接受）。
  const rawItems = await prisma.credential.findMany({ orderBy: { updatedAt: "desc" } });
  const items = rawItems
    .map(formatCredential)
    .filter((c) => Array.isArray(c.scope) && c.scope.includes(scope));
  cache.set(key, { at: Date.now(), items });
  return items;
}

export async function getCredential(
  prisma: PrismaClient,
  scope: string,
  name?: string,
): Promise<CredentialRecord | undefined> {
  const items = await listCredentialsByScope(prisma, scope);
  if (!name) return items[0];
  return items.find((c) => c.name === name);
}

export async function getCredentialValue(
  prisma: PrismaClient,
  scope: string,
  name?: string,
): Promise<string | undefined> {
  const cred = await getCredential(prisma, scope, name);
  return cred?.value;
}

export async function getIntegrationCredentials(
  prisma: PrismaClient,
): Promise<{
  feishu: AppConfig["integrations"]["feishu"];
  yuque: AppConfig["integrations"]["yuque"];
  github: AppConfig["integrations"]["github"];
}> {
  const [feishuItems, yuqueItems, githubItems] = await Promise.all([
    listCredentialsByScope(prisma, "feishu"),
    listCredentialsByScope(prisma, "yuque"),
    listCredentialsByScope(prisma, "github"),
  ]);

  const pick = (items: CredentialRecord[], name: string): string | undefined =>
    items.find((c) => c.name === name)?.value;

  return {
    feishu: {
      appId: pick(feishuItems, "feishu_app_id") || readEnv("FEISHU_APP_ID"),
      appSecret: pick(feishuItems, "feishu_app_secret") || readEnv("FEISHU_APP_SECRET"),
      userAccessToken: pick(feishuItems, "feishu_user_access_token") || readEnv("FEISHU_USER_ACCESS_TOKEN"),
      tenantAccessToken: pick(feishuItems, "feishu_tenant_access_token") || readEnv("FEISHU_TENANT_ACCESS_TOKEN"),
    },
    yuque: {
      session: pick(yuqueItems, "yuque_session") || readEnv("YUQUE_SESSION"),
      ctoken: pick(yuqueItems, "yuque_ctoken") || readEnv("YUQUE_CTOKEN"),
    },
    github: {
      token: pick(githubItems, "github_token") || readEnv("GITHUB_TOKEN", "VITE_GITHUB_TOKEN"),
    },
  };
}

export async function injectIntegrationCredentials(
  config: AppConfig,
  prisma: PrismaClient,
): Promise<void> {
  const creds = await getIntegrationCredentials(prisma);
  config.integrations.feishu = { ...config.integrations.feishu, ...creds.feishu };
  config.integrations.yuque = { ...config.integrations.yuque, ...creds.yuque };
  config.integrations.github = { ...config.integrations.github, ...creds.github };
}

/* ─── P1：凭据注入状态管理（避免每请求重复注入 + 改写共享 config） ───
 * 此前 createContext 对每个 tRPC 请求都调用 injectIntegrationCredentials，
 * 即便 listCredentialsByScope 有 30s 缓存，每请求仍做 3 次 Map 查 + 对象 spread
 * 并改写共享 config（并发竞态）。改为：首次请求注入一次，后续请求零工作；
 * 凭据 CRUD 后立即重注入刷新 config。
 *
 * 用 generation 计数器消除「首次注入进行中发生 CRUD」的竞态：
 * invalidate 自增 gen，进行中的旧注入完成时发现 gen 已超越便不写 config、
 * 不标记 injected，避免旧凭据覆盖新凭据。
 */
let integrationInjected = false;
let integrationInjectPromise: Promise<void> | null = null;
let integrationGen = 0;

/** 幂等注入：已注入则立即返回；首次或失效后执行一次注入（并发合并为单次）。 */
export async function ensureIntegrationCredentialsInjected(
  config: AppConfig,
  prisma: PrismaClient,
): Promise<void> {
  if (integrationInjected) return;
  if (!integrationInjectPromise) {
    const myGen = integrationGen;
    integrationInjectPromise = (async () => {
      try {
        await injectIntegrationCredentials(config, prisma);
        // 仅当本次注入未被后续 invalidate 超越时才落地
        if (myGen === integrationGen) integrationInjected = true;
      } finally {
        if (myGen === integrationGen) integrationInjectPromise = null;
      }
    })();
  }
  await integrationInjectPromise;
}

/** 凭据 CRUD 后调用：清缓存 + 标记失效 + 立即重新注入（用最新 DB 数据刷新 config）。
 *  自增 gen 使任何进行中的旧注入作废（不写 config、不标记 injected），
 *  随后启动的新注入用最新数据写入 config，彻底消除竞态。
 *  CRUD 是低频用户操作，多 3 次读可接受。 */
export async function invalidateIntegrationCredentials(
  config: AppConfig,
  prisma: PrismaClient,
): Promise<void> {
  integrationGen++;
  integrationInjected = false;
  integrationInjectPromise = null;
  clearCredentialCache();
  await ensureIntegrationCredentialsInjected(config, prisma);
}

export async function touchCredentialLastUsed(
  prisma: PrismaClient,
  id: string,
): Promise<void> {
  try {
    await prisma.credential.update({ where: { id }, data: { lastUsedAt: new Date() } });
  } catch {
    // 不阻塞主流程
  }
}

export async function upsertCredential(
  prisma: PrismaClient,
  input: {
    name: string;
    type: string;
    value: string;
    scope: string[];
    expiresAt?: Date | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<CredentialRecord> {
  const encryptedValue = encryptCredentialValue(input.value);
  const scopeStr = input.scope.join(",");
  const metadataStr = input.metadata ? JSON.stringify(input.metadata) : null;
  const existing = await prisma.credential.findUnique({ where: { name: input.name } });
  const raw = existing
    ? await prisma.credential.update({
        where: { name: input.name },
        data: {
          type: input.type,
          value: encryptedValue,
          scope: scopeStr,
          expiresAt: input.expiresAt ?? existing.expiresAt,
          metadata: metadataStr ?? existing.metadata,
        },
      })
    : await prisma.credential.create({
        data: {
          name: input.name,
          type: input.type,
          value: encryptedValue,
          scope: scopeStr,
          expiresAt: input.expiresAt,
          metadata: metadataStr,
        },
      });
  // 刷新缓存
  for (const scope of input.scope) {
    cache.delete(cacheKey(scope));
  }
  return formatCredential(raw);
}

export function clearCredentialCache(): void {
  cache.clear();
}

/** 从 .env 读取可导入 Credential 的候选密钥 */
export function getEnvCredentialCandidates(): Array<{
  name: string;
  type: string;
  value: string;
  scope: string[];
}> {
  const candidates: Array<{ name: string; type: string; value: string; scope: string[] }> = [];

  const push = (name: string, value: string | undefined, type = "token", scope: string) => {
    if (value && value.trim() && value !== "your-api-key-here") {
      candidates.push({ name, type, value: value.trim(), scope: [scope] });
    }
  };

  push("github_token", readEnv("GITHUB_TOKEN", "VITE_GITHUB_TOKEN"), "token", "github");
  push("feishu_app_id", readEnv("FEISHU_APP_ID", "LARK_APP_ID"), "api_key", "feishu");
  push("feishu_app_secret", readEnv("FEISHU_APP_SECRET", "LARK_APP_SECRET"), "password", "feishu");
  push("feishu_user_access_token", readEnv("FEISHU_USER_ACCESS_TOKEN"), "token", "feishu");
  push("feishu_tenant_access_token", readEnv("FEISHU_TENANT_ACCESS_TOKEN"), "token", "feishu");
  push("yuque_session", readEnv("YUQUE_SESSION"), "token", "yuque");
  push("yuque_ctoken", readEnv("YUQUE_CTOKEN"), "token", "yuque");
  push("tavily_api_key", readEnv("SEARCH_TAVILY_API_KEY", "TAVILY_API_KEY"), "api_key", "search");
  push("serpapi_api_key", readEnv("SEARCH_SERPAPI_API_KEY", "SERPAPI_API_KEY"), "api_key", "search");
  push(`${LLM_PROVIDER_DEEPSEEK}_api_key`, readEnv("VITE_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"), "api_key", "llm");
  push("kimi_api_key", readEnv("VITE_KIMI_API_KEY", "KIMI_API_KEY"), "api_key", "llm");

  return candidates;
}
