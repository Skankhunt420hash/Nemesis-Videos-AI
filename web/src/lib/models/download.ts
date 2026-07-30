import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { appendDownloadLog } from "./downloadLog";
import type { ModelKey } from "./storage";
import { MODEL_ENTRIES, MODELS_STORAGE_ROOT } from "./storage";

export async function downloadModelByKey(key: ModelKey): Promise<{ path: string; sourceUrl: string }> {
  const known = MODEL_ENTRIES.find((m) => m.key === key);
  if (!known) throw new Error("Unbekanntes Modell.");
  if (!known.sourceUrl) throw new Error(`Keine sourceUrl gesetzt für ${known.key}.`);

  const targetDir = path.join(MODELS_STORAGE_ROOT, known.subfolder);
  await mkdir(targetDir, { recursive: true });
  const targetPath = path.join(
    targetDir,
    known.sourceFileName || path.basename(new URL(known.sourceUrl).pathname) || `${known.key}.bin`,
  );

  await appendDownloadLog(`${known.key}: Download starte → ${known.sourceUrl}`);
  const res = await fetch(known.sourceUrl, { signal: AbortSignal.timeout(20 * 60 * 1000) });
  if (!res.ok || !res.body) {
    await appendDownloadLog(`${known.key}: Download fehlgeschlagen HTTP ${res.status}`);
    throw new Error(`HTTP ${res.status}`);
  }

  await pipeline(Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>), createWriteStream(targetPath));
  await appendDownloadLog(`${known.key}: Download fertig → ${targetPath}`);
  return { path: targetPath, sourceUrl: known.sourceUrl };
}
