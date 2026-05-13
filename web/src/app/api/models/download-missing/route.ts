import { NextResponse } from "next/server";
import { scanModels } from "@/lib/models/scan";
import { MODEL_ENTRIES } from "@/lib/models/storage";
import { appendDownloadLog } from "@/lib/models/downloadLog";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const models = await scanModels();
  const firstMissing = MODEL_ENTRIES.find((def) => {
    const row = models.find((m) => m.key === def.key);
    return row && !row.ready;
  });
  if (!firstMissing) {
    return NextResponse.json({ started: false });
  }
  await appendDownloadLog(
    `Fehlend → ${firstMissing.key}: Dateien nach storage/models/${firstMissing.subfolder}/ legen.`,
  );
  return NextResponse.json({ started: true, model: firstMissing.key });
}
