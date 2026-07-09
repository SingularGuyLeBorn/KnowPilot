/**
 * 实体同步器通用接口
 *
 * 每个需要 content/ 目录作为事实源的实体，都需要实现一个 Syncer。
 */

import { PrismaClient } from "@prisma/client";

export interface SyncRecord<T = unknown> {
  /** 文件相对路径（不含扩展名），作为稳定的本地标识 */
  slug: string;
  /** 本地源文件最后修改时间，用于增量同步判断 */
  mtime: Date;
  /** 解析后的实体数据 */
  data: T;
}

export interface Syncer<T = unknown> {
  /** 实体名，用于日志输出 */
  readonly entityName: string;

  /** content 子目录名，例如 "posts"、"agents" */
  readonly contentDirName: string;

  /** 该同步器处理的文件扩展名 */
  readonly extensions: string[];

  /** 扫描目录并解析所有本地文件 */
  scan(prisma: PrismaClient, contentDir: string): Promise<SyncRecord<T>[]>;

  /**
   * A13：仅解析单个文件并返回其 SyncRecord（解析失败返回 null）。
   * 供 watch 模式 add/change 事件使用，避免每次变更都全目录扫描。
   * 实现应与 scan 内的单文件解析逻辑一致（scan 通常委托本方法）。
   */
  scanFile?(filePath: string, contentDir: string): Promise<SyncRecord<T> | null>;

  /** 将单条记录 upsert 到数据库 */
  upsert(prisma: PrismaClient, record: SyncRecord<T>): Promise<void>;

  /** 清理数据库中已不存在本地文件的记录。contentDir 可选，用于磁盘存在性检查（避免误删解析失败的记录）。 */
  cleanup(prisma: PrismaClient, activeSlugs: string[], contentDir?: string): Promise<number>;

  /** 获取数据库中现有记录的 slug → sourceMtime 映射，用于增量同步 */
  getExistingMtimes(prisma: PrismaClient): Promise<Map<string, Date>>;
}
