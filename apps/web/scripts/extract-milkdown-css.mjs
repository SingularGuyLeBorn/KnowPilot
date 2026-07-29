import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, "../components/editor/MilkdownEditor.tsx");
const s = fs.readFileSync(src, "utf8");
const start = s.indexOf("style.textContent = `");
if (start < 0) throw new Error("start not found");
const contentStart = start + "style.textContent = `".length;
const end = s.indexOf("`;", contentStart);
if (end < 0) throw new Error("end not found");
const css = s.slice(contentStart, end).trim() + "\n";
const out = path.join(dir, "../components/editor/milkdown-editor.css");
fs.writeFileSync(out, css);
console.log("wrote", out, css.length);
