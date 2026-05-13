import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(root, "..");
const localPath = path.join(webRoot, ".env.local");
const examplePath = path.join(webRoot, ".env.example");

if (!fs.existsSync(localPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, localPath);
    console.log("[ensure-env] .env.local aus .env.example erstellt.");
  } else {
    const fallback =
      "# Nemesis Videos AI\nCOMFY_URL=http://127.0.0.1:8188\nNEXT_PUBLIC_COMFY_HOST=127.0.0.1:8188\nNEXT_PUBLIC_COMFY_WS_URL=ws://127.0.0.1:8188\n";
    fs.writeFileSync(localPath, fallback, "utf-8");
    console.log("[ensure-env] .env.local mit Standardwerten erstellt.");
  }
}
