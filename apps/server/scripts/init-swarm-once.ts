/**
 * 一次性 Swarm 初始化（供 reset-init 调用）
 */
import { PrismaClient } from "@prisma/client";
import { getAppConfig, loadRootEnv } from "../src/infra/config.js";
import { getEventBus } from "../src/infra/eventBus.js";
import { getServiceContainer } from "../src/infra/serviceContainer.js";
import { initSwarm } from "../src/infra/swarmInitializer.js";

loadRootEnv();
const config = getAppConfig();
const prisma = new PrismaClient();
const services = getServiceContainer(prisma, getEventBus(), config);

try {
  await initSwarm(prisma, services, config);
  console.log("  ✅ Swarm 初始化完成");
} finally {
  await prisma.$disconnect();
}
