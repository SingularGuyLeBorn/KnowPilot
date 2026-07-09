-- 性能优化索引（P5/P6/A11），与 schema.prisma 中的 @@index 声明一一对应。
-- 用 prisma db execute 直接应用，避免 db push 连带删除 FTS 虚拟表。
CREATE INDEX IF NOT EXISTS "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatSession_agentId_updatedAt_idx" ON "ChatSession"("agentId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Run_agentId_status_idx" ON "Run"("agentId", "status");
CREATE INDEX IF NOT EXISTS "Run_sessionId_idx" ON "Run"("sessionId");
CREATE INDEX IF NOT EXISTS "Run_createdAt_idx" ON "Run"("createdAt");
CREATE INDEX IF NOT EXISTS "Log_level_createdAt_idx" ON "Log"("level", "createdAt");
CREATE INDEX IF NOT EXISTS "Log_component_idx" ON "Log"("component");
CREATE INDEX IF NOT EXISTS "Approval_status_createdAt_idx" ON "Approval"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Skill_enabled_idx" ON "Skill"("enabled");
