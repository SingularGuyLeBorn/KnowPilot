/**
 * 清空所有 ChatSession / ChatMessage 数据（不可逆）
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const messagesBefore = await prisma.chatMessage.count();
  const sessionsBefore = await prisma.chatSession.count();

  await prisma.chatMessage.deleteMany();
  await prisma.chatSession.deleteMany();

  const messagesAfter = await prisma.chatMessage.count();
  const sessionsAfter = await prisma.chatSession.count();

  console.log(`🗑️ 已清空会话数据：`);
  console.log(`   ChatMessage: ${messagesBefore} → ${messagesAfter}`);
  console.log(`   ChatSession: ${sessionsBefore} → ${sessionsAfter}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
