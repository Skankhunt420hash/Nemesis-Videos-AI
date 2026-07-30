import { NextRequest, NextResponse } from "next/server";
import type { ModelKey } from "@/lib/models/storage";
import { MODEL_ENTRIES } from "@/lib/models/storage";
import { downloadModelByKey } from "@/lib/models/download";
import { appendDownloadLog } from "@/lib/models/downloadLog";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { model?: ModelKey };
  const key = body.model;
  const known = MODEL_ENTRIES.find((m) => m.key === key);
  if (!known) {
    return NextResponse.json({ error: "Unbekanntes Modell." }, { status: 400 });
  }
  const modelKey = known.key;

  if (!known.sourceUrl) {
    await appendDownloadLog(
      `${known.key}: Keine sourceUrl gesetzt. Setze MODEL_${known.key.toUpperCase()}_URL für echten Download.`,
    );
    return NextResponse.json({ ok: false, download: false, reason: "sourceUrl fehlt" }, { status: 400 });
  }

  try {
    const out = await downloadModelByKey(modelKey);
    return NextResponse.json({ ok: true, download: true, path: out.path });
  } catch (e) {
    return NextResponse.json({ ok: false, download: false, error: (e as Error).message }, { status: 502 });
  }
}
