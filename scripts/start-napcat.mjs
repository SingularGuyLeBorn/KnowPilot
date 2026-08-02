import { spawn } from "child_process";
import path from "path";

const qqExe = "D:\\Program Files\\Tencent\\QQNT\\QQ.exe";
const dllPath = path.resolve("tools/napcat_framework/napiloader.dll");
const cjsPath = path.resolve("tools/napcat_framework/nativeLoader.cjs");
const exePath = path.resolve("tools/napcat_framework/napimain.exe");

console.log("🚀 正在启动 NapCat Framework 专属无头引擎 (免客户端更新/免浏览器挂载)...");

const child = spawn(exePath, [qqExe, dllPath, cjsPath], {
  cwd: path.resolve("tools/napcat_framework"),
  stdio: "inherit",
});

child.on("exit", (code) => {
  console.log(`NapCat 进程退出，退出码: ${code}`);
});
