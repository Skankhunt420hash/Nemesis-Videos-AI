import type { OutputImageRef } from "./types";

function getHistoryRoot(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (e.outputs && typeof e.outputs === "object") return e.outputs as Record<string, unknown>;
  return null;
}

const MEDIA_KEYS = ["images", "gifs", "videos"] as const;

function pushMediaFromNode(nodeOut: unknown, out: OutputImageRef[]): void {
  if (!nodeOut || typeof nodeOut !== "object") return;
  const n = nodeOut as Record<string, unknown>;
  for (const key of MEDIA_KEYS) {
    const arr = n[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (item && typeof item === "object" && "filename" in item) {
        const ref = item as OutputImageRef;
        if (ref.filename) out.push(ref);
      }
    }
  }
}

export function getHistoryEntry(history: unknown, promptId: string): Record<string, unknown> | null {
  const root = history as Record<string, unknown> | null;
  if (!root) return null;
  const entry = root[promptId];
  if (!entry || typeof entry !== "object") return null;
  return entry as Record<string, unknown>;
}

export function historyEntryIndicatesFailure(entry: Record<string, unknown> | null): boolean {
  if (!entry) return false;
  const ne = entry.node_errors;
  if (ne && typeof ne === "object" && Object.keys(ne as object).length > 0) return true;
  const st = entry.status as Record<string, unknown> | undefined;
  if (!st) return false;
  const str = String(st.status_str ?? "").toLowerCase();
  return str === "error" || str === "failed";
}

export function extractOutputImages(history: unknown, promptId: string): OutputImageRef[] {
  const out: OutputImageRef[] = [];
  const root = history as Record<string, unknown> | null;
  if (!root) return out;

  const entry = root[promptId] as Record<string, unknown> | undefined;
  let outputs = entry ? getHistoryRoot(entry) : null;
  if (!outputs && root.outputs && typeof root.outputs === "object") {
    outputs = root.outputs as Record<string, unknown>;
  }
  if (!outputs) return out;

  for (const nodeOut of Object.values(outputs)) {
    pushMediaFromNode(nodeOut, out);
  }
  return out;
}

export function extractOutputViewUrls(history: unknown, promptId: string): string[] {
  return extractOutputImages(history, promptId).map(buildViewUrl);
}

export function buildViewUrl(ref: OutputImageRef): string {
  const params = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder ?? "",
    type: ref.type ?? "output",
  });
  return `/api/comfy/view?${params.toString()}`;
}
