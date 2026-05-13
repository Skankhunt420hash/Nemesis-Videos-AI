import { NextRequest, NextResponse } from "next/server";
import { chooseBackend, dispatchCloud, dispatchLocal } from "@/lib/ai/providers";
import { createJob, updateJob } from "@/lib/ai/store";
import { normalizeGenerationRequest } from "@/lib/ai/validation";
import type { GenerationRequest } from "@/lib/ai/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as GenerationRequest;
    const normalized = normalizeGenerationRequest(body);

    if (
      !normalized.prompt &&
      normalized.mode !== "upscale" &&
      normalized.photoTool !== "background-remove"
    ) {
      return NextResponse.json({ error: "Prompt ist erforderlich." }, { status: 400 });
    }

    const needsImage =
      normalized.mode === "i2v" ||
      normalized.mode === "upscale" ||
      normalized.photoTool === "enhance" ||
      normalized.photoTool === "background-remove" ||
      normalized.photoTool === "retouch" ||
      (normalized.mode === "i2i" &&
        normalized.photoTool !== "generate" &&
        normalized.photoTool !== undefined) ||
      (normalized.mode === "i2i" && normalized.photoTool === "style");

    if (needsImage && !normalized.imageInputPath) {
      return NextResponse.json(
        { error: "imageInputPath ist für diesen Modus erforderlich." },
        { status: 400 },
      );
    }

    let backend: "local" | "cloud";
    try {
      backend = await chooseBackend(normalized.backendMode || "hybrid");
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 503 });
    }

    const job = await createJob(normalized, backend);
    await updateJob(job.id, { status: "running" }, `Backend gewählt: ${backend}`);

    try {
      const remoteId =
        backend === "local"
          ? await dispatchLocal(normalized)
          : await dispatchCloud(normalized);
      await updateJob(
        job.id,
        { remoteJobId: remoteId, status: "queued" },
        `Remote Job: ${remoteId}`,
      );
    } catch (err) {
      await updateJob(
        job.id,
        { status: "failed", error: (err as Error).message },
        "Dispatch fehlgeschlagen",
      );
      throw err;
    }

    return NextResponse.json({
      jobId: job.id,
      status: "queued",
      backendUsed: backend,
      durationSec: normalized.durationSec,
      mode: normalized.mode,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Unbekannter Fehler." },
      { status: 500 },
    );
  }
}
