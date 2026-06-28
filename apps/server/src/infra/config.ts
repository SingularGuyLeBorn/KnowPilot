/**
 * 统一配置管理
 *
 * 集中管理路径、端口、LLM、搜索与第三方集成配置。
 * 环境变量优先读取无前缀键，其次 VITE_ 前缀（兼容前端 .env 写法）。
 */

import fs from "fs";
import path from "path";

/* ─── 类型定义 ─── */

export interface LlmProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface AppConfig {
  port: number;
  projectRoot: string;
  contentDir: string;
  contentPaths: {
    posts: string;
    agents: string;
    skills: string;
    mcp: string;
    memories: string;
    tasks: string;
    prompts: string;
  };
  uploadDir: string;
  env: "development" | "production" | "test";
  publicUrl: string;
  corsOrigins: string[];
  serverInternalUrl: string;
  webHost: string;
  llm: {
    defaultProvider: string;
    dailyBudget: number;
    maxToolRounds: number;
    providers: Record<string, LlmProviderConfig>;
  };
  search: {
    tavilyApiKey: string;
    serpApiKey: string;
  };
  integrations: {
    feishu: {
      appId: string;
      appSecret: string;
      userAccessToken: string;
      tenantAccessToken: string;
    };
    yuque: {
      session: string;
      ctoken: string;
    };
    github: {
      token: string;
    };
  };
  auth: {
    mode: "none" | "password";
    password: string;
    token: string;
  };
  cloudflare: {
    tunnelToken: string;
  };
}

/* ─── 环境变量 ─── */

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const val = process.env[key];
    if (val && val.trim()) return val.trim();
  }
  return "";
}

function readProvider(modelKeys: string[], apiKeyKeys: string[], baseUrlKeys: string[], defaultModel: string): LlmProviderConfig {
  return {
    apiKey: readEnv(...apiKeyKeys),
    model: readEnv(...modelKeys) || defaultModel,
    baseUrl: readEnv(...baseUrlKeys),
  };
}

/* ─── 路径解析 ─── */

function resolveProjectRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    path.resolve(process.cwd(), "../../.."),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "pnpm-workspace.yaml"))) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), "../..");
}

function resolveContentDir(projectRoot: string): string {
  const contentDir = path.join(projectRoot, "content");
  if (fs.existsSync(contentDir)) return contentDir;

  const cwdContent = path.resolve(process.cwd(), "content");
  if (fs.existsSync(cwdContent)) return cwdContent;

  return contentDir;
}

