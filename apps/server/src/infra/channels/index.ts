/**
 * IM 通道启动入口：注册企微 / QQ Adapter 并挂到 MessageGateway。
 */

import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config.js";
import type { ServiceContainer } from "../serviceContainer.js";
import {
  initMessageGateway,
  registerChannelAdapter,
  startAllChannelAdapters,
  stopAllChannelAdapters,
} from "../messageGateway.js";
import { createWecomAibotAdapter, loadWecomAibotConfigFromEnv } from "./wecomAibotWs.js";
import { createQqOfficialBotAdapter, loadQqBotConfigFromEnv } from "./qqOfficialBot.js";

export async function bootstrapMessageChannels(opts: {
  prisma: PrismaClient;
  services: ServiceContainer;
  config: AppConfig;
}): Promise<void> {
  initMessageGateway(opts);
  registerChannelAdapter(createWecomAibotAdapter(loadWecomAibotConfigFromEnv()));
  registerChannelAdapter(createQqOfficialBotAdapter(loadQqBotConfigFromEnv()));
  await startAllChannelAdapters();
}

export { stopAllChannelAdapters };
