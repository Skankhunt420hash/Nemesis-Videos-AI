import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ZipFile } from "yazl";

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

async function collectAssets(metadata: Record<string, Asset3DMetadata>) {
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
  return assets;
}

function buildNftMetadataEntry(
  relativePath: string,
  url: string,
  extension: string,
  metadata: Asset3DMetadata,
) {
  const base = path.basename(relativePath, path.extname(relativePath));
  return {
    file: relativePath,
    name: metadata.title || base,
    description: metadata.notes || "",
    image: metadata.coverImagePath
      ? `/api/uploads/file/${metadata.coverImagePath.split("/").map(encodeURIComponent).join("/")}`
      : undefined,
    animation_url: url,
    attributes: metadata.traits || [],
    properties: {
      category: "model",
      files: [{ uri: url, type: `model/${extension}` }],
      collection: metadata.collection || "",
      version_group: metadata.versionGroup || "",
      version_label: metadata.versionLabel || "",
      tags: metadata.tags || [],
    },
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const metadata = await readMetadata();
  const assets = await collectAssets(metadata);

  const exportCollection = req.nextUrl.searchParams.get("exportCollection")?.trim();
  const exportZip = req.nextUrl.searchParams.get("exportZip")?.trim();
  if (exportCollection) {
    const collectionAssets = assets
      .filter((asset) => (asset.metadata.collection?.trim() || "Ohne Collection") === exportCollection)
      .sort((a, b) => (a.metadata.sortOrder ?? 0) - (b.metadata.sortOrder ?? 0));

    return NextResponse.json({
      collection: exportCollection,
      exportedAt: new Date().toISOString(),
      total: collectionAssets.length,
      items: collectionAssets.map((asset, index) => ({
        index,
        relativePath: asset.relativePath,
        metadata: asset.metadata,
        nft: buildNftMetadataEntry(asset.relativePath, asset.url, asset.extension, asset.metadata),
      })),
    });
  }

  if (exportZip) {
    const collectionAssets = assets
      .filter((asset) => (asset.metadata.collection?.trim() || "Ohne Collection") === exportZip)
      .sort((a, b) => (a.metadata.sortOrder ?? 0) - (b.metadata.sortOrder ?? 0));

    const zip = new ZipFile();
    const safeCollection = exportZip.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "collection";
    const manifest = {
      collection: exportZip,
      exportedAt: new Date().toISOString(),
      total: collectionAssets.length,
      items: collectionAssets.map((asset, index) => ({
        index,
        relativePath: asset.relativePath,
        metadata: asset.metadata,
        nft: buildNftMetadataEntry(asset.relativePath, asset.url, asset.extension, asset.metadata),
      })),
    };
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), `${safeCollection}/collection.json`);

    const addedCovers = new Set<string>();
    for (const asset of collectionAssets) {
      const srcPath = path.join(UPLOAD_ROOT, asset.relativePath);
      zip.addFile(srcPath, `${safeCollection}/assets/${path.basename(asset.relativePath)}`);
      zip.addBuffer(
        Buffer.from(
          JSON.stringify(buildNftMetadataEntry(asset.relativePath, asset.url, asset.extension, asset.metadata), null, 2),
        ),
        `${safeCollection}/metadata/${path.basename(asset.relativePath, path.extname(asset.relativePath))}.json`,
      );
      const cover = asset.metadata.coverImagePath?.trim();
      if (cover && !addedCovers.has(cover)) {
        const coverPath = path.join(UPLOAD_ROOT, cover);
        zip.addFile(coverPath, `${safeCollection}/covers/${path.basename(cover)}`);
        addedCovers.add(cover);
      }
    }

    zip.end();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      zip.outputStream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      zip.outputStream.on("end", () => resolve());
      zip.outputStream.on("error", reject);
    });

    return new NextResponse(Buffer.concat(chunks), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${safeCollection}.zip"`,
      },
    });
  }

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
