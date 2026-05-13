import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function folderTotalBytes(absDir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(absDir, e.name);
    if (e.isDirectory()) {
      total += await folderTotalBytes(p);
    } else if (e.isFile()) {
      try {
        const s = await stat(p);
        total += s.size;
      } catch {
        /* ignore */
      }
    }
  }
  return total;
}
