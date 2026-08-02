import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const qqDir = "D:\\Program Files\\Tencent\\QQNT";
const exePath = path.join(qqDir, "NapCatWinBootMain.exe");

if (!fs.existsSync(exePath)) {
  const srcHook = path.resolve("tools/napcat/bootmain/NapCatWinBootHook.dll");
  const srcMain = path.resolve("tools/napcat/bootmain/NapCatWinBootMain.exe");
  fs.copyFileSync(srcHook, path.join(qqDir, "NapCatWinBootHook.dll"));
  fs.copyFileSync(srcMain, exePath);
}

console.log("🚀 启动 NapCatQQ 注入引擎...");
console.log("工作目录:", qqDir);

const child = spawn(exePath, [], {
  cwd: qqDir,
  stdio: "inherit",
  detached: true,
});

child.unref();
console.log("✅ NapCatQQ 已成功唤起！");
