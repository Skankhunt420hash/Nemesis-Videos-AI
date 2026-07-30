import { NextResponse } from "next/server";
import { getComfyOrigin } from "@/lib/comfy/config";

const REQUIRED_NODE_GROUPS = {
  "Text→Video": [["CLIPTextEncode"], ["KSampler"], ["VHS_VideoCombine", "SaveVideo"]],
  "Image→Video": [["LoadImage"], ["KSampler"], ["VHS_VideoCombine", "SaveVideo"]],
  Upscale: [["LoadImage"], ["ImageScaleBy", "ImageUpscaleWithModel"], ["SaveImage"]],
  "Background Remove": [["LoadImage"], ["RembgNode", "BRIA_RMBG"], ["SaveImage"]],
  Retouch: [["LoadImage"], ["FaceDetailer"], ["SaveImage"]],
  "Face Swap": [["LoadImage"], ["ReActorFaceSwap", "ReActorFaceSwapOpt", "FaceSwap"], ["SaveImage"]],
  "Image→3D": [["LoadImage"], ["TripoSRSampler", "TripoSR", "Hunyuan3DNode", "CRM"], ["SaveGLB", "Save3D", "Preview3D"]],
} as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const comfyUrl = getComfyOrigin().replace(/\/$/, "");
  const cloudConfigured = Boolean(process.env.CLOUD_GEN_ENDPOINT?.trim());

  const hints: string[] = [];
  if (!cloudConfigured) {
    hints.push(
      "Hybrid ohne Cloud: Wenn ComfyUI aus ist, Hybrid schlägt fehl — „Nur lokal“ nutzen oder Comfy starten.",
    );
  }

  try {
    const res = await fetch(`${comfyUrl}/system_stats`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      hints.push("ComfyUI antwortet nicht mit HTTP 200.");
      return NextResponse.json({
        comfy: { ok: false, url: comfyUrl, httpStatus: res.status },
        cloudConfigured,
        hints,
      });
    }
    await res.json().catch(() => null);

    let modeSupport: Array<{ mode: string; ok: boolean; missing: string[] }> = [];
    try {
      const objectInfoRes = await fetch(`${comfyUrl}/object_info`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (objectInfoRes.ok) {
        const objectInfo = (await objectInfoRes.json()) as Record<string, unknown>;
        const available = new Set(Object.keys(objectInfo));
        modeSupport = Object.entries(REQUIRED_NODE_GROUPS).map(([mode, groups]) => {
          const missing = groups
            .filter((group) => !group.some((candidate) => available.has(candidate)))
            .map((group) => group.join(" | "));
          return { mode, ok: missing.length === 0, missing };
        });
      }
    } catch {
      /* optional diagnostics */
    }

    return NextResponse.json({
      comfy: { ok: true, url: comfyUrl },
      cloudConfigured,
      hints,
      modeSupport,
    });
  } catch (e) {
    hints.unshift(
      `Keine Verbindung zu ComfyUI unter ${comfyUrl}. Starte ComfyUI oder passe COMFY_URL / NEXT_PUBLIC_* an.`,
    );
    return NextResponse.json({
      comfy: { ok: false, url: comfyUrl, error: (e as Error).message },
      cloudConfigured,
      hints,
      modeSupport: [],
    });
  }
}
