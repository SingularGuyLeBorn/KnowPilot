/** HTTP 层复现前端 tRPC 请求 */
const base = "http://localhost:3010/api/trpc";

async function query(path: string, input: unknown) {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const url = `${base}/${path}?input=${encoded}`;
  const res = await fetch(url);
  const text = await res.text();
  console.log(path, res.status, text.slice(0, 300));
}

async function mutate(path: string, input: unknown) {
  const url = `${base}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const text = await res.text();
  console.log(path, res.status, text.slice(0, 400));
}

await query("agent.list", { page: 1, pageSize: 50 });
await query("session.list", { page: 1, pageSize: 30 });
await query("agent.llmProviders", undefined);
await mutate("agent.chat", { message: "ping" });

export {};
