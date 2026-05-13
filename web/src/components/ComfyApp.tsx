"use client";

import { type DragEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { GenerationJob } from "@/lib/ai/types";
import {
  deleteLocalUpload,
  fetchAppStatusApi,
  fetchHistory,
  fetchQueue,
  getGenerationJob,
  getModelDownloadLogApi,
  getModelsStatusApi,
  interrupt,
  listBrainSuggestionsApi,
  listLocalUploads,
  queuePrompt,
  renameLocalUpload,
  sendBrainFeedback,
  startFirstMissingModelDownloadApi,
  startModelDownloadApi,
  submitGeneration,
  type AppStatusResponse,
  type GenMode,
  type PhotoToolKind,
  type UploadListItem,
  uploadImageToComfyInput,
  uploadToLocalStorage,
} from "@/lib/comfy/api";
import { buildViewUrl, extractOutputImages } from "@/lib/comfy/history";
import type { ComfyWorkflow, OutputImageRef } from "@/lib/comfy/types";
import { useComfySocket } from "@/hooks/useComfySocket";

const EMPTY_WORKFLOW = "{\n\n}";

function fileUrlFromRelativePath(relativePath: string): string {
  const encoded = relativePath.split("/").map(encodeURIComponent).join("/");
  return `/api/uploads/file/${encoded}`;
}

function detectPreviewKind(
  relativePath: string,
): "image" | "video" | "audio" | "text" | "other" {
  const lower = relativePath.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return "image";
  if (/\.(mp4|webm|mov|mkv|avi)$/.test(lower)) return "video";
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(lower)) return "audio";
  if (/\.(txt|md|json|csv|log|yaml|yml|xml)$/.test(lower)) return "text";
  return "other";
}

function isVideoOutputUrl(url: string): boolean {
  try {
    const filename = new URL(url, "http://x").searchParams.get("filename") ?? "";
    return /\.(mp4|webm|gif|mov)$/i.test(filename);
  } catch {
    return false;
  }
}

type SelectedUpload = { file: File; relativePath: string };

