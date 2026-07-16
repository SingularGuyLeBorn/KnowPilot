-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
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
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "reentrant" BOOLEAN NOT NULL DEFAULT false,
    "sourceSlug" TEXT,
    "sourceMtime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Task" ("createdAt", "cronExpression", "delivered", "deliveredAt", "finishedAt", "id", "input", "name", "output", "pinned", "queuedAt", "sessionId", "sourceMtime", "sourceSlug", "startedAt", "status", "type", "updatedAt") SELECT "createdAt", "cronExpression", "delivered", "deliveredAt", "finishedAt", "id", "input", "name", "output", "pinned", "queuedAt", "sessionId", "sourceMtime", "sourceSlug", "startedAt", "status", "type", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE UNIQUE INDEX "Task_sourceSlug_key" ON "Task"("sourceSlug");
CREATE INDEX "Task_sessionId_status_delivered_idx" ON "Task"("sessionId", "status", "delivered");
CREATE INDEX "Task_status_delivered_createdAt_idx" ON "Task"("status", "delivered", "createdAt");
CREATE INDEX "Task_type_status_idx" ON "Task"("type", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
