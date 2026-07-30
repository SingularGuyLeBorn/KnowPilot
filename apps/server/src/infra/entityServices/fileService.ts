/**
 * File 资源元数据 Service（从 services.ts 拆出的叶子）。
 */

import fs from "fs";
import path from "path";
import type {
  CreateFileInput,
  UpdateFileInput,
  ListFilesInput,
  OperationResult,
} from "@knowpilot/shared";
import { BaseService } from "../../services.js";
import { success, failureFromError } from "../../trpc/result.js";

export class FileService extends BaseService<CreateFileInput, UpdateFileInput, ListFilesInput, any> {
  readonly entityName = "file";
  protected get delegate() { return this.prisma.file; }
  protected formatEntity(raw: any) { return raw; }
  protected buildListWhere(input: ListFilesInput) {
    const where: any = {};
    if (input.keyword) where.name = { contains: input.keyword };
    return where;
  }
  protected buildCreateData(input: CreateFileInput) { return input; }
  protected buildUpdateData(input: UpdateFileInput) { const { id: _id, ...data } = input; return data; }

  async upload(input: {
    name: string;
    mimeType: string;
    size: number;
    data: string;
    garden?: string;
    postId?: string;
    draftKey?: string;
  }): Promise<OperationResult<any>> {
    const start = Date.now();
    try {
      const { name, mimeType, size, data, garden, postId, draftKey } = input;
      const safeName = path.basename(name);
      const ext = path.extname(safeName);
      const baseName = path.basename(safeName, ext).replace(/[^\w\u4e00-\u9fff.-]+/g, "_") || "file";
      const uniqueName = `${baseName}_${Date.now().toString(36)}${ext}`;
      const uploadRoot = path.resolve(this.config.uploadDir);

      // 按 postId（或草稿 draftKey）分目录，与 slug 解耦——改 slug 不断图片链
      const segments: string[] = [];
      if (garden) segments.push(garden);
      if (postId) {
        segments.push(postId);
      } else if (draftKey) {
        segments.push("_draft", draftKey);
      }

      const destDir = segments.length > 0 ? path.resolve(uploadRoot, ...segments) : uploadRoot;
      const relToRoot = path.relative(uploadRoot, destDir);
      if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
        throw new Error(`非法上传目录：拒绝写出 uploads 根之外（garden/postId 穿越）`);
      }
      fs.mkdirSync(destDir, { recursive: true });

      const filePath = path.join(destDir, uniqueName);
      const buffer = Buffer.from(data, "base64");
      fs.writeFileSync(filePath, buffer);

      const fileUrl = `/uploads/${[...segments, uniqueName].join("/")}`;
      const fileRecord = await this.prisma.file.create({
        data: { name: safeName, path: filePath, mimeType, size, url: fileUrl },
      });
      this.eventBus.emit("file.created", fileRecord);
      return success({ data: fileRecord, operation: "upload", entity: "file", durationMs: Date.now() - start });
    } catch (error: any) {
      return failureFromError(error, "upload", "file", "FILE_UPLOAD_FAILED");
    }
  }
}
