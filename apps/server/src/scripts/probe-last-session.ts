import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const session = await prisma.chatSession.findFirst({
    orderBy: { createdAt: "desc" },
    include: { messages: true },
  });
  console.log(
    JSON.stringify(
      session?.messages.map((m) => ({
        role: m.role,
        content: m.content.slice(0, 80),
        finishReason: m.finishReason,
      })),
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(console.error);
