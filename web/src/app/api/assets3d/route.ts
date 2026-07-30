import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");
const ASSET_META_ROOT = path.join(process.cwd(), "storage", "assets3d");
const META_FILE = path.join(ASSET_META_ROOT, "metadata.json");
const THREE_D_EXT = /\.(glb|gltf|obj|ply|stl|fbx|usdz)$/i;

interface Asset3DMetadata {
  title?: string;
  collection?: string;
  collectionOrder?: number;
  sortOrder?: number;
  tags?: string[];
  traits?: Array<{ trait_type: string; value: string; display_type?: string }>;
  notes?: string;
  polishPrompt?: string;
  stage?: "draft" | "polish" | "final";
  coverImagePath?: string;
  versionGroup?: string;
  versionLabel?: string;
  scale?: number;
  rotationY?: number;
  exposure?: number;
  updatedAt?: string;
}

function sanitizeRelative(rel: string): string {
  const n = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  if (n.includes("..")) throw new Error("Ungültiger Pfad");
  return n.replace(/^[\\/]+/, "");
}

async function ensureRoots(): Promise<void> {
  await mkdir(UPLOAD_ROOT, { recursive: true });
  await mkdir(ASSET_META_ROOT, { recursive: true });
}

async function readMetadata(): Promise<Record<string, Asset3DMetadata>> {
  await ensureRoots();
  try {
    const raw = await readFile(META_FILE, "utf8");
    return JSON.parse(raw) as Record<string, Asset3DMetadata>;
  } catch {
    return {};
  }
}

async function writeMetadata(data: Record<string, Asset3DMetadata>): Promise<void> {
  await ensureRoots();
  await writeFile(META_FILE, JSON.stringify(data, null, 2));
}

export async function GET(): Promise<NextResponse> {
  const metadata = await readMetadata();
  const assets: Array<{
    relativePath: string;
    url: string;
    size: number;
    updatedAt: string;
    extension: string;
    previewable: boolean;
    metadata: Asset3DMetadata;
  }> = [];

  async function walk(dir: string): Promise<void> {
    const list = await readdir(path.join(UPLOAD_ROOT, dir), { withFileTypes: true });
    for (const d of list) {
      const rel = dir ? `${dir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        await walk(rel);
      } else if (d.isFile() && THREE_D_EXT.test(d.name)) {
        const normalized = rel.replace(/\\/g, "/");
        const st = await stat(path.join(UPLOAD_ROOT, rel));
        const encoded = normalized.split("/").map(encodeURIComponent).join("/");
        const extension = path.extname(d.name).replace(/^\./, "").toLowerCase();
        assets.push({
          relativePath: normalized,
          url: `/api/uploads/file/${encoded}`,
          size: st.size,
          updatedAt: st.mtime.toISOString(),
          extension,
          previewable: ["glb", "gltf", "usdz"].includes(extension),
          metadata: metadata[normalized] || {},
        });
      }
    }
  }

  await ensureRoots();
  const top = await readdir(UPLOAD_ROOT, { withFileTypes: true });
  for (const entry of top) {
    const rel = entry.name;
    if (entry.isDirectory()) {
      await walk(rel);
    } else if (entry.isFile() && THREE_D_EXT.test(entry.name)) {
      const normalized = rel.replace(/\\/g, "/");
      const st = await stat(path.join(UPLOAD_ROOT, rel));
      const encoded = normalized.split("/").map(encodeURIComponent).join("/");
      const extension = path.extname(entry.name).replace(/^\./, "").toLowerCase();
      assets.push({
        relativePath: normalized,
        url: `/api/uploads/file/${encoded}`,
        size: st.size,
        updatedAt: st.mtime.toISOString(),
        extension,
        previewable: ["glb", "gltf", "usdz"].includes(extension),
        metadata: metadata[normalized] || {},
      });
    }
  }

  assets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json({ assets });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { relativePath?: string; metadata?: Asset3DMetadata };
  if (!body.relativePath || !body.metadata) {
    return NextResponse.json({ error: "relativePath und metadata nötig." }, { status: 400 });
  }

  const rel = sanitizeRelative(body.relativePath).replace(/\\/g, "/");
  const current = await readMetadata();
  current[rel] = {
    ...current[rel],
    ...body.metadata,
    updatedAt: new Date().toISOString(),
  };
  await writeMetadata(current);
  return NextResponse.json({ ok: true, metadata: current[rel] });
}
