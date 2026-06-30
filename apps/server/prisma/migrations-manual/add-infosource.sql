CREATE TABLE IF NOT EXISTS "InfoSource" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'general',
  "description" TEXT NOT NULL DEFAULT '',
  "reliability" INTEGER NOT NULL DEFAULT 3,
  "language" TEXT NOT NULL DEFAULT 'auto',
  "tags" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sourceSlug" TEXT,
  "sourceMtime" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "InfoSource_name_key" ON "InfoSource"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "InfoSource_sourceSlug_key" ON "InfoSource"("sourceSlug");
CREATE INDEX IF NOT EXISTS "InfoSource_type_idx" ON "InfoSource"("type");
CREATE INDEX IF NOT EXISTS "InfoSource_enabled_idx" ON "InfoSource"("enabled");
