/**
 * 统一配置管理
 *
 * 集中管理路径、端口、LLM、搜索与第三方集成配置。
 * 环境变量优先读取无前缀键，其次 VITE_ 前缀（本机 .env 沿用 VITE_ 前缀写法）。
 */

import fs from "fs";
import path from "path";
import { load as loadYaml } from "js-yaml";
import { z } from "zod";
import { DEFAULT_LLM_MODEL, LLM_PROVIDER_DEEPSEEK } from "@knowpilot/shared";
import { buildEffectiveSearchPriorityString } from "./metablog/search/priority.js";

/** config.yaml llm 段：弹性调用参数（缺省时走默认值） */
const LlmYamlSchema = z.object({
  /** 全局默认模型 id（空 = 回退 shared 常量 DEFAULT_LLM_MODEL；env DEFAULT_LLM_MODEL 优先） */
  defaultModel: z.string().default(""),
  maxRetries: z.coerce.number().int().min(0).default(3),
  baseDelayMs: z.coerce.number().int().min(0).default(1000),
  fallbackModels: z.array(z.string()).default([]),
});

/** config.yaml reflection 段：W7 反思（缺省时走默认值） */
const ReflectionYamlSchema = z.object({
  enabled: z.boolean().default(false),
  maxRounds: z.coerce.number().int().min(0).default(1),
  criticModel: z.string().default(""),
});

/** config.yaml skills 段：Hermes 闭环 nudge / curator */
const SkillsYamlSchema = z.object({
  nudgeInterval: z.coerce.number().int().min(0).default(10),
  /** background skill review 用模型；auto = OpenRouter 最强 :free（见 auxiliaryModel） */
  reviewModel: z.string().default("auto"),
  staleAfterDays: z.coerce.number().int().min(1).default(30),
  archiveAfterDays: z.coerce.number().int().min(1).default(90),
  curatorIntervalHours: z.coerce.number().int().min(1).default(168),
});

