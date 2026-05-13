import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

function sanitize(parts: string[]): string {
  const joined = parts.map(decodeURIComponent).join("/");
  const n = path.posix.normalize(joined).replace(/^(\.\.\/)+/, "");
  if (n.includes("..")) throw new Error("Ungültiger Pfad");
  const segments = n.split("/").filter((s) => s.length > 0);
  return segments.join(path.sep);
}

function mimeFromExt(filename: string): string {
  const lower = filename.toLowerCase();
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.gif$/.test(lower)) return "image/gif";
  if (/\.mp4$/.test(lower)) return "video/mp4";
  if (/\.webm$/.test(lower)) return "video/webm";
  return "application/octet-stream";
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<NextResponse> {
  try {
    const { path: segments = [] } = await ctx.params;
    const rel = sanitize(segments);
    const abs = path.join(UPLOAD_ROOT, rel);

    const st = await stat(abs);
    if (!st.isFile()) throw new Error("notfound");

    const bodyStream = createReadStream(abs);
    const webBody = Readable.toWeb(bodyStream) as ReadableStream<Uint8Array>;

    const baseName = rel.split(/[/\\]/).pop() ?? rel;

    return new NextResponse(webBody, {
      headers: {
        "content-type": mimeFromExt(baseName),
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Datei nicht gefunden." }, { status: 404 });
  }
}
