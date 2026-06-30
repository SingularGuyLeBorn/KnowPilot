import fs from "fs";
import { getAppConfig } from "../infra/config.js";
import { extractTextFromImage } from "../infra/ocrService.js";

async function main() {
  const config = getAppConfig();
  const base64 = fs.readFileSync("../../content/uploads/00_abstract_mqxw9uuq.png").toString("base64");
  const r = await extractTextFromImage(config, { base64, mimeType: "image/png", chatSupportsVision: false });
  console.log("length:", r.text.length);
  console.log(r.text.slice(0, 800));
}

main().catch(console.error);
