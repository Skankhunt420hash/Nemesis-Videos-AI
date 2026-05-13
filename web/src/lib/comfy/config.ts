export function getComfyOrigin(): string {
  return (
    process.env.COMFY_URL?.trim() ||
    process.env.NEXT_PUBLIC_COMFY_HTTP_URL?.trim() ||
    "http://127.0.0.1:8188"
  );
}

export function getComfyWsBase(): string {
  if (typeof window !== "undefined") {
    const explicit = process.env.NEXT_PUBLIC_COMFY_WS_URL?.trim();
    if (explicit) return explicit;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const hostEnv = process.env.NEXT_PUBLIC_COMFY_HOST?.trim();
    if (hostEnv) return `${proto}//${hostEnv}`;

    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") {
      return `${proto}//127.0.0.1:8188`;
    }

    const apex = h.startsWith("www.") ? h.slice(4) : h;
    return `${proto}//comfy.${apex}`;
  }

  return process.env.NEXT_PUBLIC_COMFY_WS_URL?.trim() || "ws://127.0.0.1:8188";
}

export const COMFY_PROXY_PREFIX = "/api/comfy";
