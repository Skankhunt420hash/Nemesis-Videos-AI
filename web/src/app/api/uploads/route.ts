import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

function sanitizeRelative(rel: string): string {
  const n = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  if (n.includes("..")) throw new Error("Ungültiger Pfad");
  return n.replace(/^[\\/]+/, "");
}

async function ensureRoot(): Promise<void> {
  await mkdir(UPLOAD_ROOT, { recursive: true });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  await ensureRoot();
  const { searchParams } = req.nextUrl;
  const query = searchParams.get("query")?.trim().toLowerCase() ?? "";
  const entries = await readdir(UPLOAD_ROOT, { withFileTypes: true });
  const files: Array<{ relativePath: string; size: number; updatedAt: string }> = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    const list = await readdir(path.join(UPLOAD_ROOT, dir), { withFileTypes: true });
    for (const d of list) {
      const rel = prefix ? `${prefix}/${d.name}` : d.name;
      if (d.isDirectory()) {
        await walk(rel, rel);
      } else if (d.isFile()) {
        if (query && !rel.toLowerCase().includes(query)) continue;
        const st = await stat(path.join(UPLOAD_ROOT, rel));
        files.push({
          relativePath: rel.replace(/\\/g, "/"),
          size: st.size,
          updatedAt: st.mtime.toISOString(),
        });
      }
    }
  }

  for (const d of entries) {
    const rel = d.name;
    if (d.isDirectory()) {
      await walk(rel, rel);
    } else if (d.isFile()) {
      if (query && !rel.toLowerCase().includes(query)) continue;
      const st = await stat(path.join(UPLOAD_ROOT, rel));
      files.push({
        relativePath: rel.replace(/\\/g, "/"),
        size: st.size,
        updatedAt: st.mtime.toISOString(),
      });
    }
  }

  files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json({ files });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  await ensureRoot();
  const form = await req.formData();
  const fs = form.getAll("files") as File[];
  const pathsRaw = form.get("relativePaths");
  const relativePaths: string[] =
    typeof pathsRaw === "string" ? (JSON.parse(pathsRaw) as string[]) : [];

  const saved: Array<{
    name: string;
    relativePath: string;
    size: number;
    mimeType: string;
    url: string;
  }> = [];

  for (let i = 0; i < fs.length; i += 1) {
    const file = fs[i];
    const rel = sanitizeRelative(relativePaths[i] || file.name);
    const target = path.join(UPLOAD_ROOT, rel);
    await mkdir(path.dirname(target), { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(target, buf);
    const encoded = rel.split(/[/\\]/).map(encodeURIComponent).join("/");
    saved.push({
      name: file.name,
      relativePath: rel.replace(/\\/g, "/"),
      size: buf.length,
      mimeType: file.type || "application/octet-stream",
      url: `/api/uploads/file/${encoded}`,
    });
  }

  return NextResponse.json({ saved });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  await ensureRoot();
  const body = (await req.json()) as { oldPath?: string; newPath?: string };
  if (!body.oldPath || !body.newPath) {
    return NextResponse.json({ error: "oldPath und newPath nötig." }, { status: 400 });
  }
  const from = sanitizeRelative(body.oldPath);
  const to = sanitizeRelative(body.newPath);
  const absFrom = path.join(UPLOAD_ROOT, from);
  const absTo = path.join(UPLOAD_ROOT, to);
  await mkdir(path.dirname(absTo), { recursive: true });
  await rename(absFrom, absTo);
  return NextResponse.json({ relativePath: to.replace(/\\/g, "/") });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  await ensureRoot();
  const p = req.nextUrl.searchParams.get("path");
  if (!p) return NextResponse.json({ error: "path fehlt" }, { status: 400 });
  const rel = sanitizeRelative(p);
  await rm(path.join(UPLOAD_ROOT, rel), { force: true });
  return NextResponse.json({ ok: true });
}
