import type { GenerationJob } from "@/lib/ai/types";
import type { ModelKey } from "@/lib/models/storage";
import { COMFY_PROXY_PREFIX } from "./config";
import type { ComfyWorkflow, QueuePromptResponse } from "./types";

async function comfyFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${COMFY_PROXY_PREFIX}/${path.replace(/^\//, "")}`;
  return fetch(url, init);
}

export async function queuePrompt(
  workflow: ComfyWorkflow,
  clientId: string,
): Promise<QueuePromptResponse> {
  const res = await comfyFetch("prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `ComfyUI /prompt HTTP ${res.status}`);
  }
  return JSON.parse(text) as QueuePromptResponse;
}

export async function fetchHistory(promptId: string): Promise<unknown> {
  const res = await comfyFetch(`history/${encodeURIComponent(promptId)}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function fetchQueue(): Promise<unknown> {
  const res = await comfyFetch("queue");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function interrupt(): Promise<void> {
  const res = await comfyFetch("interrupt", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
}

export interface AppStatusResponse {
  comfy: { ok: boolean; url: string; httpStatus?: number; error?: string };
  cloudConfigured: boolean;
  hints: string[];
}

export async function fetchAppStatusApi(): Promise<AppStatusResponse> {
  const res = await fetch("/api/status", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as AppStatusResponse;
}

export interface LocalUploadItem {
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  url: string;
}

export interface LocalUploadResponse {
  saved: LocalUploadItem[];
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export async function uploadToLocalStorage(
  files: File[],
  relativePaths: string[],
  onProgress?: (p: UploadProgress) => void,
): Promise<LocalUploadResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  form.append("relativePaths", JSON.stringify(relativePaths));

  return new Promise<LocalUploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable || !onProgress) return;
      const percent = ev.total > 0 ? Math.round((ev.loaded / ev.total) * 100) : 0;
      onProgress({ loaded: ev.loaded, total: ev.total, percent });
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(xhr.responseText || `Upload HTTP ${xhr.status}`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as LocalUploadResponse);
      } catch {
        reject(new Error("Ungültige Upload-Antwort"));
      }
    };
    xhr.onerror = () => reject(new Error("Netzwerkfehler beim Upload"));
    xhr.send(form);
  });
}

export async function uploadImageToComfyInput(file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  form.append("type", "input");
  form.append("overwrite", "true");

  const res = await comfyFetch("upload/image", {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { name?: string };
  return data.name ?? file.name;
}

export interface UploadListItem {
  relativePath: string;
  size: number;
  updatedAt: string;
}

export async function listLocalUploads(query = ""): Promise<UploadListItem[]> {
  const q = query ? `?query=${encodeURIComponent(query)}` : "";
  const res = await fetch(`/api/uploads${q}`);
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { files: UploadListItem[] };
  return data.files;
}

export async function deleteLocalUpload(relativePath: string): Promise<void> {
  const res = await fetch(`/api/uploads?path=${encodeURIComponent(relativePath)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function renameLocalUpload(oldPath: string, newPath: string): Promise<string> {
  const res = await fetch("/api/uploads", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ oldPath, newPath }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { relativePath: string };
  return data.relativePath;
}

export type GenMode = "t2v" | "i2v" | "i2i" | "upscale";
export type BackendMode = "local" | "cloud" | "hybrid";

export type PhotoToolKind =
  | "generate"
  | "enhance"
  | "style"
  | "background-remove"
  | "retouch";

export interface GenerationSubmitPayload {
  mode: GenMode;
  prompt: string;
  negativePrompt?: string;
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  imageInputPath?: string;
  styleFilter?: string;
  backendMode: BackendMode;
  photoTool?: PhotoToolKind;
  motion: {
    enabled: boolean;
    strength: number;
    cameraPath?: string;
    trajectoryPrompt?: string;
  };
}

export async function submitGeneration(payload: GenerationSubmitPayload): Promise<{
  jobId: string;
  status: string;
  backendUsed: string;
}> {
  const res = await fetch("/api/generation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* Rohtext */
    }
    throw new Error(msg || `Generation HTTP ${res.status}`);
  }
  return JSON.parse(text) as { jobId: string; status: string; backendUsed: string };
}

export async function getGenerationJob(
  jobId: string,
  opts?: { sync?: boolean },
): Promise<GenerationJob> {
  const q = opts?.sync ? "?sync=1" : "";
  const res = await fetch(`/api/generation/${encodeURIComponent(jobId)}${q}`);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as GenerationJob;
}

export interface BrainSuggestion {
  id: string;
  title: string;
  description: string;
  kind: "filter" | "workflow" | "tool";
  generatedAt: string;
  confidence: number;
}

export async function listBrainSuggestionsApi(): Promise<BrainSuggestion[]> {
  const res = await fetch("/api/brain/suggestions");
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { suggestions: BrainSuggestion[] };
  return data.suggestions;
}

export async function sendBrainFeedback(payload: {
  prompt: string;
  mode: GenMode;
  rating: number;
  durationSec: number;
  motionEnabled: boolean;
  notes?: string;
}): Promise<void> {
  const res = await fetch("/api/brain/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
}

export type { ModelKey };
export interface ModelStatusItem {
  key: ModelKey;
  name: string;
  directory: string;
  bytes: number;
  ready: boolean;
}

export async function getModelsStatusApi(): Promise<{
  models: ModelStatusItem[];
  download: { status?: string; model?: string; error?: string };
}> {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as {
    models: ModelStatusItem[];
    download: { status?: string; model?: string; error?: string };
  };
}

export async function startModelDownloadApi(model: ModelKey): Promise<void> {
  const res = await fetch("/api/models/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function startFirstMissingModelDownloadApi(): Promise<boolean> {
  const res = await fetch("/api/models/download-missing", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { started?: boolean };
  return Boolean(data.started);
}

export async function getModelDownloadLogApi(maxChars = 14000): Promise<string> {
  const res = await fetch(`/api/models/log?max=${maxChars}`);
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { log?: string };
  return data.log ?? "";
}
