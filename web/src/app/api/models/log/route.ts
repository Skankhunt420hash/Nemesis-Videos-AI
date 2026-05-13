import { NextRequest, NextResponse } from "next/server";
import { readDownloadLogTail } from "@/lib/models/downloadLog";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const maxRaw = req.nextUrl.searchParams.get("max");
  const max = Math.min(500_000, Math.max(1000, Number(maxRaw) || 14_000));
  const log = await readDownloadLogTail(max);
  return NextResponse.json({ log });
}