/** 加载项目根目录 .env（幂等） */
export function loadRootEnv(projectRoot?: string): void {
  const root = projectRoot || resolveProjectRoot();
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/* ─── 工厂函数 ─── */

export function createAppConfig(): AppConfig {
  const projectRoot = resolveProjectRoot();
  const contentDir = resolveContentDir(projectRoot);

  const providers: Record<string, LlmProviderConfig> = {
    deepseek: readProvider(
      ["DEEPSEEK_MODEL", "VITE_DEEPSEEK_MODEL"],
      ["DEEPSEEK_API_KEY", "VITE_DEEPSEEK_API_KEY"],
      ["DEEPSEEK_BASE_URL", "VITE_DEEPSEEK_BASE_URL"],
      "deepseek-chat",
    ),
    kimi: readProvider(
      ["KIMI_MODEL", "VITE_KIMI_MODEL"],
      ["KIMI_API_KEY", "VITE_KIMI_API_KEY"],
      ["KIMI_BASE_URL", "VITE_KIMI_BASE_URL"],
      "kimi-latest",
    ),
    zhipu: readProvider(
      ["ZHIPU_MODEL", "VITE_ZHIPU_MODEL"],
      ["ZHIPU_API_KEY", "VITE_ZHIPU_API_KEY"],
      ["ZHIPU_BASE_URL", "VITE_ZHIPU_BASE_URL"],
      "glm-4-flash",
    ),
    openai: readProvider(
      ["OPENAI_MODEL", "VITE_OPENAI_MODEL"],
      ["OPENAI_API_KEY", "VITE_OPENAI_API_KEY"],
      ["OPENAI_BASE_URL", "VITE_OPENAI_BASE_URL"],
      "gpt-4o-mini",
    ),
    gemini: readProvider(
      ["GEMINI_MODEL", "VITE_GEMINI_MODEL"],
      ["GEMINI_API_KEY", "VITE_GEMINI_API_KEY"],
      ["GEMINI_BASE_URL", "VITE_GEMINI_BASE_URL"],
      "gemini-1.5-flash",
    ),
    anthropic: readProvider(
      ["ANTHROPIC_MODEL", "VITE_ANTHROPIC_MODEL"],
      ["ANTHROPIC_API_KEY", "VITE_ANTHROPIC_API_KEY"],
      ["ANTHROPIC_BASE_URL", "VITE_ANTHROPIC_BASE_URL"],
      "claude-3-5-sonnet-latest",
    ),
    qwen: readProvider(
      ["QWEN_MODEL", "VITE_QWEN_MODEL"],
      ["QWEN_API_KEY", "VITE_QWEN_API_KEY"],
      ["QWEN_BASE_URL", "VITE_QWEN_BASE_URL"],
      "qwen-plus",
    ),
    baichuan: readProvider(
      ["BAICHUAN_MODEL", "VITE_BAICHUAN_MODEL"],
      ["BAICHUAN_API_KEY", "VITE_BAICHUAN_API_KEY"],
      ["BAICHUAN_BASE_URL", "VITE_BAICHUAN_BASE_URL"],
      "Baichuan4",
    ),
    "01ai": readProvider(
      ["01AI_MODEL", "VITE_01AI_MODEL"],
      ["01AI_API_KEY", "VITE_01AI_API_KEY"],
      ["01AI_BASE_URL", "VITE_01AI_BASE_URL"],
      "yi-large",
    ),
    xai: readProvider(
      ["XAI_MODEL", "VITE_XAI_MODEL"],
      ["XAI_API_KEY", "VITE_XAI_API_KEY"],
      ["XAI_BASE_URL", "VITE_XAI_BASE_URL"],
      "grok-beta",
    ),
    cohere: readProvider(
      ["COHERE_MODEL", "VITE_COHERE_MODEL"],
      ["COHERE_API_KEY", "VITE_COHERE_API_KEY"],
      ["COHERE_BASE_URL", "VITE_COHERE_BASE_URL"],
      "command-r-plus",
    ),
    mistral: readProvider(
      ["MISTRAL_MODEL", "VITE_MISTRAL_MODEL"],
      ["MISTRAL_API_KEY", "VITE_MISTRAL_API_KEY"],
      ["MISTRAL_BASE_URL", "VITE_MISTRAL_BASE_URL"],
      "mistral-large-latest",
    ),
    openrouter: readProvider(
      ["OPENROUTER_MODEL", "VITE_OPENROUTER_MODEL"],
      ["OPENROUTER_API_KEY", "VITE_OPENROUTER_API_KEY"],
      ["OPENROUTER_BASE_URL", "VITE_OPENROUTER_BASE_URL"],
      "anthropic/claude-3.5-sonnet",
    ),
  };

  const config: AppConfig = {
    port: parseInt(process.env.SERVER_PORT || "3010", 10),
    projectRoot,
    contentDir,
    contentPaths: {
      posts: path.join(contentDir, "posts"),
      agents: path.join(contentDir, "agents"),
      skills: path.join(contentDir, "skills"),
      mcp: path.join(contentDir, "mcp"),
      memories: path.join(contentDir, "memories"),
      tasks: path.join(contentDir, "tasks"),
      prompts: path.join(contentDir, "prompts"),
    },
    uploadDir: path.join(contentDir, "uploads"),
    env: (process.env.NODE_ENV || "development") as AppConfig["env"],
    publicUrl: readEnv("PUBLIC_URL"),
    corsOrigins: readEnv("CORS_ORIGINS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    serverInternalUrl: readEnv("SERVER_INTERNAL_URL") || "http://127.0.0.1:3010",
    webHost: readEnv("WEB_HOST") || "127.0.0.1",
    llm: {
      defaultProvider: readEnv("LLM_DEFAULT_PROVIDER") || "deepseek",
      dailyBudget: parseFloat(readEnv("LLM_DAILY_BUDGET") || "10"),
      maxToolRounds: Math.max(1, parseInt(readEnv("AGENT_MAX_TOOL_ROUNDS") || "16", 10)),
      providers,
    },
    search: {
      tavilyApiKey: readEnv("SEARCH_TAVILY_API_KEY", "TAVILY_API_KEY"),
      serpApiKey: readEnv("SEARCH_SERPAPI_API_KEY", "SERPAPI_API_KEY"),
    },
    integrations: {
      feishu: {
        appId: readEnv("FEISHU_APP_ID"),
        appSecret: readEnv("FEISHU_APP_SECRET"),
        userAccessToken: readEnv("FEISHU_USER_ACCESS_TOKEN"),
        tenantAccessToken: readEnv("FEISHU_TENANT_ACCESS_TOKEN"),
      },
      yuque: {
        session: readEnv("YUQUE_SESSION"),
        ctoken: readEnv("YUQUE_CTOKEN"),
      },
      github: {
        token: readEnv("GITHUB_TOKEN", "VITE_GITHUB_TOKEN"),
      },
    },
    auth: {
      mode: readEnv("AUTH_MODE") === "password" ? "password" : "none",
      password: readEnv("AUTH_PASSWORD"),
      token: readEnv("AUTH_TOKEN") || readEnv("AUTH_PASSWORD"),
    },
    cloudflare: {
      tunnelToken: readEnv("CLOUDFLARE_TUNNEL_TOKEN"),
    },
  };

  for (const dir of Object.values(config.contentPaths)) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(config.uploadDir)) fs.mkdirSync(config.uploadDir, { recursive: true });

  return config;
}

/* ─── 全局单例 ─── */

const globalForConfig = globalThis as unknown as { __appConfig: AppConfig };

export function getAppConfig(): AppConfig {
  if (!globalForConfig.__appConfig) {
    loadRootEnv();
    globalForConfig.__appConfig = createAppConfig();
  }
  return globalForConfig.__appConfig;
}

/** 列出已配置 API Key 的 LLM 厂商 */
export function listConfiguredLlmProviders(config: AppConfig = getAppConfig()): string[] {
  return Object.entries(config.llm.providers)
    .filter(([, p]) => !!p.apiKey && p.apiKey !== "your-api-key-here")
    .map(([id]) => id);
}
