/**
 * MetaBlog parser 中 Kimi vision 上传占位 — KnowPilot 走 OCR 嵌入，不上传 Kimi
 */

export async function uploadFileToKimi(_filePath: string, _type: "image"): Promise<{ fileId: string }> {
  throw new Error("KnowPilot 未启用 Kimi 文件上传（非 vision 模型请使用 embedOcr）");
}
