import { NextRequest, NextResponse } from "next/server";
import { MODEL_ENTRIES } from "@/lib/models/storage";
import { appendDownloadLog } from "@/lib/models/downloadLog";
import type { ModelKey } from "@/lib/models/storage";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { model?: ModelKey };
  const key = body.model;
  const known = MODEL_ENTRIES.find((m) => m.key === key);
  if (!known) {
    return NextResponse.json({ error: "Unbekanntes Modell." }, { status: 400 });
  }
  await appendDownloadLog(
    `${known.key}: Hinweis — kopiere die Gewichte nach storage/models/${known.subfolder}/ oder nutze huggingface-cli auf diesem Rechner (HF nicht automatisch).`,
  );
  return NextResponse.json({ ok: true });
}
