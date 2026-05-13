import { getComfyOrigin } from "@/lib/comfy/config";

export async function fetchComfyHistoryPayload(promptId: string): Promise<unknown | null> {
  const origin = getComfyOrigin().replace(/\/$/, "");
  const timeoutMs = 12_000;

  try {
    const direct = await fetch(`${origin}/history/${encodeURIComponent(promptId)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (direct.ok) {
      const data = await direct.json();
      const asRoot = data as Record<string, unknown>;
      if (asRoot[promptId]) return { [promptId]: asRoot[promptId] };
      if (data && typeof data === "object" && ("outputs" in asRoot || "status" in asRoot)) {
        return { [promptId]: data };
      }
    }
  } catch {
    /* Fallback */
  }

  try {
    const res = await fetch(`${origin}/history`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const root = data as Record<string, unknown>;
    if (root[promptId]) return { [promptId]: root[promptId] };
  } catch {
    return null;
  }

  return null;
}
