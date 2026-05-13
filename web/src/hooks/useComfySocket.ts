"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getComfyWsBase } from "@/lib/comfy/config";

type WsMsg = { type: string; data?: unknown };

export function useComfySocket(clientId: string) {
  const [connected, setConnected] = useState(false);
  const [log, setLog] = useState<WsMsg[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const clearLog = useCallback(() => setLog([]), []);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | undefined;
    let attempt = 0;
    let ws: WebSocket | null = null;

    function connect() {
      if (cancelled) return;
      const url = `${getComfyWsBase()}/ws?clientId=${encodeURIComponent(clientId)}`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };

      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          attempt += 1;
          const delay = Math.min(30_000, 900 + Math.min(attempt, 8) ** 2 * 400);
          reconnectTimer = window.setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as WsMsg;
          setLog((prev) => [...prev.slice(-180), data]);
        } catch {
          setLog((prev) => [...prev.slice(-180), { type: "raw", data: ev.data }]);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      ws?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [clientId]);

  return { connected, log, clearLog };
}