/** config.yaml goal 段：Chat Goal / Deep Research 外环 */
const GoalYamlSchema = z.object({
  maxTurns: z.coerce.number().int().min(1).max(200).default(20),
  deepResearchMaxTurns: z.coerce.number().int().min(1).max(200).default(30),
  /** 裁判模型；auto = OpenRouter strong_free */
  judgeModel: z.string().default("auto"),
});

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
    sources: string;
  };
  uploadDir: string;
  env: "development" | "production" | "test";
  publicUrl: string;
  corsOrigins: string[];
  serverInternalUrl: string;
  webHost: string;
  emailProvider: string;
  llm: {
    defaultProvider: string;
    /** 全局默认模型 id：env DEFAULT_LLM_MODEL > config.yaml llm.defaultModel > shared DEFAULT_LLM_MODEL 常量 */
    defaultModel: string;
    dailyBudget: number;
    maxToolRounds: number;
    /** 单次 Agent 运行的总工具调用次数上限（#32a：用户确认 168） */
    maxToolCallsPerRun: number;
    /** 单次工具调用超时毫秒，超时则该工具返回错误结果而非永久挂起 */
    toolCallTimeoutMs: number;
    /** 单轮内并发执行的工具数上限，避免一次开太多工具调用拖垮后端/触发限流 */
    toolCallConcurrency: number;
    /** 弹性调用：失败重试次数（config.yaml llm.maxRetries） */
    maxRetries: number;
    /** 弹性调用：指数退避基数毫秒 */
    baseDelayMs: number;
    /** 弹性调用：重试耗尽后按序降级的备用模型（provider 由模型名推导） */
    fallbackModels: string[];
    providers: Record<string, LlmProviderConfig>;
  };
  /** 异步 Agent 后台任务并发、超时与重试 */
  asyncJobs: {
    maxConcurrent: number;
    maxPerSession: number;
    /** per-workspace 公平配额（0 = 不限；不是容量权威，全局池才是） */
    maxPerWorkspace: number;
    /** 排队总数上限，满则入池拒绝并给调用方明确错误 */
    maxQueued: number;
    taskTimeoutMs: number;
    queuedTimeoutMs: number;
    maxRetries: number;
    /** 每个父会话允许的 subagent 任务数量上限（防止失控） */
    maxSubagentsPerSession: number;
  };
  /** OCR — 对齐 MetaBlog PaddleOCR + OCR.space */
  ocr: {
    paddleCliPath: string;
    paddlePythonPath: string;
    ppocrHome: string;
    ocrSpaceApiKey: string;
    ocrSpaceDefaultLang: string;
  };
  search: {
    tavilyApiKey: string;
    serpApiKey: string;
    baiduQianfanApiKey: string;
    metasoApiKey: string;
    bochaApiKey: string;
    langsearchApiKey: string;
    braveApiKey: string;
    bingApiKey: string;
    /** 逗号分隔，如 bing_crawler,baidu_qianfan,tavily */
    enginePriority: string;
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
      /** Web API CSRF（Cookie `_ctoken`），不是 Open API Token */
      ctoken: string;
      /** Open API v2 个人令牌（YUQUE_TOKEN） */
      personalToken: string;
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
  /** Shell 执行策略（host_restricted = 用户选定的默认方案） */
  shell: {
    enabled: boolean;
    mode: "disabled" | "host_restricted" | "host_full" | "docker";
    timeoutMs: number;
    maxOutputChars: number;
    /** auto | powershell | cmd | bash */
    shell: string;
  };
  /** SessionStreamHub 内存缓冲与持久化配置 */
  stream: {
    ringSize: number;
    persist: boolean;
    eventTtlMs: number;
    cleanupIntervalMs: number;
    /** Steering 投递：one-at-a-time | all */
    steeringMode: "one-at-a-time" | "all";
    /** Follow-up 投递：one-at-a-time | all */
    followUpMode: "one-at-a-time" | "all";
  };
  /** 长对话 Auto-Compact */
  compact: {
    enabled: boolean;
    /** 占模型 context window 的触发比例（0.1–0.95） */
    triggerRatio: number;
    keepRecent: number;
    /**
     * 压缩时按 token 粗估保留的最近上下文（默认 20000）。
     * 切点从不落在 toolCall/toolResult 之间；过短时向旧侧移动到安全边界。
     */
    keepRecentTokens: number;
    /**
     * 摘要专用模型。`auto`（默认）= 优先 OpenRouter `:free`，其次 freellm 网关模型，否则回退主对话模型。
     * 也可填具体 model id（如 `deepseek/deepseek-r1:free`）。
     */
    summaryModel: string;
    microCompact: {
      enabled: boolean;
      toolResultMaxChars: number;
    };
    memoryFlush: {
      enabled: boolean;
      maxFacts: number;
    };
  };
  /** 心跳：决策层 + Loop Contract 默认 */
  heartbeat: {
    /** W2：总开关；false = 回退到点即 dispatch */
    decisionEnabled: boolean;
    /** quiet/monitor 退避 skipTicks 上限 */
    quietCap: number;
    /** 连续 K 次 quiet → terminal */
    terminalAfterQuiet: number;
    /** wait_user_gate 同 gate 通知冷却（毫秒） */
    gateNotifyCooldownMs: number;
    loopContract: {
      maxStaleRounds: number;
      maxEvidence: number;
    };
  };
  /** W3：审批 gate 通知冷却（per-approval lastNotifiedAt） */
  approvalGate: {
    /** 同一审批冷却窗口内不重复通知（毫秒）；默认 30min */
    notifyCooldownMs: number;
  };
  /** W7 反思：loop 进入 done 前一票结构化 critic（默认关闭） */
  reflection: {
    enabled: boolean;
    /** 最大反思重修轮数；0 = 只审不修（不通过直接标记放行） */
    maxRounds: number;
    /** critic 使用的便宜模型；空 = 与主 Agent 模型相同 */
    criticModel: string;
  };
  /** Hermes Skill 闭环：回合后审查阈值 + curator */
  skills: {
    /** 本轮 tool 调用次数 ≥ 此值则触发 background skill review；0 = 关闭 */
    nudgeInterval: number;
    /**
     * 审查旁路模型（对标 Hermes auxiliary.background_review）。
     * auto = OpenRouter 目录里按 strong_free 打分挑最强 :free；也可钉死具体 id。
     */
    reviewModel: string;
    /** curator：闲置超过 N 天标 stale */
    staleAfterDays: number;
    /** curator：闲置超过 N 天归档（非硬删） */
    archiveAfterDays: number;
    /** curator 最小间隔小时 */
    curatorIntervalHours: number;
  };
  /** Chat Goal / Deep Research 外环 */
  goal: {
    maxTurns: number;
    deepResearchMaxTurns: number;
    judgeModel: string;
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

function loadYamlConfig(projectRoot: string): Record<string, unknown> {
  const yamlPath = path.join(projectRoot, "config.yaml");
  if (!fs.existsSync(yamlPath)) return {};
  try {
    const raw = fs.readFileSync(yamlPath, "utf8");
    return (loadYaml(raw) as Record<string, unknown>) || {};
  } catch (err) {
    console.warn("[config] 读取 config.yaml 失败，使用默认配置:", err instanceof Error ? err.message : err);
    return {};
  }
}

function resolveContentDir(projectRoot: string): string {
  // 测试隔离（#2）：KP_CONTENT_DIR 覆盖 content 目录，测试产物不落入真实 content/
  const envDir = process.env.KP_CONTENT_DIR?.trim();
  if (envDir) {
    return path.isAbsolute(envDir) ? envDir : path.resolve(projectRoot, envDir);
  }

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
    [LLM_PROVIDER_DEEPSEEK]: readProvider(
      ["DEEPSEEK_MODEL", "VITE_DEEPSEEK_MODEL"],
      ["DEEPSEEK_API_KEY", "VITE_DEEPSEEK_API_KEY"],
      ["DEEPSEEK_BASE_URL", "VITE_DEEPSEEK_BASE_URL"],
      DEFAULT_LLM_MODEL,
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

  const paddleCliDefault = path.join(projectRoot, "tools", "ocr", "paddleocr_cli.py");
  const yamlConfig = loadYamlConfig(projectRoot);
  const streamConfig = (yamlConfig.stream as Record<string, unknown>) || {};
  const compactConfig = (yamlConfig.compact as Record<string, unknown>) || {};
  const asyncJobsConfig = (yamlConfig.asyncJobs as Record<string, unknown>) || {};
  const heartbeatYaml = (yamlConfig.heartbeat as Record<string, unknown>) || {};
  const loopContractYaml = (heartbeatYaml.loopContract as Record<string, unknown>) || {};
  const approvalGateYaml = (yamlConfig.approvalGate as Record<string, unknown>) || {};
  // llm 段 zod 解析：解析失败（如字段类型错误）回退默认值，不阻断启动
  const llmYamlParsed = LlmYamlSchema.safeParse(yamlConfig.llm ?? {});
  const llmYaml = llmYamlParsed.success ? llmYamlParsed.data : LlmYamlSchema.parse({});
  // reflection 段同上：旧 config.yaml 无此段 → 默认关闭
  const reflectionYamlParsed = ReflectionYamlSchema.safeParse(yamlConfig.reflection ?? {});
  const reflectionYaml = reflectionYamlParsed.success
    ? reflectionYamlParsed.data
    : ReflectionYamlSchema.parse({});
  const skillsYamlParsed = SkillsYamlSchema.safeParse(yamlConfig.skills ?? {});
  const skillsYaml = skillsYamlParsed.success ? skillsYamlParsed.data : SkillsYamlSchema.parse({});
  const goalYamlParsed = GoalYamlSchema.safeParse(yamlConfig.goal ?? {});
  const goalYaml = goalYamlParsed.success ? goalYamlParsed.data : GoalYamlSchema.parse({});

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
      sources: path.join(contentDir, "sources"),
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
    emailProvider: readEnv("EMAIL_PROVIDER") || "none",
    llm: {
      defaultProvider: readEnv("LLM_DEFAULT_PROVIDER") || LLM_PROVIDER_DEEPSEEK,
      defaultModel: readEnv("DEFAULT_LLM_MODEL") || llmYaml.defaultModel || DEFAULT_LLM_MODEL,
      dailyBudget: parseFloat(readEnv("LLM_DAILY_BUDGET") || "10"),
      // 默认 12 轮：覆盖绝大多数 ReAct 场景，避免坏 LLM 空转到 100 轮长时间转圈
      maxToolRounds: Math.max(1, parseInt(readEnv("AGENT_MAX_TOOL_ROUNDS") || "12", 10)),
      // #32a：单次运行总工具调用上限 168（用户确认）
      maxToolCallsPerRun: Math.max(1, parseInt(readEnv("AGENT_MAX_TOOL_CALLS_PER_RUN") || "168", 10)),
      // 默认 30s 超时 + 并发 2：收紧以避免慢工具（fetch/MCP）长时间占槽导致卡死；
      // 慢工具应由 async_task_run 转异步而非阻塞主循环
      toolCallTimeoutMs: Math.max(2000, parseInt(readEnv("AGENT_TOOL_CALL_TIMEOUT_MS") || "30000", 10)),
      toolCallConcurrency: Math.max(1, parseInt(readEnv("AGENT_TOOL_CALL_CONCURRENCY") || "2", 10)),
      maxRetries: llmYaml.maxRetries,
      baseDelayMs: llmYaml.baseDelayMs,
      fallbackModels: llmYaml.fallbackModels,
      providers,
    },
    asyncJobs: {
      // yaml 为教学默认；AGENT_ASYNC_* 环境变量可覆盖
      maxConcurrent: Math.max(
        1,
        parseInt(
          readEnv("AGENT_ASYNC_MAX_CONCURRENT") || String(asyncJobsConfig.maxConcurrent ?? "2"),
          10,
        ),
      ),
      maxPerSession: Math.max(
        1,
        parseInt(
          readEnv("AGENT_ASYNC_MAX_PER_SESSION") || String(asyncJobsConfig.maxPerSession ?? "2"),
          10,
        ),
      ),
      maxPerWorkspace: Math.max(
        0,
        parseInt(
          readEnv("AGENT_ASYNC_MAX_PER_WORKSPACE") || String(asyncJobsConfig.maxPerWorkspace ?? "0"),
          10,
        ),
      ),
      maxQueued: Math.max(
        1,
        parseInt(readEnv("AGENT_ASYNC_MAX_QUEUED") || String(asyncJobsConfig.maxQueued ?? "100"), 10),
      ),
      taskTimeoutMs: Math.max(
        10_000,
        parseInt(
          readEnv("AGENT_ASYNC_TASK_TIMEOUT_MS") || String(asyncJobsConfig.taskTimeoutMs ?? "300000"),
          10,
        ),
      ),
      queuedTimeoutMs: Math.max(
        0,
        parseInt(
          readEnv("AGENT_ASYNC_QUEUED_TIMEOUT_MS") || String(asyncJobsConfig.queuedTimeoutMs ?? "0"),
          10,
        ),
      ),
      maxRetries: Math.max(
        0,
        parseInt(readEnv("AGENT_ASYNC_MAX_RETRIES") || String(asyncJobsConfig.maxRetries ?? "3"), 10),
      ),
      maxSubagentsPerSession: Math.max(
        1,
        parseInt(
          readEnv("AGENT_MAX_SUBAGENTS_PER_SESSION") ||
            String(asyncJobsConfig.maxSubagentsPerSession ?? "10"),
          10,
        ),
      ),
    },
    ocr: {
      paddleCliPath: readEnv("PADDLEOCR_CLI_PATH") || paddleCliDefault,
      paddlePythonPath:
        readEnv("PADDLEOCR_PYTHON_PATH") ||
        (process.platform === "win32" ? "" : "python3"),
      ppocrHome: readEnv("PPOCR_HOME") || path.join(projectRoot, "weights", "ocr", "paddleocr"),
      ocrSpaceApiKey: readEnv("OCR_SPACE_API_KEY"),
      ocrSpaceDefaultLang: readEnv("OCR_SPACE_DEFAULT_LANG") || "chs",
    },
    search: (() => {
      const tavilyApiKey = readEnv("SEARCH_TAVILY_API_KEY", "TAVILY_API_KEY");
      const serpApiKey = readEnv("SEARCH_SERPAPI_API_KEY", "SERPAPI_API_KEY");
      const baiduQianfanApiKey = readEnv("SEARCH_BAIDU_QIANFAN_API_KEY", "BAIDU_QIANFAN_API_KEY", "QIANFAN_API_KEY");
      return {
        tavilyApiKey,
        serpApiKey,
        baiduQianfanApiKey,
        metasoApiKey: readEnv("SEARCH_METASO_API_KEY", "METASO_API_KEY"),
        bochaApiKey: readEnv("SEARCH_BOCHA_API_KEY", "BOCHA_API_KEY"),
        langsearchApiKey: readEnv("SEARCH_LANGSEARCH_API_KEY", "LANGSEARCH_API_KEY"),
        braveApiKey: readEnv("SEARCH_BRAVE_API_KEY", "BRAVE_API_KEY"),
        bingApiKey: readEnv("SEARCH_BING_API_KEY", "BING_API_KEY"),
        enginePriority: buildEffectiveSearchPriorityString({
          envPriority: readEnv("SEARCH_ENGINE_PRIORITY"),
          tavilyApiKey,
          serpApiKey,
          baiduQianfanApiKey,
        }),
      };
    })(),
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
        personalToken: readEnv("YUQUE_TOKEN", "YUQUE_PERSONAL_TOKEN"),
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
    shell: {
      enabled: readEnv("SHELL_ENABLED", "SHELL_TOOL_ENABLED") !== "false",
      mode: (() => {
        const raw = readEnv("SHELL_MODE") || "host_restricted";
        if (raw === "disabled" || raw === "host_restricted" || raw === "host_full" || raw === "docker") {
          return raw;
        }
        return "host_restricted";
      })(),
      timeoutMs: Math.max(1000, parseInt(readEnv("SHELL_TIMEOUT_MS") || "30000", 10)),
      maxOutputChars: Math.max(1000, parseInt(readEnv("SHELL_MAX_OUTPUT_CHARS") || "12000", 10)),
      shell: readEnv("SHELL_BINARY") || "auto",
    },
    stream: {
      ringSize: Math.max(10, parseInt(String(streamConfig.ringSize ?? "500"), 10)),
      persist: String(streamConfig.persist ?? "true") !== "false",
      eventTtlMs: Math.max(0, parseInt(String(streamConfig.eventTtlMs ?? "300000"), 10)),
      cleanupIntervalMs: Math.max(1000, parseInt(String(streamConfig.cleanupIntervalMs ?? "60000"), 10)),
      steeringMode: String(streamConfig.steeringMode ?? "one-at-a-time") === "all" ? "all" : "one-at-a-time",
      followUpMode: String(streamConfig.followUpMode ?? "one-at-a-time") === "all" ? "all" : "one-at-a-time",
    },
    compact: {
      enabled: String(compactConfig.enabled ?? "true") !== "false",
      triggerRatio: Math.min(
        0.95,
        Math.max(0.05, parseFloat(String(compactConfig.triggerRatio ?? "0.75"))),
      ),
      keepRecent: Math.max(2, parseInt(String(compactConfig.keepRecent ?? "8"), 10)),
      keepRecentTokens: Math.max(
        100,
        parseInt(String(compactConfig.keepRecentTokens ?? "20000"), 10) || 20000,
      ),
      summaryModel: String(compactConfig.summaryModel ?? "auto").trim() || "auto",
      microCompact: {
        enabled: String((compactConfig.microCompact as Record<string, unknown> | undefined)?.enabled ?? "true") !== "false",
        toolResultMaxChars: Math.max(
          500,
          parseInt(
            String((compactConfig.microCompact as Record<string, unknown> | undefined)?.toolResultMaxChars ?? "4000"),
            10,
          ),
        ),
      },
      memoryFlush: {
        enabled: String((compactConfig.memoryFlush as Record<string, unknown> | undefined)?.enabled ?? "true") !== "false",
        maxFacts: Math.max(
          1,
          parseInt(String((compactConfig.memoryFlush as Record<string, unknown> | undefined)?.maxFacts ?? "5"), 10),
        ),
      },
    },
    heartbeat: {
      decisionEnabled: String(heartbeatYaml.decisionEnabled ?? "true") !== "false",
      quietCap: Math.max(1, parseInt(String(heartbeatYaml.quietCap ?? "8"), 10)),
      terminalAfterQuiet: Math.max(1, parseInt(String(heartbeatYaml.terminalAfterQuiet ?? "3"), 10)),
      gateNotifyCooldownMs: Math.max(
        0,
        parseInt(String(heartbeatYaml.gateNotifyCooldownMs ?? String(30 * 60_000)), 10),
      ),
      loopContract: {
        maxStaleRounds: Math.max(1, parseInt(String(loopContractYaml.maxStaleRounds ?? "3"), 10)),
        maxEvidence: Math.max(5, parseInt(String(loopContractYaml.maxEvidence ?? "50"), 10)),
      },
    },
    approvalGate: {
      notifyCooldownMs: Math.max(
        0,
        parseInt(String(approvalGateYaml.notifyCooldownMs ?? String(30 * 60_000)), 10),
      ),
    },
    reflection: reflectionYaml,
    skills: skillsYaml,
    goal: goalYaml,
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

/** 测试隔离：重置全局 config 单例（测试改 env 后需重新生成） */
export function resetAppConfigForTests(): void {
  globalForConfig.__appConfig = undefined as unknown as AppConfig;
}

/** 列出已配置 API Key 的 LLM 厂商 */
export function listConfiguredLlmProviders(config: AppConfig = getAppConfig()): string[] {
  return Object.entries(config.llm.providers)
    .filter(([, p]) => !!p.apiKey && p.apiKey !== "your-api-key-here")
    .map(([id]) => id);
}
