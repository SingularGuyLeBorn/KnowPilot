-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "excerpt" TEXT,
    "coverImage" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "tags" TEXT NOT NULL DEFAULT '',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "sourceMtime" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "autoName" TEXT,
    "description" TEXT,
    "model" TEXT NOT NULL DEFAULT 'deepseek-chat',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "tools" TEXT NOT NULL DEFAULT '',
    "sourceSlug" TEXT,
    "sourceMtime" DATETIME,
    "tier" TEXT NOT NULL DEFAULT 'sub',
    "workspaceId" TEXT,
    "parentId" TEXT,
    "source" TEXT,
    "apiKey" TEXT,
    "heartbeatModel" TEXT,
    "heartbeat" JSONB,
    "heartbeatSuspendedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Agent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "icon" TEXT,
    "trigger" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metaJson" TEXT,
    "sourceSlug" TEXT,
    "sourceMtime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "autoName" TEXT,
    "model" TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
    "systemPrompt" TEXT,
    "agentId" TEXT,
    "parentSessionId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'chat',
    "status" TEXT NOT NULL DEFAULT 'active',
    "taskDescription" TEXT,
    "isMainSession" BOOLEAN NOT NULL DEFAULT false,
    "contextSummary" TEXT,
    "contextCompactedAt" DATETIME,
    "rotatedToSessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ChatSession_parentSessionId_fkey" FOREIGN KEY ("parentSessionId") REFERENCES "ChatSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "toolCalls" JSONB,
    "toolResults" JSONB,
    "tokenUsage" JSONB,
    "finishReason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionQueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceName" TEXT,
    "agentMessageId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "attachments" JSONB,
    "skillId" TEXT,
    "skillPrompt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionQueueItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionStreamEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "args" JSONB,
    "env" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceSlug" TEXT,
    "sourceMtime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'episodic',
    "strength" REAL NOT NULL DEFAULT 1.0,
    "keywords" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "agentId" TEXT,
    "contentHash" TEXT,
    "sourceSlug" TEXT,
    "sourceMtime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GitRepo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "remoteUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sessionId" TEXT,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" DATETIME,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "queuedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "input" JSONB,
    "output" JSONB,
    "cronExpression" TEXT,
    "sourceSlug" TEXT,
    "sourceMtime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT NOT NULL DEFAULT '',
    "reliability" INTEGER NOT NULL DEFAULT 3,
    "language" TEXT NOT NULL DEFAULT 'auto',
    "tags" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "fetchInterval" INTEGER,
    "lastFetchedAt" DATETIME,
    "lastFetchStatus" TEXT,
    "lastFetchError" TEXT,
    "sourceSlug" TEXT,
    "sourceMtime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoSourceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "publishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'fetched',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InfoSourceItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "InfoSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "path" TEXT NOT NULL,
    "managerAgentId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "systemType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workspace_managerAgentId_fkey" FOREIGN KEY ("managerAgentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trigger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toolName" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" DATETIME,
    "decisionNote" TEXT,
    "executedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetId" TEXT,
    "description" TEXT,
    "parametersSchema" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT,
    "sessionId" TEXT,
    "status" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "toolCalls" JSONB,
    "tokenUsage" JSONB,
    "error" JSONB,
    "durationMs" INTEGER,
    "toolCallCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Run_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "description" TEXT,
    "variables" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "sourceSlug" TEXT,
    "sourceMtime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromAgentId" TEXT NOT NULL,
    "toAgentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "content" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'command',
    "source" TEXT NOT NULL DEFAULT 'manager',
    "depth" INTEGER NOT NULL DEFAULT 1,
    "taskRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    CONSTRAINT "AgentMessage_fromAgentId_fkey" FOREIGN KEY ("fromAgentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_toAgentId_fkey" FOREIGN KEY ("toAgentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Post_slug_key" ON "Post"("slug");