export function ComfyApp() {
  const clientId = useMemo(() => crypto.randomUUID(), []);
  const { connected, log, clearLog } = useComfySocket(clientId);

  const [workflowText, setWorkflowText] = useState(EMPTY_WORKFLOW);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptId, setPromptId] = useState<string | null>(null);
  const [images, setImages] = useState<OutputImageRef[]>([]);
  const [queueInfo, setQueueInfo] = useState("");
  const [uploads, setUploads] = useState<SelectedUpload[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0);
  const [uploadCurrentFile, setUploadCurrentFile] = useState("");
  const [uploadInfo, setUploadInfo] = useState("");
  const [textFileName, setTextFileName] = useState("prompt.txt");
  const [textContent, setTextContent] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [storedFiles, setStoredFiles] = useState<UploadListItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [renameTarget, setRenameTarget] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [previewPath, setPreviewPath] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [helperNodeId, setHelperNodeId] = useState("");
  const [helperInputKey, setHelperInputKey] = useState("image");
  const [helperValue, setHelperValue] = useState("");

  const [genMode, setGenMode] = useState<GenMode>("t2v");
  const [photoTool, setPhotoTool] = useState<PhotoToolKind>("generate");
  const [genPrompt, setGenPrompt] = useState("");
  const [genNegPrompt, setGenNegPrompt] = useState("");
  const [genDuration, setGenDuration] = useState(8);
  const [genWidth, setGenWidth] = useState(832);
  const [genHeight, setGenHeight] = useState(480);
  const [genFps, setGenFps] = useState(16);
  const [genSubmitBusy, setGenSubmitBusy] = useState(false);
  const [genBackend, setGenBackend] = useState<"local" | "cloud" | "hybrid">("local");
  const [genImagePath, setGenImagePath] = useState("");
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [motionStrength, setMotionStrength] = useState(0.5);
  const [motionCameraPath, setMotionCameraPath] = useState("");
  const [motionTrajectory, setMotionTrajectory] = useState("");
  const [genJobId, setGenJobId] = useState("");
  const [genJob, setGenJob] = useState<GenerationJob | null>(null);
  const [brainSuggestions, setBrainSuggestions] = useState<
    Array<{ id: string; title: string; description: string; kind: string; confidence: number }>
  >([]);
  const [brainRating, setBrainRating] = useState(4);

  const [modelsInfo, setModelsInfo] = useState<
    Array<{ key: "wan21" | "wan22" | "ltx2"; name: string; bytes: number; ready: boolean }>
  >([]);
  const [downloadStatus] = useState<{ status?: string; model?: string; error?: string }>({});
  const [downloadLog, setDownloadLog] = useState("");
  const [appStatus, setAppStatus] = useState<AppStatusResponse | null>(null);

  const folderInputAttrs = useMemo(
    () => ({ webkitdirectory: "", directory: "" }) as Record<string, string>,
    [],
  );

  const mergeUploads = useCallback((nextFiles: FileList | null) => {
    if (!nextFiles?.length) return;
    const mapped = Array.from(nextFiles).map((f) => {
      const withPath = f as File & { webkitRelativePath?: string };
      return { file: f, relativePath: withPath.webkitRelativePath || f.name };
    });
    setUploads((prev) => [...prev, ...mapped]);
  }, []);

  const onDropFiles = useCallback(
    (ev: DragEvent<HTMLDivElement>) => {
      ev.preventDefault();
      setDragActive(false);
      mergeUploads(ev.dataTransfer.files);
    },
    [mergeUploads],
  );

  const refreshStoredFiles = useCallback(async () => {
    try {
      setStoredFiles(await listLocalUploads(fileSearch));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [fileSearch]);

  useEffect(() => {
    queueMicrotask(() => void refreshStoredFiles());
  }, [refreshStoredFiles]);

  const refreshBrainSuggestions = useCallback(async () => {
    try {
      setBrainSuggestions(await listBrainSuggestionsApi());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refreshBrainSuggestions());
  }, [refreshBrainSuggestions]);

  const refreshModels = useCallback(async () => {
    try {
      const status = await getModelsStatusApi();
      setModelsInfo(status.models);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refreshModels());
    const t = setInterval(() => void refreshModels(), 5000);
    return () => clearInterval(t);
  }, [refreshModels]);

  const refreshDownloadLog = useCallback(async () => {
    try {
      setDownloadLog(await getModelDownloadLogApi(14000));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refreshDownloadLog());
    const t = setInterval(() => void refreshDownloadLog(), 5000);
    return () => clearInterval(t);
  }, [refreshDownloadLog]);

  useEffect(() => {
    queueMicrotask(() => {
      void (async () => {
        try {
          setAppStatus(await fetchAppStatusApi());
        } catch {
          setAppStatus(null);
        }
      })();
    });
    const t = setInterval(() => {
      void (async () => {
        try {
          setAppStatus(await fetchAppStatusApi());
        } catch {
          /* optional */
        }
      })();
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  const runWorkflow = useCallback(async () => {
    setError(null);
    setImages([]);
    let workflow: ComfyWorkflow;
    try {
      workflow = JSON.parse(workflowText) as ComfyWorkflow;
    } catch (e) {
      setError(`Ungültiges JSON: ${(e as Error).message}`);
      return;
    }
    setBusy(true);
    try {
      const res = await queuePrompt(workflow, clientId);
      if (res.node_errors && Object.keys(res.node_errors).length) {
        setError(`Node-Fehler: ${JSON.stringify(res.node_errors)}`);
      }
      setPromptId(res.prompt_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [workflowText, clientId]);

  const refreshOutputs = useCallback(async () => {
    if (!promptId) return;
    setError(null);
    try {
      const history = await fetchHistory(promptId);
      setImages(extractOutputImages(history, promptId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [promptId]);

  const refreshQueue = useCallback(async () => {
    try {
      const q = await fetchQueue();
      setQueueInfo(JSON.stringify(q, null, 2));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const stopRun = useCallback(async () => {
    try {
      await interrupt();
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const uploadCurrentSelection = useCallback(
    async (toComfyInput: boolean) => {
      if (!uploads.length) {
        setUploadInfo("Keine Dateien ausgewählt.");
        return;
      }
      setUploadBusy(true);
      setUploadProgressPercent(0);
      setUploadCurrentFile("");
      setUploadInfo("");
      setError(null);
      try {
        const allSaved: string[] = [];
        for (let i = 0; i < uploads.length; i += 1) {
          const u = uploads[i];
          setUploadCurrentFile(u.relativePath);
          await uploadToLocalStorage([u.file], [u.relativePath], (p) => {
            const current = ((i + p.percent / 100) / uploads.length) * 100;
            setUploadProgressPercent(Math.round(current));
          });
          allSaved.push(u.relativePath);
        }
        const lines = [
          `Lokal gespeichert: ${allSaved.length} Datei(en).`,
          ...allSaved.slice(0, 8).map((f) => `- ${f}`),
        ];
        if (toComfyInput) {
          const imageFiles = uploads.map((u) => u.file).filter((f) => f.type.startsWith("image/"));
          const uploadedNames: string[] = [];
          for (const img of imageFiles) {
            uploadedNames.push(await uploadImageToComfyInput(img));
          }
          lines.push(`Comfy input: ${uploadedNames.length} Bild(er).`);
          if (uploadedNames.length) {
            lines.push(...uploadedNames.slice(0, 8).map((n) => `- input/${n}`));
          }
        }
        setUploadInfo(lines.join("\n"));
        await refreshStoredFiles();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploadBusy(false);
        setUploadProgressPercent(0);
        setUploadCurrentFile("");
      }
    },
    [uploads, refreshStoredFiles],
  );

  const addTextAsFile = useCallback(() => {
    const name = (textFileName || "note.txt").trim();
    if (!name) return;
    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const file = new File([blob], name, { type: "text/plain" });
    setUploads((prev) => [...prev, { file, relativePath: name }]);
  }, [textContent, textFileName]);

  const insertIntoWorkflow = useCallback(() => {
    try {
      const parsed = JSON.parse(workflowText) as Record<string, { inputs?: Record<string, unknown> }>;
      if (!parsed[helperNodeId]) throw new Error("Node-ID nicht gefunden.");
      if (!parsed[helperNodeId].inputs) parsed[helperNodeId].inputs = {};
      parsed[helperNodeId].inputs![helperInputKey] = helperValue;
      setWorkflowText(JSON.stringify(parsed, null, 2));
    } catch (e) {
      setError(`Workflow-Helfer: ${(e as Error).message}`);
    }
  }, [helperInputKey, helperNodeId, helperValue, workflowText]);

  const onDeleteStored = useCallback(
    async (relativePath: string) => {
      try {
        await deleteLocalUpload(relativePath);
        await refreshStoredFiles();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refreshStoredFiles],
  );

  const onRenameStored = useCallback(async () => {
    if (!renameTarget || !renameValue) return;
    try {
      await renameLocalUpload(renameTarget, renameValue);
      setRenameTarget("");
      setRenameValue("");
      await refreshStoredFiles();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refreshStoredFiles, renameTarget, renameValue]);

  const loadTextPreview = useCallback(async (relativePath: string) => {
    const url = fileUrlFromRelativePath(relativePath);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Textvorschau nicht verfügbar");
      const txt = await res.text();
      setPreviewText(txt.slice(0, 10000));
    } catch {
      setPreviewText("Vorschau konnte nicht geladen werden.");
    }
  }, []);

  const resolveGenPayload = useCallback((): Parameters<typeof submitGeneration>[0] => {
    let mode: GenMode = genMode;
    let pt: PhotoToolKind | undefined;
    if (genMode === "i2i") {
      pt = photoTool;
      if (photoTool === "enhance") mode = "upscale";
    }
    return {
      mode,
      prompt: genPrompt,
      negativePrompt: genNegPrompt,
      durationSec: genDuration,
      width: genWidth,
      height: genHeight,
      fps: genFps,
      imageInputPath: genImagePath || undefined,
      backendMode: genBackend,
      styleFilter: genMode === "i2i" ? photoTool : "auto",
      photoTool: pt,
      motion: {
        enabled: motionEnabled,
        strength: motionStrength,
        cameraPath: motionCameraPath || undefined,
        trajectoryPrompt: motionTrajectory || undefined,
      },
    };
  }, [
    genBackend,
    genDuration,
    genFps,
    genHeight,
    genWidth,
    genImagePath,
    genMode,
    genNegPrompt,
    genPrompt,
    motionCameraPath,
    motionEnabled,
    motionStrength,
    motionTrajectory,
    photoTool,
  ]);

  const submitGenerationJob = useCallback(async () => {
    setGenSubmitBusy(true);
    try {
      setError(null);
      const response = await submitGeneration(resolveGenPayload());
      setGenJobId(response.jobId);
      const job = await getGenerationJob(response.jobId, { sync: true });
      setGenJob(job);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenSubmitBusy(false);
    }
  }, [resolveGenPayload]);

  const refreshGenerationStatus = useCallback(async () => {
    if (!genJobId) return;
    try {
      const job = await getGenerationJob(genJobId, { sync: true });
      setGenJob(job);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [genJobId]);

  useEffect(() => {
    const id = genJobId.trim();
    if (!id) return undefined;
    let cancelled = false;

    async function tick() {
      try {
        const job = await getGenerationJob(id, { sync: true });
        if (cancelled) return;
        setGenJob(job);
        if (job.status === "completed" || job.status === "failed") {
          clearInterval(intervalId);
        }
      } catch {
        /* polling */
      }
    }

    const intervalId = setInterval(() => void tick(), 2800);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [genJobId]);

  const sendGenerationFeedback = useCallback(async () => {
    try {
      await sendBrainFeedback({
        prompt: genPrompt,
        mode: genMode,
        rating: brainRating,
        durationSec: genDuration,
        motionEnabled,
      });
      await refreshBrainSuggestions();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brainRating, genDuration, genMode, genPrompt, motionEnabled, refreshBrainSuggestions]);

  const startModelDownload = useCallback(
    async (model: "wan21" | "wan22" | "ltx2") => {
      try {
        setError(null);
        await startModelDownloadApi(model);
        await refreshModels();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refreshModels],
  );

  const startMissingModels = useCallback(async () => {
    try {
      setError(null);
      const started = await startFirstMissingModelDownloadApi();
      if (!started) setUploadInfo("Alle Modelle sind bereits vorhanden.");
      await refreshModels();
      await refreshDownloadLog();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refreshDownloadLog, refreshModels]);

  return (
    <div className="bg-grid mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-3 py-4 pb-24 text-zinc-100 sm:gap-6 sm:px-4 sm:py-8 sm:pb-8">
      <header className="border-b border-zinc-800 pb-6">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Nemesis Videos AI · Studio
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          ComfyUI unter{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-200">
            {appStatus?.comfy.url ?? "…"}
          </code>{" "}
          · Proxy{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-200">/api/comfy/*</code>
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Client-ID: {clientId} · WS:{" "}
          <span className={connected ? "text-emerald-400" : "text-amber-400"}>
            {connected ? "verbunden" : "getrennt"}
          </span>
          {appStatus ? (
            <>
              {" "}
              · HTTP{" "}
              <span className={appStatus.comfy.ok ? "text-emerald-400" : "text-rose-400"}>
                {appStatus.comfy.ok ? "OK" : "offline"}
              </span>
            </>
          ) : null}
        </p>
      </header>

      {appStatus && !appStatus.comfy.ok ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-950/35 px-4 py-3 text-sm text-rose-50"
        >
          <p className="font-medium">ComfyUI ist nicht erreichbar.</p>
          {appStatus.comfy.error ? (
            <p className="mt-1 font-mono text-xs text-rose-200/90">{appStatus.comfy.error}</p>
          ) : null}
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-rose-100/90">
            {appStatus.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <nav className="sticky top-0 z-10 flex flex-wrap gap-2 border-y border-zinc-800 bg-zinc-950/95 py-2 text-xs backdrop-blur">
        <a href="#models" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          Modelle
        </a>
        <a href="#studio" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          AI Studio
        </a>
        <a href="#workflow" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          Workflow
        </a>
        <a href="#uploads" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          Uploads
        </a>
      </nav>

      <div className="grid gap-6 lg:grid-cols-2">
        <section id="models" className="scroll-mt-20 flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-300">Modell-Zentrale</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <div className="space-y-2">
              {modelsInfo.map((m) => (
                <div key={m.key} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                  <div className="flex justify-between gap-2">
                    <p className="text-xs text-zinc-200">{m.name}</p>
                    <span className={`text-[11px] ${m.ready ? "text-emerald-400" : "text-amber-400"}`}>
                      {m.ready ? "bereit" : "fehlt"}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    {(m.bytes / (1024 * 1024)).toFixed(1)} MB erkannt
                  </p>
                  {!m.ready ? (
                    <button
                      type="button"
                      onClick={() => void startModelDownload(m.key)}
                      className="mt-2 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
                    >
                      Hinweis loggen
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void startMissingModels()}
                className="rounded bg-emerald-500 px-3 py-1 text-xs font-medium text-zinc-900"
              >
                Fehlende Modelle (Log)
              </button>
              <button
                type="button"
                onClick={() => void refreshDownloadLog()}
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200"
              >
                Log aktualisieren
              </button>
            </div>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-900 p-2 text-[11px] text-zinc-400">
              {downloadLog || "Kein Log."}
              {downloadStatus.error ? `\n${downloadStatus.error}` : ""}
            </pre>
          </div>

          <h2 id="studio" className="scroll-mt-20 text-sm font-medium text-zinc-300">
            AI Studio · Video &amp; Foto
          </h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={genMode}
                onChange={(e) => setGenMode(e.target.value as GenMode)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              >
                <option value="t2v">Text to Video</option>
                <option value="i2v">Image to Video</option>
                <option value="i2i">KI Foto</option>
                <option value="upscale">Upscaler</option>
              </select>
              <select
                value={genBackend}
                onChange={(e) =>
                  setGenBackend(e.target.value as "local" | "cloud" | "hybrid")
                }
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              >
                <option value="local">Nur lokal</option>
                <option value="hybrid">Hybrid</option>
                <option value="cloud">Nur Cloud</option>
              </select>
            </div>
            {genMode === "i2i" ? (
              <select
                value={photoTool}
                onChange={(e) => setPhotoTool(e.target.value as PhotoToolKind)}
                className="mt-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              >
                <option value="generate">Foto aus Text</option>
                <option value="enhance">Verbessern</option>
                <option value="style">Style</option>
                <option value="background-remove">Hintergrund</option>
                <option value="retouch">Retusche</option>
              </select>
            ) : null}
            <textarea
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              placeholder="Prompt..."
              className="mt-2 min-h-20 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
            />
            <input
              value={genNegPrompt}
              onChange={(e) => setGenNegPrompt(e.target.value)}
              placeholder="Negative Prompt"
              className="mt-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                type="number"
                min={1}
                max={20}
                value={genDuration}
                onChange={(e) => setGenDuration(Number(e.target.value))}
                placeholder="Dauer (s)"
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              />
              <input
                value={genImagePath}
                onChange={(e) => setGenImagePath(e.target.value)}
                placeholder="Bildpfad (Uploads / Comfy)"
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <input
                type="number"
                min={256}
                max={1280}
                step={64}
                value={genWidth}
                onChange={(e) => setGenWidth(Number(e.target.value))}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              />
              <input
                type="number"
                min={256}
                max={1280}
                step={64}
                value={genHeight}
                onChange={(e) => setGenHeight(Number(e.target.value))}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              />
              <input
                type="number"
                min={8}
                max={30}
                value={genFps}
                onChange={(e) => setGenFps(Number(e.target.value))}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              />
            </div>
            <div className="mt-2 rounded border border-zinc-800 bg-zinc-900 p-2">
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={motionEnabled}
                  onChange={(e) => setMotionEnabled(e.target.checked)}
                />
                Motion
              </label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={motionStrength}
                  onChange={(e) => setMotionStrength(Number(e.target.value))}
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                />
                <input
                  value={motionCameraPath}
                  onChange={(e) => setMotionCameraPath(e.target.value)}
                  placeholder="Camera Path"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                />
              </div>
              <input
                value={motionTrajectory}
                onChange={(e) => setMotionTrajectory(e.target.value)}
                placeholder="Trajectory Prompt"
                className="mt-2 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
              />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                disabled={genSubmitBusy}
                onClick={() => void submitGenerationJob()}
                className="rounded bg-emerald-400 px-3 py-2 text-xs font-medium text-zinc-900 disabled:opacity-50"
              >
                {genSubmitBusy ? "Starte…" : "Generation"}
              </button>
              <button
                type="button"
                onClick={() => void refreshGenerationStatus()}
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200"
              >
                Job-Status
              </button>
              <button
                type="button"
                onClick={() => void sendGenerationFeedback()}
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200"
              >
                Brain-Feedback
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
              <span>Bewertung</span>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={brainRating}
                onChange={(e) => setBrainRating(Number(e.target.value))}
              />
              <span>{brainRating}/5</span>
            </div>
            {genJob ? (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-zinc-400">
                  Job{" "}
                  <span className="font-mono text-[11px] text-zinc-300">{genJob.id.slice(0, 8)}…</span>{" "}
                  ·{" "}
                  <span
                    className={
                      genJob.status === "completed"
                        ? "text-emerald-400"
                        : genJob.status === "failed"
                          ? "text-red-400"
                          : "text-amber-400"
                    }
                  >
                    {genJob.status}
                  </span>
                </p>
                {genJob.error ? <p className="text-[11px] text-red-400">{genJob.error}</p> : null}
                {genJob.outputPaths.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {genJob.outputPaths.map((url) =>
                      isVideoOutputUrl(url) ? (
                        <video
                          key={url}
                          src={url}
                          controls
                          playsInline
                          className="max-h-48 max-w-[min(100%,280px)] rounded border border-zinc-700"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- Comfy-Ausgabe
                        <img
                          key={url}
                          src={url}
                          alt=""
                          className="max-h-48 max-w-[min(100%,280px)] rounded border border-zinc-700 object-contain"
                        />
                      ),
                    )}
                  </div>
                ) : null}
                <pre className="max-h-44 overflow-auto rounded border border-zinc-800 bg-zinc-900 p-2 text-[11px] text-zinc-300">
                  {JSON.stringify(genJob, null, 2)}
                </pre>
              </div>
            ) : null}
            <div className="mt-2 rounded border border-zinc-800 bg-zinc-900 p-2">
              <p className="text-xs text-zinc-400">Brain</p>
              <div className="mt-1 space-y-1">
                {brainSuggestions.slice(0, 4).map((s) => (
                  <div key={s.id} className="rounded border border-zinc-800 bg-zinc-950 p-2">
                    <p className="text-xs text-zinc-200">
                      {s.title} ({s.kind}) · {Math.round(s.confidence * 100)}%
                    </p>
                    <p className="text-[11px] text-zinc-500">{s.description}</p>
                  </div>
                ))}
                {brainSuggestions.length === 0 ? (
                  <p className="text-[11px] text-zinc-500">Noch keine Vorschläge.</p>
                ) : null}
              </div>
            </div>
          </div>

          <h2 id="workflow" className="scroll-mt-20 text-sm font-medium text-zinc-300">
            Workflow (JSON)
          </h2>
          <textarea
            className="min-h-[220px] w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-zinc-600 sm:min-h-[280px]"
            spellCheck={false}
            value={workflowText}
            onChange={(e) => setWorkflowText(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void runWorkflow()}
              className="rounded bg-violet-500 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy ? "Sende…" : "An Comfy senden"}
            </button>
            <button
              type="button"
              onClick={() => void refreshOutputs()}
              className="rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-200"
            >
              Outputs laden
            </button>
            <button
              type="button"
              onClick={() => void refreshQueue()}
              className="rounded border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-200"
            >
              Queue
            </button>
            <button
              type="button"
              onClick={() => void stopRun()}
              className="rounded border border-red-900 bg-red-950/40 px-4 py-2 text-xs text-red-200"
            >
              Stop
            </button>
          </div>
          {promptId ? (
            <p className="text-[11px] text-zinc-500">
              Prompt-ID: <span className="font-mono text-zinc-300">{promptId}</span>
            </p>
          ) : null}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <p className="text-xs text-zinc-400">Workflow-Helfer</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <input
                value={helperNodeId}
                onChange={(e) => setHelperNodeId(e.target.value)}
                placeholder="Node-ID"
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs"
              />
              <input
                value={helperInputKey}
                onChange={(e) => setHelperInputKey(e.target.value)}
                placeholder="Input key"
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs"
              />
              <input
                value={helperValue}
                onChange={(e) => setHelperValue(e.target.value)}
                placeholder="Wert"
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs"
              />
            </div>
            <button
              type="button"
              onClick={insertIntoWorkflow}
              className="mt-2 rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200"
            >
              Ins JSON einfügen
            </button>
          </div>
          <pre className="max-h-48 overflow-auto rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px] text-zinc-400">
            {queueInfo || "Queue: noch nicht geladen."}
          </pre>
        </section>

        <section className="flex flex-col gap-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <p className="text-xs font-medium text-zinc-300">Ausgabe (Workflow)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element -- Comfy /view
                <img
                  key={`${img.filename}-${img.subfolder}`}
                  src={buildViewUrl(img)}
                  alt=""
                  className="max-h-40 rounded border border-zinc-700 object-contain"
                />
              ))}
              {!images.length ? (
                <p className="text-[11px] text-zinc-600">Noch keine Bilder für diese Prompt-ID.</p>
              ) : null}
            </div>
          </div>

          <div id="uploads" className="scroll-mt-20 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <p className="text-xs font-medium text-zinc-300">Uploads</p>
            <div
              onDragEnter={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDropFiles}
              className={`mt-2 rounded-lg border-2 border-dashed p-6 text-center text-xs transition-colors ${
                dragActive ? "border-violet-500 bg-violet-950/30" : "border-zinc-700 bg-zinc-900/40"
              }`}
            >
              Dateien hierher ziehen oder auswählen
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <label className="cursor-pointer rounded bg-zinc-800 px-3 py-1.5 text-zinc-200">
                  Dateien
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => mergeUploads(e.target.files)}
                  />
                </label>
                <label className="cursor-pointer rounded bg-zinc-800 px-3 py-1.5 text-zinc-200">
                  Ordner
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    {...folderInputAttrs}
                    onChange={(e) => mergeUploads(e.target.files)}
                  />
                </label>
              </div>
            </div>
            {uploads.length > 0 ? (
              <ul className="mt-2 max-h-32 overflow-auto text-[11px] text-zinc-400">
                {uploads.slice(0, 40).map((u) => (
                  <li key={u.relativePath}>{u.relativePath}</li>
                ))}
                {uploads.length > 40 ? <li>… +{uploads.length - 40}</li> : null}
              </ul>
            ) : null}
            {uploadBusy ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
                <div
                  className="h-full bg-violet-500 transition-[width]"
                  style={{ width: `${uploadProgressPercent}%` }}
                />
              </div>
            ) : null}
            {uploadCurrentFile ? (
              <p className="mt-1 text-[11px] text-zinc-500">{uploadCurrentFile}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={uploadBusy}
                onClick={() => void uploadCurrentSelection(false)}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                Nur lokal speichern
              </button>
              <button
                type="button"
                disabled={uploadBusy}
                onClick={() => void uploadCurrentSelection(true)}
                className="rounded bg-violet-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                Lokal + Comfy input
              </button>
              <button
                type="button"
                onClick={() => setUploads([])}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
              >
                Liste leeren
              </button>
            </div>
            <pre className="mt-2 whitespace-pre-wrap text-[11px] text-zinc-500">{uploadInfo}</pre>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <p className="text-xs font-medium text-zinc-300">Text als Datei</p>
            <input
              value={textFileName}
              onChange={(e) => setTextFileName(e.target.value)}
              className="mt-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs"
            />
            <textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              className="mt-2 min-h-20 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs"
            />
            <button
              type="button"
              onClick={addTextAsFile}
              className="mt-2 rounded border border-zinc-600 px-3 py-1 text-xs text-zinc-200"
            >
              Zur Upload-Liste
            </button>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-zinc-300">Dateimanager</p>
              <input
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="Suche…"
                className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs min-w-[120px]"
              />
              <button
                type="button"
                onClick={() => void refreshStoredFiles()}
                className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300"
              >
                Aktualisieren
              </button>
            </div>
            <div className="mt-2 max-h-48 overflow-auto text-[11px]">
              {storedFiles.slice(0, 80).map((f) => (
                <div
                  key={f.relativePath}
                  className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 py-1"
                >
                  <button
                    type="button"
                    className="flex-1 truncate text-left text-zinc-300 hover:text-white"
                    onClick={() => {
                      setPreviewPath(f.relativePath);
                      const k = detectPreviewKind(f.relativePath);
                      if (k === "text") void loadTextPreview(f.relativePath);
                      else setPreviewText("");
                    }}
                  >
                    {f.relativePath}
                  </button>
                  <button
                    type="button"
                    className="text-red-400 hover:text-red-300"
                    onClick={() => void onDeleteStored(f.relativePath)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 border-t border-zinc-800 pt-2">
              <input
                value={renameTarget}
                onChange={(e) => setRenameTarget(e.target.value)}
                placeholder="Alter Pfad"
                className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs min-w-[100px]"
              />
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="Neuer Pfad"
                className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs min-w-[100px]"
              />
              <button
                type="button"
                onClick={() => void onRenameStored()}
                className="rounded bg-zinc-800 px-2 py-1 text-xs"
              >
                Umbenennen
              </button>
            </div>
          </div>

          {previewPath ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
              <p className="text-xs text-zinc-400">Vorschau · {previewPath}</p>
              {detectPreviewKind(previewPath) === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- uploads preview
                <img
                  src={fileUrlFromRelativePath(previewPath)}
                  alt=""
                  className="mt-2 max-h-56 rounded border border-zinc-700 object-contain"
                />
              ) : null}
              {detectPreviewKind(previewPath) === "video" ? (
                <video
                  src={fileUrlFromRelativePath(previewPath)}
                  controls
                  className="mt-2 max-h-56 rounded border border-zinc-700"
                />
              ) : null}
              {detectPreviewKind(previewPath) === "text" ? (
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-900 p-2 text-[11px] text-zinc-300">
                  {previewText}
                </pre>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-zinc-300">WebSocket-Log</p>
              <button
                type="button"
                onClick={clearLog}
                className="text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                Leeren
              </button>
            </div>
            <pre className="mt-2 max-h-52 overflow-auto rounded border border-zinc-800 bg-black/40 p-2 text-[10px] leading-snug text-zinc-400">
              {log.map((m, i) => `${i}: ${JSON.stringify(m)}\n`).join("")}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
