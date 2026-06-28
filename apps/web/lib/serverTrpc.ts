/**
 * RSC / SSR 侧 tRPC 查询（走 Next rewrite 或 SERVER_INTERNAL_URL）
 */

function getServerBaseUrl(): string {
  return (
    process.env.SERVER_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_SERVER_URL ??
    "http://127.0.0.1:3010"
  );
}

type TrpcBatchItem<T> = {
  result?: { data?: { json?: T } };
  error?: { message?: string };
};

/** 无 input 的 tRPC query（superjson batch GET） */
export async function trpcQuery<T>(procedure: string): Promise<T> {
  const url = new URL(`${getServerBaseUrl()}/api/trpc/${procedure}`);
  url.searchParams.set("batch", "1");
  url.searchParams.set("input", JSON.stringify({ 0: { json: null } }));

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`tRPC ${procedure} HTTP ${res.status}`);
  }

  const batch = (await res.json()) as TrpcBatchItem<T>[];
  const first = batch[0];
  if (first?.error?.message) {
    throw new Error(first.error.message);
  }
  if (!first?.result?.data) {
    throw new Error(`tRPC ${procedure} 返回空数据`);
  }
  return first.result.data.json as T;
}
