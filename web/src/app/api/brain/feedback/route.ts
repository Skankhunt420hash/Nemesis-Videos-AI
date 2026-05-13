import { NextRequest, NextResponse } from "next/server";
import { processFeedbackAndSuggest } from "@/lib/ai/brain";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      prompt?: string;
      mode?: string;
      rating?: number;
      durationSec?: number;
      motionEnabled?: boolean;
    };
    await processFeedbackAndSuggest({
      prompt: body.prompt ?? "",
      mode: body.mode ?? "t2v",
      rating: body.rating ?? 3,
      durationSec: body.durationSec ?? 8,
      motionEnabled: Boolean(body.motionEnabled),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
