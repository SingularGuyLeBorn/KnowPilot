import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, "../components/editor/MilkdownEditor.tsx");
let s = fs.readFileSync(src, "utf8");

if (!s.includes('import "./milkdown-editor.css"')) {
  s = s.replace(
    /^("use client";\r?\n)/,
    `$1\nimport "./milkdown-editor.css";\n`,
  );
}

const marker = "export function MilkdownStyles()";
const idx = s.indexOf(marker);
if (idx < 0) {
  console.log("MilkdownStyles already removed");
} else {
  // function ends at last `}` before EOF or next export — it's the last export
  s = s.slice(0, idx).replace(/\s+$/, "\n");
  fs.writeFileSync(src, s);
  console.log("stripped MilkdownStyles, new length", s.length);
}
