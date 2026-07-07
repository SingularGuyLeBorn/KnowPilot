/**
 * E2E 侧 tRPC HTTP 客户端（走真实 server:3010，避免 Playwright 直接 import server TS）
 */

export const SERVER_URL = process.env.E2E_SERVER_URL ?? "http://127.0.0.1:3010";

type TrpcBatchItem<T> = {
  result?: { data?: { json?: T } };
  error?: { message?: string; json?: { message?: string } };
};

async function parseBatch<T>(res: Response, procedure: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`tRPC ${procedure} HTTP ${res.status}`);
  }
  const batch = (await res.json()) as TrpcBatchItem<T>[];
  const first = batch[0];
  const errMsg = first?.error?.json?.message ?? first?.error?.message;
  if (errMsg) throw new Error(errMsg);
  if (!first?.result?.data?.json) {
    throw new Error(`tRPC ${procedure} 返回空数据`);
  }
  return first.result.data.json;
}

export async function trpcQuery<T>(procedure: string, input: unknown = null): Promise<T> {
  const url = new URL(`${SERVER_URL}/api/trpc/${procedure}`);
  url.searchParams.set("batch", "1");
  url.searchParams.set("input", JSON.stringify({ 0: { json: input } }));
  const res = await fetch(url, { cache: "no-store" });
  return parseBatch<T>(res, procedure);
}

export async function trpcMutate<T>(procedure: string, input: unknown): Promise<T> {
  const url = new URL(`${SERVER_URL}/api/trpc/${procedure}?batch=1`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 0: { json: input } }),
  });
  return parseBatch<T>(res, procedure);
}
