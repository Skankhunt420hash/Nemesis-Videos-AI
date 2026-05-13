import { randomUUID } from "node:crypto";
import { getComfyOrigin } from "@/lib/comfy/config";
import type { GenerationRequest } from "./types";

type ComfyNode = { class_type: string; inputs: Record<string, unknown> };
type ComfyWorkflow = Record<string, ComfyNode>;

let cachedNodeSet: Set<string> | null = null;
let cachedAt = 0;

async function getAvailableNodes(): Promise<Set<string>> {
  if (cachedNodeSet && Date.now() - cachedAt < 15_000) return cachedNodeSet;
  const origin = getComfyOrigin();
  const res = await fetch(`${origin}/object_info`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Comfy object_info HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  cachedNodeSet = new Set(Object.keys(body));
  cachedAt = Date.now();
  return cachedNodeSet;
}

function chooseNode(
  available: Set<string>,
  candidates: string[],
  fallback: string,
  note: string[],
): string {
  for (const c of candidates) {
    if (available.has(c)) return c;
  }
  note.push(`${candidates.join(" | ")} -> ${fallback}`);
  return fallback;
}

function buildWorkflow(
  request: GenerationRequest,
  available: Set<string>,
  nodeFallbacks: string[],
): { workflow: ComfyWorkflow; workflowName: string } {
  const loadImage = chooseNode(available, ["LoadImage"], "LoadImage", nodeFallbacks);
  const saveImage = chooseNode(available, ["SaveImage"], "SaveImage", nodeFallbacks);
  const saveVideo = chooseNode(
    available,
    ["VHS_VideoCombine", "SaveVideo"],
    "SaveImage",
    nodeFallbacks,
  );
  const textEncode = chooseNode(available, ["CLIPTextEncode"], "CLIPTextEncode", nodeFallbacks);
  const ksampler = chooseNode(available, ["KSampler"], "KSampler", nodeFallbacks);
  const imageScale = chooseNode(
    available,
    ["ImageScaleBy", "ImageUpscaleWithModel"],
    "ImageScaleBy",
    nodeFallbacks,
  );
  const rembg = chooseNode(available, ["RembgNode", "BRIA_RMBG"], "ImageScaleBy", nodeFallbacks);
  const faceDetail = chooseNode(available, ["FaceDetailer"], "KSampler", nodeFallbacks);

  const prompt = request.prompt || "";
  const pt = request.photoTool;

  if (request.mode === "upscale" || pt === "enhance") {
    return {
      workflowName: "image-upscale",
      workflow: {
        "1": { class_type: loadImage, inputs: { image: request.imageInputPath || "" } },
        "2": {
          class_type: imageScale,
          inputs: { image: ["1", 0], scale_by: 2, upscale_method: "lanczos" },
        },
        "3": {
          class_type: saveImage,
          inputs: { images: ["2", 0], filename_prefix: "nemesis_upscale" },
        },
      },
    };
  }

  if (pt === "background-remove") {
    return {
      workflowName: "photo-background-remove",
      workflow: {
        "1": { class_type: loadImage, inputs: { image: request.imageInputPath || "" } },
        "2": { class_type: rembg, inputs: { image: ["1", 0] } },
        "3": {
          class_type: saveImage,
          inputs: { images: ["2", 0], filename_prefix: "nemesis_bg_removed" },
        },
      },
    };
  }

  if (pt === "retouch") {
    return {
      workflowName: "photo-retouch",
      workflow: {
        "1": { class_type: loadImage, inputs: { image: request.imageInputPath || "" } },
        "2": {
          class_type: faceDetail,
          inputs: { image: ["1", 0], prompt: prompt || "retouch", strength: 0.35 },
        },
        "3": {
          class_type: saveImage,
          inputs: { images: ["2", 0], filename_prefix: "nemesis_retouch" },
        },
      },
    };
  }

  if (request.mode === "i2v") {
    return {
      workflowName: "image-to-video",
      workflow: {
        "1": { class_type: loadImage, inputs: { image: request.imageInputPath || "" } },
        "2": {
          class_type: ksampler,
          inputs: { image: ["1", 0], steps: 20, cfg: 6.5, denoise: 0.7 },
        },
        "3": {
          class_type: saveVideo,
          inputs: { images: ["2", 0], filename_prefix: "nemesis_i2v" },
        },
      },
    };
  }

  if (request.mode === "t2v") {
    return {
      workflowName: "text-to-video",
      workflow: {
        "1": { class_type: textEncode, inputs: { text: prompt, clip: ["0", 1] } },
        "2": { class_type: ksampler, inputs: { positive: ["1", 0], steps: 24, cfg: 7 } },
        "3": {
          class_type: saveVideo,
          inputs: { images: ["2", 0], filename_prefix: "nemesis_t2v" },
        },
      },
    };
  }

  if (request.mode === "i2i" && request.photoTool === "generate" && !request.imageInputPath) {
    return {
      workflowName: "text-to-image",
      workflow: {
        "1": { class_type: textEncode, inputs: { text: prompt || "photo", clip: ["0", 1] } },
        "2": { class_type: ksampler, inputs: { positive: ["1", 0], steps: 24, cfg: 7 } },
        "3": {
          class_type: saveImage,
          inputs: { images: ["2", 0], filename_prefix: "nemesis_txt2img" },
        },
      },
    };
  }

  return {
    workflowName: "image-to-image",
    workflow: {
      "1": { class_type: loadImage, inputs: { image: request.imageInputPath || "" } },
      "2": {
        class_type: textEncode,
        inputs: { text: prompt || "enhanced image", clip: ["0", 1] },
      },
      "3": {
        class_type: ksampler,
        inputs: { positive: ["2", 0], image: ["1", 0], steps: 24, cfg: 7, denoise: 0.45 },
      },
      "4": {
        class_type: saveImage,
        inputs: { images: ["3", 0], filename_prefix: "nemesis_i2i" },
      },
    },
  };
}

export async function dispatchLocal(request: GenerationRequest): Promise<string> {
  const available = await getAvailableNodes();
  const nodeFallbacks: string[] = [];
  const { workflow } = buildWorkflow(request, available, nodeFallbacks);
  void nodeFallbacks;

  const res = await fetch(`${getComfyOrigin()}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Comfy queue failed: HTTP ${res.status}`);
  const data = (await res.json()) as { prompt_id?: string };
  return data.prompt_id || randomUUID();
}

export async function dispatchCloud(request: GenerationRequest): Promise<string> {
  const endpoint = process.env.CLOUD_GEN_ENDPOINT?.trim();
  if (!endpoint) {
    throw new Error("Cloud backend nicht konfiguriert (CLOUD_GEN_ENDPOINT fehlt).");
  }
  const token = process.env.CLOUD_GEN_TOKEN?.trim();
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Cloud queue failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { id?: string };
  return data.id || randomUUID();
}

export async function chooseBackend(
  reqMode: "local" | "cloud" | "hybrid",
): Promise<"local" | "cloud"> {
  const cloudConfigured = Boolean(process.env.CLOUD_GEN_ENDPOINT?.trim());

  if (reqMode === "local") return "local";

  if (reqMode === "cloud") {
    if (!cloudConfigured) {
      throw new Error("Cloud-Backend nicht konfiguriert (CLOUD_GEN_ENDPOINT fehlt).");
    }
    return "cloud";
  }

  try {
    const res = await fetch(`${getComfyOrigin()}/system_stats`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) return "local";
  } catch {
    /* Comfy nicht erreichbar */
  }

  if (cloudConfigured) return "cloud";

  throw new Error(
    "Hybrid: Lokales ComfyUI nicht erreichbar und kein Cloud-Endpoint gesetzt. Starte ComfyUI oder trage CLOUD_GEN_ENDPOINT ein.",
  );
}
