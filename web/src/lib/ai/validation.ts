import type { GenerationRequest } from "./types";

export function normalizeGenerationRequest(input: GenerationRequest): GenerationRequest {
  const duration = Math.max(1, Math.min(20, Math.round(input.durationSec || 5)));
  const fps = Math.max(8, Math.min(30, Math.round(input.fps || 16)));
  const width = Math.max(256, Math.min(1280, Math.round(input.width || 832)));
  const height = Math.max(256, Math.min(1280, Math.round(input.height || 480)));
  const mode = input.mode;

  const durationSec = mode === "upscale" ? 1 : duration;

  return {
    ...input,
    prompt: (input.prompt || "").trim(),
    negativePrompt: (input.negativePrompt || "").trim(),
    durationSec,
    fps,
    width,
    height,
    backendMode: input.backendMode || "hybrid",
    photoTool: input.photoTool,
    styleFilter: input.styleFilter,
    imageInputPath: input.imageInputPath,
    mode: input.mode,
    motion: {
      enabled: Boolean(input.motion?.enabled),
      strength: Math.max(0, Math.min(1, input.motion?.strength ?? 0.5)),
      cameraPath: input.motion?.cameraPath,
      trajectoryPrompt: input.motion?.trajectoryPrompt,
      referenceVideoPath: input.motion?.referenceVideoPath,
    },
  };
}
