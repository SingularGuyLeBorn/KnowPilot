-- session_rotate 反向血缘：新会话 → 旧会话（rotatedTo 已在 0_init）
ALTER TABLE "ChatSession" ADD COLUMN "rotatedFromSessionId" TEXT;

CREATE INDEX "ChatSession_rotatedFromSessionId_idx" ON "ChatSession"("rotatedFromSessionId");
