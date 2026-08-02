/**
 * IM 通道启动入口：注册 QQ / 飞书 Adapter 并挂到 MessageGateway。
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
import { createQqOfficialBotAdapter, loadQqBotConfigFromEnv } from "./qqOfficialBot.js";
import { createFeishuBotAdapter, loadFeishuBotConfigFromEnv } from "./feishuBot.js";
import { createOneBotAdapter, loadOneBotConfigFromEnv } from "./onebotBot.js";

export async function bootstrapMessageChannels(opts: {
  prisma: PrismaClient;
  services: ServiceContainer;
  config: AppConfig;
}): Promise<void> {
  initMessageGateway(opts);
  registerChannelAdapter(createQqOfficialBotAdapter(loadQqBotConfigFromEnv()));
  registerChannelAdapter(createFeishuBotAdapter(loadFeishuBotConfigFromEnv()));
  registerChannelAdapter(createOneBotAdapter(loadOneBotConfigFromEnv()));
  await startAllChannelAdapters();
}

export { stopAllChannelAdapters };
