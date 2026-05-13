import { getComfyOrigin } from "@/lib/comfy/config";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, pathParts: string[]): Promise<Response> {
  const origin = getComfyOrigin().replace(/\/$/, "");
  const segmentPath = pathParts.join("/");
  const url = new URL(`${origin}/${segmentPath}`);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const l = key.toLowerCase();
    if (l === "host" || l === "connection") return;
    headers.set(key, value);
  });

  const body =
    req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  const res = await fetch(url, {
    method: req.method,
    headers,
    body,
    redirect: "manual",
  });

  const outHeaders = new Headers();
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") return;
    outHeaders.set(key, value);
  });

  return new NextResponse(res.body, {
    status: res.status,
    headers: outHeaders,
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}
