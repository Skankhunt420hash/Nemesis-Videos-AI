import { mkdir } from "node:fs/promises";
import path from "node:path";
import { MODEL_ENTRIES, MODELS_STORAGE_ROOT } from "@/lib/models/storage";
import { folderTotalBytes } from "@/lib/models/disk";
import type { ModelKey } from "@/lib/models/storage";

export async function scanModels(): Promise<
  Array<{ key: ModelKey; name: string; directory: string; bytes: number; ready: boolean }>
> {
  await mkdir(MODELS_STORAGE_ROOT, { recursive: true });
  const list = await Promise.all(
    MODEL_ENTRIES.map(async (def) => {
      const dir = path.join(MODELS_STORAGE_ROOT, def.subfolder);
      await mkdir(dir, { recursive: true });
      const bytes = await folderTotalBytes(dir);
      const relativeDir = path.join("storage", "models", def.subfolder).replace(/\\/g, "/");
      return {
        key: def.key,
        name: def.name,
        directory: relativeDir,
        bytes,
        ready: bytes >= def.minReadyBytes,
      };
    }),
  );
  return list;
}
