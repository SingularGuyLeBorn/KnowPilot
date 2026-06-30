/**
 * 清理 Vitest 误写入 dev.db 的测试会话（一次性，可重复执行）
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const polluted = await prisma.chatSession.findMany({
    where: {
      OR: [
        { model: "invalid-model-for-test" },
        { title: { startsWith: "test-fail-" } },
      ],
    },
    select: { id: true, title: true, model: true },
  });

  if (!polluted.length) {
    console.log("✅ 无需清理的测试会话");
    return;
  }

  for (const s of polluted) {
    await prisma.chatSession.delete({ where: { id: s.id } });
    console.log(`  🗑️ 已删除测试会话: ${s.title} (${s.model})`);
  }
  console.log(`\n✅ 共清理 ${polluted.length} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
