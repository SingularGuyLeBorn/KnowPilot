import { spawn } from "child_process";
import path from "path";

const exePath = path.resolve("tools/napcat/bootmain/NapCatWinBootMain.exe");
console.log("🚀 正在为您启动 NapCatQQ 程序:", exePath);

const child = spawn(exePath, [], {
  cwd: path.resolve("tools/napcat/bootmain"),
  stdio: "inherit",
  detached: false,
});

child.on("error", (err) => {
  console.error("启动 NapCat 失败:", err);
});
