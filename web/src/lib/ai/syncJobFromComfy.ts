import {
  extractOutputViewUrls,
  getHistoryEntry,
  historyEntryIndicatesFailure,
} from "@/lib/comfy/history";
import { fetchComfyHistoryPayload } from "./fetchComfyHistory";
import type { GenerationJob } from "./types";
import { getJob, updateJob } from "./store";

export async function syncGenerationJobFromComfy(jobId: string): Promise<GenerationJob | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  if (job.status === "completed" && job.outputPaths.length > 0) {
    return job;
  }

  if (job.backendUsed !== "local" || !job.remoteJobId) {
    return job;
  }

  const promptId = job.remoteJobId;
  const historyPayload = await fetchComfyHistoryPayload(promptId);
  if (!historyPayload) {
    return job;
  }

  const entry = getHistoryEntry(historyPayload, promptId);

  if (historyEntryIndicatesFailure(entry)) {
    return (
      (await updateJob(
        jobId,
        {
          status: "failed",
          error: "ComfyUI-Ausführung fehlgeschlagen (Knotenfehler oder Status error).",
        },
        "ComfyUI meldet Fehler",
      )) ?? job
    );
  }

  const urls = extractOutputViewUrls(historyPayload, promptId);
  if (urls.length > 0) {
    return (
      (await updateJob(
        jobId,
        { status: "completed", outputPaths: urls },
        `Ausgaben übernommen (${urls.length})`,
      )) ?? job
    );
  }

  return job;
}
