/**
 * 一次性回填：存量 ChatMessage 按 createdAt 串成 parentId 链，activeLeafId=末条。
 * 执行完即删（逻辑保留在 infra/chatTree.backfillChatTree）。
 */
import { prisma } from "../db.js";
import { backfillChatTree } from "../infra/chatTree.js";

async function main() {
  const result = await backfillChatTree(prisma);
  console.log(`[migrate-chat-tree] sessions=${result.sessions} messages=${result.messages}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
