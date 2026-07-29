import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app");
const body = `export { default } from "@/components/layout/RouteLoading";\n`;
const dirs = [
  "agents",
  "skills",
  "mcp",
  "memories",
  "prompts",
  "tools",
  "runs",
  "search",
  "inbox",
  "platform-sync",
  "channels",
  "triggers",
  "approvals",
  "workspaces",
  "files",
  "git",
  "tasks",
  "logs",
  "credentials",
  "free-models",
  "dashboard",
  "settings",
  "subagents",
  "sources",
  "dead-letters",
  "posts",
];

for (const d of dirs) {
  const p = path.join(root, d, "loading.tsx");
  fs.writeFileSync(p, body);
  console.log(p);
}
fs.writeFileSync(path.join(root, "posts", "[slug]", "loading.tsx"), body);
fs.writeFileSync(path.join(root, "loading.tsx"), body);
console.log("done");
