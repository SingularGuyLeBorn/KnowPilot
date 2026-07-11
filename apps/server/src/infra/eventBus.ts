/**
 * 进程内事件总线
 *
 * L1 阶段作为轻量级 EventEmitter 使用。
 * L4 阶段可扩展为分布式消息队列（如 BullMQ）的适配器。
 *
 * 事件命名约定：`{entity}.{action}`
 * 例如：post.created, agent.updated, skill.deleted
 */

import { EventEmitter } from "events";

/* ─── 类型定义 ─── */

/** 事件动作类型 */
export type EventAction = "created" | "updated" | "deleted";

/** 事件名称（实体.动作） */
export type EntityEventName = `${string}.${EventAction}`;

/** 事件载荷 */
export interface EntityEventPayload<T = unknown> {
  /** 实体名称 */
  entity: string;
  /** 事件动作 */
  action: EventAction;
  /** 事件数据 */
  data: T;
  /** ISO 8601 时间戳 */
  timestamp: string;
}

/* ─── 事件总线实现 ─── */

/**
 * 应用事件总线
 *
 * 当前实现：基于 Node.js EventEmitter 的进程内总线。
 * 设计用于 L4 触发器引擎对接（Trigger 监听事件 → 执行 Skill / Task）。
 */
export class AppEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // 提升监听器上限：18 个实体 × 若干监听器
    this.emitter.setMaxListeners(100);
  }

  /** 发布实体事件 */
  emit<T>(event: EntityEventName, data: T): void {
    const payload: EntityEventPayload<T> = {
      entity: event.split(".")[0],
      action: event.split(".")[1] as EventAction,
      data,
      timestamp: new Date().toISOString(),
    };

    this.emitter.emit(event, payload);

    // 同时发布通配事件，供全局监听器（如日志系统）使用
    this.emitter.emit("*", payload);
  }

  /** 监听特定事件 */
  on<T = unknown>(
    event: EntityEventName | "*",
    handler: (payload: EntityEventPayload<T>) => void,
  ): void {
    this.emitter.on(event, handler);
  }

  /** 一次性监听 */
  once<T = unknown>(
    event: EntityEventName | "*",
    handler: (payload: EntityEventPayload<T>) => void,
  ): void {
    this.emitter.once(event, handler);
  }

  /** 移除监听器 */
  off(event: EntityEventName | "*", handler: (...args: any[]) => void): void {
    this.emitter.off(event, handler);
  }

  /** 销毁所有监听器 */
  destroy(): void {
    this.emitter.removeAllListeners();
  }
}

/* ─── 全局单例 ─── */

const globalForEventBus = globalThis as unknown as { __eventBus: AppEventBus };

export function getEventBus(): AppEventBus {
  if (!globalForEventBus.__eventBus) {
    globalForEventBus.__eventBus = new AppEventBus();
  }
  return globalForEventBus.__eventBus;
}

/** 测试隔离：重置全局 eventBus 单例 */
export function resetEventBusForTests(): void {
  if (globalForEventBus.__eventBus) globalForEventBus.__eventBus.destroy();
  globalForEventBus.__eventBus = undefined as unknown as AppEventBus;
}
