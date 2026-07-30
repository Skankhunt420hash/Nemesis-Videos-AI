import { NextResponse } from "next/server";
import { scanModels } from "@/lib/models/scan";
import { MODEL_ENTRIES } from "@/lib/models/storage";
import { downloadModelByKey } from "@/lib/models/download";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const models = await scanModels();
  const firstMissing = MODEL_ENTRIES.find((def) => {
    const row = models.find((m) => m.key === def.key);
    return row && !row.ready && Boolean(def.sourceUrl);
  });
  if (!firstMissing) {
    return NextResponse.json({ started: false });
  }
  try {
    const out = await downloadModelByKey(firstMissing.key);
    return NextResponse.json({ started: true, model: firstMissing.key, path: out.path });
  } catch (e) {
    return NextResponse.json({ started: false, error: (e as Error).message }, { status: 502 });
  }
}
