import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/ai/store";
import { syncGenerationJobFromComfy } from "@/lib/ai/syncJobFromComfy";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await ctx.params;
  const sync = req.nextUrl.searchParams.get("sync") === "1";

  let job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job nicht gefunden." }, { status: 404 });

  if (sync) {
    job = (await syncGenerationJobFromComfy(jobId)) ?? job;
  }

  return NextResponse.json(job);
}
