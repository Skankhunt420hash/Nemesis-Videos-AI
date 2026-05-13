import { NextResponse } from "next/server";
import { scanModels } from "@/lib/models/scan";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const models = await scanModels();
  return NextResponse.json({
    models,
    download: { status: "idle" },
  });
}