-- CreateIndex
CREATE INDEX "Post_published_createdAt_idx" ON "Post"("published", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Post_deletedAt_idx" ON "Post"("deletedAt");

-- CreateIndex
CREATE INDEX "Post_category_idx" ON "Post"("category");

-- CreateIndex
CREATE INDEX "Post_slug_idx" ON "Post"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_sourceSlug_key" ON "Agent"("sourceSlug");

-- CreateIndex
CREATE INDEX "Agent_tier_status_idx" ON "Agent"("tier", "status");

-- CreateIndex
CREATE INDEX "Agent_workspaceId_tier_idx" ON "Agent"("workspaceId", "tier");

-- CreateIndex
CREATE INDEX "Agent_parentId_idx" ON "Agent"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_sourceSlug_key" ON "Skill"("sourceSlug");

-- CreateIndex
CREATE INDEX "Skill_enabled_idx" ON "Skill"("enabled");

-- CreateIndex
CREATE INDEX "ChatSession_parentSessionId_status_updatedAt_idx" ON "ChatSession"("parentSessionId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatSession_kind_status_idx" ON "ChatSession"("kind", "status");

-- CreateIndex
CREATE INDEX "ChatSession_agentId_updatedAt_idx" ON "ChatSession"("agentId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatSession_updatedAt_idx" ON "ChatSession"("updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionQueueItem_sessionId_order_idx" ON "SessionQueueItem"("sessionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SessionQueueItem_sessionId_agentMessageId_key" ON "SessionQueueItem"("sessionId", "agentMessageId");

-- CreateIndex
CREATE INDEX "SessionStreamEvent_sessionId_id_idx" ON "SessionStreamEvent"("sessionId", "id");

-- CreateIndex
CREATE INDEX "SessionStreamEvent_createdAt_idx" ON "SessionStreamEvent"("createdAt");

-- CreateIndex
CREATE INDEX "Log_level_createdAt_idx" ON "Log"("level", "createdAt");

-- CreateIndex
CREATE INDEX "Log_component_idx" ON "Log"("component");

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_name_key" ON "McpServer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_sourceSlug_key" ON "McpServer"("sourceSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_sourceSlug_key" ON "Memory"("sourceSlug");

-- CreateIndex
CREATE UNIQUE INDEX "GitRepo_path_key" ON "GitRepo"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Task_sourceSlug_key" ON "Task"("sourceSlug");

-- CreateIndex
CREATE INDEX "Task_sessionId_status_delivered_idx" ON "Task"("sessionId", "status", "delivered");

-- CreateIndex
CREATE INDEX "Task_status_delivered_createdAt_idx" ON "Task"("status", "delivered", "createdAt");

-- CreateIndex
CREATE INDEX "Task_type_status_idx" ON "Task"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InfoSource_name_key" ON "InfoSource"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InfoSource_sourceSlug_key" ON "InfoSource"("sourceSlug");

-- CreateIndex
CREATE INDEX "InfoSource_type_idx" ON "InfoSource"("type");

-- CreateIndex
CREATE INDEX "InfoSource_enabled_idx" ON "InfoSource"("enabled");

-- CreateIndex
CREATE INDEX "InfoSourceItem_sourceId_idx" ON "InfoSourceItem"("sourceId");

-- CreateIndex
CREATE INDEX "InfoSourceItem_status_idx" ON "InfoSourceItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InfoSourceItem_sourceId_guid_key" ON "InfoSourceItem"("sourceId", "guid");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_path_key" ON "Workspace"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_managerAgentId_key" ON "Workspace"("managerAgentId");

-- CreateIndex
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");

-- CreateIndex
CREATE INDEX "Workspace_isSystem_idx" ON "Workspace"("isSystem");

-- CreateIndex
CREATE UNIQUE INDEX "Trigger_name_key" ON "Trigger"("name");

-- CreateIndex
CREATE INDEX "Approval_status_createdAt_idx" ON "Approval"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tool_name_key" ON "Tool"("name");

-- CreateIndex
CREATE INDEX "Run_agentId_status_idx" ON "Run"("agentId", "status");

-- CreateIndex
CREATE INDEX "Run_sessionId_idx" ON "Run"("sessionId");

-- CreateIndex
CREATE INDEX "Run_createdAt_idx" ON "Run"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_name_key" ON "Prompt"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_sourceSlug_key" ON "Prompt"("sourceSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_name_key" ON "Credential"("name");

-- CreateIndex
CREATE INDEX "AgentMessage_toAgentId_status_idx" ON "AgentMessage"("toAgentId", "status");

-- CreateIndex
CREATE INDEX "AgentMessage_fromAgentId_idx" ON "AgentMessage"("fromAgentId");

