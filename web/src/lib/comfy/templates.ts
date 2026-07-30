import type { PhotoToolKind } from "@/lib/comfy/api";
import type { ComfyWorkflow } from "./types";

export function makeWorkflowTemplate(mode: "t2v" | "i2v" | "i2i" | "upscale", photoTool?: PhotoToolKind): ComfyWorkflow {
  if (mode === "upscale") {
    return {
      "1": { class_type: "LoadImage", inputs: { image: "" } },
      "2": {
        class_type: "ImageScaleBy",
        inputs: { image: ["1", 0], scale_by: 2, upscale_method: "lanczos" },
      },
      "3": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "nemesis_upscale" } },
    };
  }

  if (mode === "i2v") {
    return {
      "1": { class_type: "LoadImage", inputs: { image: "" } },
      "2": {
        class_type: "KSampler",
        inputs: { image: ["1", 0], steps: 20, cfg: 6.5, denoise: 0.7 },
      },
      "3": { class_type: "SaveVideo", inputs: { images: ["2", 0], filename_prefix: "nemesis_i2v" } },
    };
  }

  if (mode === "i2i" && photoTool === "background-remove") {
    return {
      "1": { class_type: "LoadImage", inputs: { image: "" } },
      "2": { class_type: "RembgNode", inputs: { image: ["1", 0] } },
      "3": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "nemesis_bg_removed" } },
    };
  }

  if (mode === "i2i" && photoTool === "retouch") {
    return {
      "1": { class_type: "LoadImage", inputs: { image: "" } },
      "2": {
        class_type: "FaceDetailer",
        inputs: { image: ["1", 0], prompt: "retouch", strength: 0.35 },
      },
      "3": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "nemesis_retouch" } },
    };
  }

  if (mode === "i2i") {
    return {
      "1": { class_type: "LoadImage", inputs: { image: "" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "enhanced image", clip: ["0", 1] } },
      "3": {
        class_type: "KSampler",
        inputs: { positive: ["2", 0], image: ["1", 0], steps: 24, cfg: 7, denoise: 0.45 },
      },
      "4": { class_type: "SaveImage", inputs: { images: ["3", 0], filename_prefix: "nemesis_i2i" } },
    };
  }

  return {
    "1": { class_type: "CLIPTextEncode", inputs: { text: "cinematic video", clip: ["0", 1] } },
    "2": { class_type: "KSampler", inputs: { positive: ["1", 0], steps: 24, cfg: 7 } },
    "3": { class_type: "SaveVideo", inputs: { images: ["2", 0], filename_prefix: "nemesis_t2v" } },
  };
}


