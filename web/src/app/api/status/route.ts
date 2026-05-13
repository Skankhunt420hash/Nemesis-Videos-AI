import { NextResponse } from "next/server";
import { getComfyOrigin } from "@/lib/comfy/config";

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
    return NextResponse.json({
      comfy: { ok: true, url: comfyUrl },
      cloudConfigured,
      hints,
    });
  } catch (e) {
    hints.unshift(
      `Keine Verbindung zu ComfyUI unter ${comfyUrl}. Starte ComfyUI oder passe COMFY_URL / NEXT_PUBLIC_* an.`,
    );
    return NextResponse.json({
      comfy: { ok: false, url: comfyUrl, error: (e as Error).message },
      cloudConfigured,
      hints,
    });
  }
}
