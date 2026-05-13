import { mkdir, appendFile, readFile } from "node:fs/promises";
import path from "node:path";

const LOG_PATH = path.join(process.cwd(), "storage", "models", "download.log");

async function ensure(): Promise<void> {
  await mkdir(path.dirname(LOG_PATH), { recursive: true });
}

export async function appendDownloadLog(line: string): Promise<void> {
  await ensure();
  const stamp = new Date().toISOString();
  await appendFile(LOG_PATH, `[${stamp}] ${line}\n`, "utf-8");
}

export async function readDownloadLogTail(maxChars: number): Promise<string> {
  try {
    const raw = await readFile(LOG_PATH, "utf-8");
    if (raw.length <= maxChars) return raw;
    return raw.slice(-maxChars);
  } catch {
    return "";
  }
}
