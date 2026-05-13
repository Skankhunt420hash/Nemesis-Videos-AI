import { NextResponse } from "next/server";
import { listBrainSuggestions } from "@/lib/ai/store";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const suggestions = await listBrainSuggestions();
  return NextResponse.json({ suggestions });
}
