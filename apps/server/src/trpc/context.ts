/**
 * tRPC Context — 每个请求的上下文对象
 *
 * 注入：Prisma client、ServiceContainer、EventBus、AppConfig。
 * 所有 Router 通过 ctx.services.xxx 调用业务逻辑。
 */

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { prisma } from "../db.js";
import { getEventBus, type AppEventBus } from "../infra/eventBus.js";
import { getAppConfig, type AppConfig } from "../infra/config.js";
import { getServiceContainer, type ServiceContainer } from "../infra/serviceContainer.js";
import type { Request, Response } from "express";

export async function createContext({ req, res }: CreateExpressContextOptions): Promise<Context> {
  const eventBus = getEventBus();
  const config = getAppConfig();
  const services = getServiceContainer(prisma, eventBus, config);

  return {
    prisma,
    services,
    eventBus,
    config,
    req,
    res,
  };
}

/** 用于单元测试的内部 context 创建（不依赖 HTTP 请求） */
export async function createContextInner() {
  const eventBus = getEventBus();
  const config = getAppConfig();
  const services = getServiceContainer(prisma, eventBus, config);

  return {
    prisma,
    services,
    eventBus,
    config,
    req: undefined as unknown as Request,
    res: undefined as unknown as Response,
  };
}

export type Context = {
  prisma: typeof prisma;
  services: ServiceContainer;
  eventBus: AppEventBus;
  config: AppConfig;
  req: Request;
  res: Response;
};
