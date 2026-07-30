"use client";

import Script from "next/script";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerationJob } from "@/lib/ai/types";
import {
  deleteLocalUpload,
  exportAssets3dCollectionApi,
  fetchAppStatusApi,
  fetchHistory,
  fetchQueue,
  getGenerationJob,
  getModelDownloadLogApi,
  getModelsStatusApi,
  interrupt,
  listAssets3dApi,
  listBrainSuggestionsApi,
  listLocalUploads,
  queuePrompt,
  renameLocalUpload,
  sendBrainFeedback,
  startFirstMissingModelDownloadApi,
  startModelDownloadApi,
  submitGeneration,
  type AppStatusResponse,
  type Asset3DItem,
  type Asset3DMetadata,
  type GenMode,
  type PhotoToolKind,
  type UploadListItem,
  updateAsset3dApi,
  uploadImageToComfyInput,
  uploadToLocalStorage,
} from "@/lib/comfy/api";
import { buildViewUrl, extractOutputImages } from "@/lib/comfy/history";
import type { ComfyWorkflow, OutputImageRef } from "@/lib/comfy/types";
import { makeWorkflowTemplate } from "@/lib/comfy/templates";
import { useComfySocket } from "@/hooks/useComfySocket";

const EMPTY_WORKFLOW = "{\n\n}";

function validateWorkflow(workflow: unknown): string | null {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    return "Workflow muss ein Objekt sein.";
  }

  const entries = Object.entries(workflow as Record<string, unknown>);
  if (entries.length === 0) return "Workflow ist leer.";

  for (const [id, node] of entries) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return `Node ${id} ist ungültig.`;
    const n = node as Record<string, unknown>;
    if (typeof n.class_type !== "string" || !n.class_type.trim()) {
      return `Node ${id} hat kein class_type.`;
    }
    if (!n.inputs || typeof n.inputs !== "object" || Array.isArray(n.inputs)) {
      return `Node ${id} hat keine inputs.`;
    }
  }

  return null;
}

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

function isImageOutputUrl(url: string): boolean {
  try {
    const filename = new URL(url, "http://x").searchParams.get("filename") ?? "";
    return /\.(png|jpe?g|webp|gif|bmp)$/i.test(filename);
  } catch {
    return false;
  }
}

function getOutputFilename(url: string): string {
  try {
    const parsed = new URL(url, "http://x");
    const fromQuery = parsed.searchParams.get("filename");
    if (fromQuery) return fromQuery.split("/").pop() || fromQuery;
    return parsed.pathname.split("/").pop() || url;
  } catch {
    return url;
  }
}

function is3dOutputUrl(url: string): boolean {
  return /\.(glb|gltf|obj|ply|stl|fbx|usdz)$/i.test(getOutputFilename(url));
}

type SelectedUpload = { file: File; relativePath: string };

function metadataToTagString(metadata?: Asset3DMetadata): string {
  return metadata?.tags?.join(", ") || "";
}

function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ComfyApp() {
  const clientId = useMemo(() => crypto.randomUUID(), []);
  const { connected, log, clearLog } = useComfySocket(clientId);
  const modelViewerRef = useRef<HTMLDivElement | null>(null);

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
  const [genSecondImagePath, setGenSecondImagePath] = useState("");
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
    Array<{
      key: "wan21" | "wan22" | "ltx2";
      name: string;
      bytes: number;
      ready: boolean;
      sourceUrl?: string;
    }>
  >([]);
  const [downloadStatus, setDownloadStatus] = useState<{ status?: string; model?: string; error?: string }>({});
  const [downloadLog, setDownloadLog] = useState("");
  const [appStatus, setAppStatus] = useState<AppStatusResponse | null>(null);
  const [assets3d, setAssets3d] = useState<Asset3DItem[]>([]);
  const [selected3dPath, setSelected3dPath] = useState("");
  const [asset3dDraft, setAsset3dDraft] = useState<Asset3DMetadata>({
    stage: "draft",
    collectionOrder: 0,
    sortOrder: 0,
    traits: [],
    scale: 1,
    rotationY: 0,
    exposure: 1,
  });
  const [asset3dTags, setAsset3dTags] = useState("");
  const [asset3dSaving, setAsset3dSaving] = useState(false);
  const [dragCollectionName, setDragCollectionName] = useState("");
  const [dragAssetPath, setDragAssetPath] = useState("");

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

  const applySelected3dAsset = useCallback((asset: Asset3DItem | null) => {
    if (!asset) return;
    setSelected3dPath(asset.relativePath);
    setAsset3dDraft({
      stage: asset.metadata.stage || "draft",
      collectionOrder: asset.metadata.collectionOrder ?? 0,
      sortOrder: asset.metadata.sortOrder ?? 0,
      traits: asset.metadata.traits || [],
      coverImagePath: asset.metadata.coverImagePath || "",
      versionGroup: asset.metadata.versionGroup || "",
      versionLabel: asset.metadata.versionLabel || "",
      scale: asset.metadata.scale ?? 1,
      rotationY: asset.metadata.rotationY ?? 0,
      exposure: asset.metadata.exposure ?? 1,
      title: asset.metadata.title || "",
      collection: asset.metadata.collection || "",
      notes: asset.metadata.notes || "",
      polishPrompt: asset.metadata.polishPrompt || "",
      tags: asset.metadata.tags || [],
      updatedAt: asset.metadata.updatedAt,
    });
    setAsset3dTags(metadataToTagString(asset.metadata));
  }, []);

  const refreshAssets3d = useCallback(async () => {
    try {
      const nextAssets = await listAssets3dApi();
      setAssets3d(nextAssets);
      const matched = nextAssets.find((asset) => asset.relativePath === selected3dPath);
      if (matched) applySelected3dAsset(matched);
      else if (nextAssets[0]) applySelected3dAsset(nextAssets[0]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [applySelected3dAsset, selected3dPath]);

  useEffect(() => {
    queueMicrotask(() => void refreshAssets3d());
    const t = setInterval(() => void refreshAssets3d(), 15000);
    return () => clearInterval(t);
  }, [refreshAssets3d]);

  const selected3dAsset = useMemo(
    () => assets3d.find((asset) => asset.relativePath === selected3dPath) ?? null,
    [assets3d, selected3dPath],
  );

  const assetCollections = useMemo(() => {
    const grouped = new Map<string, Asset3DItem[]>();
    for (const asset of assets3d) {
      const key = asset.metadata.collection?.trim() || "Ohne Collection";
      const list = grouped.get(key) || [];
      list.push(asset);
      grouped.set(key, list);
    }
    return Array.from(grouped.entries())
      .map(([name, items]) => ({
        name,
        items: [...items].sort((a, b) => (a.metadata.sortOrder ?? 0) - (b.metadata.sortOrder ?? 0)),
        order: Math.min(...items.map((item) => item.metadata.collectionOrder ?? 0)),
      }))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }, [assets3d]);

  const relatedVersions = useMemo(() => {
    if (!selected3dAsset) return [] as Asset3DItem[];
    const group = selected3dAsset.metadata.versionGroup?.trim();
    if (!group) return [selected3dAsset];
    return assets3d
      .filter((asset) => (asset.metadata.versionGroup?.trim() || "") === group)
      .sort((a, b) => (a.metadata.sortOrder ?? 0) - (b.metadata.sortOrder ?? 0));
  }, [assets3d, selected3dAsset]);

  useEffect(() => {
    const host = modelViewerRef.current;
    if (!host) return;
    host.innerHTML = "";
    if (!selected3dAsset?.previewable) return;
    const el = document.createElement("model-viewer");
    el.setAttribute("src", selected3dAsset.url);
    el.setAttribute("camera-controls", "");
    el.setAttribute("touch-action", "pan-y");
    el.setAttribute("shadow-intensity", "1");
    el.setAttribute("exposure", String(asset3dDraft.exposure ?? 1));
    el.setAttribute("orientation", `0deg ${asset3dDraft.rotationY ?? 0}deg 0deg`);
    const scale = asset3dDraft.scale ?? 1;
    el.setAttribute("scale", `${scale} ${scale} ${scale}`);
    el.setAttribute("style", "width:100%;height:100%;background:#09090b;border-radius:12px;");
    host.appendChild(el);
    return () => {
      host.innerHTML = "";
    };
  }, [asset3dDraft.exposure, asset3dDraft.rotationY, asset3dDraft.scale, selected3dAsset]);

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
      setDownloadStatus(status.download);
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
    const wfError = validateWorkflow(workflow);
    if (wfError) {
      setError(wfError);
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
        await refreshAssets3d();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploadBusy(false);
        setUploadProgressPercent(0);
        setUploadCurrentFile("");
      }
    },
    [uploads, refreshAssets3d, refreshStoredFiles],
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

  const loadTemplate = useCallback(
    (mode: GenMode, tool?: PhotoToolKind) => {
      setGenMode(mode);
      if (tool) setPhotoTool(tool);
      setWorkflowText(JSON.stringify(makeWorkflowTemplate(mode, tool), null, 2));
    },
    [],
  );

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
      clientId,
      mode,
      prompt: genPrompt,
      negativePrompt: genNegPrompt,
      durationSec: genDuration,
      width: genWidth,
      height: genHeight,
      fps: genFps,
      imageInputPath: genImagePath || undefined,
      secondImageInputPath: genSecondImagePath || undefined,
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
    clientId,
    genBackend,
    genDuration,
    genFps,
    genHeight,
    genSecondImagePath,
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

  const saveSelected3dAsset = useCallback(async () => {
    if (!selected3dAsset) return;
    setAsset3dSaving(true);
    try {
      setError(null);
      await updateAsset3dApi(selected3dAsset.relativePath, {
        ...asset3dDraft,
        tags: asset3dTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        traits: (asset3dDraft.traits || []).filter(
          (trait) => trait.trait_type.trim() || trait.value.trim() || (trait.display_type || "").trim(),
        ),
      });
      await refreshAssets3d();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsset3dSaving(false);
    }
  }, [asset3dDraft, asset3dTags, refreshAssets3d, selected3dAsset]);

  const saveAsset3dMetadata = useCallback(
    async (relativePath: string, metadata: Asset3DMetadata) => {
      await updateAsset3dApi(relativePath, metadata);
    },
    [],
  );

  const moveCollection = useCallback(
    async (fromCollection: string, toCollection: string) => {
      if (!fromCollection || !toCollection || fromCollection === toCollection) return;
      try {
        setError(null);
        const names = assetCollections.map((group) => group.name);
        const fromIndex = names.indexOf(fromCollection);
        const toIndex = names.indexOf(toCollection);
        if (fromIndex < 0 || toIndex < 0) return;
        const next = [...names];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        for (let i = 0; i < next.length; i += 1) {
          const name = next[i];
          const group = assetCollections.find((entry) => entry.name === name);
          if (!group) continue;
          await Promise.all(
            group.items.map((asset) => saveAsset3dMetadata(asset.relativePath, { collectionOrder: i })),
          );
        }
        await refreshAssets3d();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [assetCollections, refreshAssets3d, saveAsset3dMetadata],
  );

  const moveAssetInCollection = useCallback(
    async (fromPath: string, toPath: string) => {
      if (!fromPath || !toPath || fromPath === toPath) return;
      const source = assets3d.find((asset) => asset.relativePath === fromPath);
      const target = assets3d.find((asset) => asset.relativePath === toPath);
      if (!source || !target) return;
      const sourceCollection = source.metadata.collection?.trim() || "Ohne Collection";
      const targetCollection = target.metadata.collection?.trim() || "Ohne Collection";
      if (sourceCollection !== targetCollection) return;
      try {
        setError(null);
        const items = assets3d
          .filter((asset) => (asset.metadata.collection?.trim() || "Ohne Collection") === sourceCollection)
          .sort((a, b) => (a.metadata.sortOrder ?? 0) - (b.metadata.sortOrder ?? 0));
        const fromIndex = items.findIndex((asset) => asset.relativePath === fromPath);
        const toIndex = items.findIndex((asset) => asset.relativePath === toPath);
        if (fromIndex < 0 || toIndex < 0) return;
        const next = [...items];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        await Promise.all(
          next.map((asset, index) => saveAsset3dMetadata(asset.relativePath, { sortOrder: index })),
        );
        await refreshAssets3d();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [assets3d, refreshAssets3d, saveAsset3dMetadata],
  );

  const exportSelected3dMetadata = useCallback(() => {
    if (!selected3dAsset) return;
    const base = getOutputFilename(selected3dAsset.relativePath).replace(/\.[^.]+$/, "");
    downloadJsonFile(`${base}.metadata.json`, {
      name: asset3dDraft.title || base,
      description: asset3dDraft.notes || "",
      image: asset3dDraft.coverImagePath ? fileUrlFromRelativePath(asset3dDraft.coverImagePath) : undefined,
      animation_url: selected3dAsset.url,
      attributes: (asset3dDraft.traits || []).filter(
        (trait) => trait.trait_type.trim() || trait.value.trim() || (trait.display_type || "").trim(),
      ),
      properties: {
        category: "model",
        files: [
          {
            uri: selected3dAsset.url,
            type: `model/${selected3dAsset.extension}`,
          },
        ],
        collection: asset3dDraft.collection || "",
        version_group: asset3dDraft.versionGroup || "",
        version_label: asset3dDraft.versionLabel || "",
        tags: asset3dTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      },
    });
  }, [asset3dDraft, asset3dTags, selected3dAsset]);

  const exportCollectionMetadata = useCallback(
    async (collectionName: string) => {
      try {
        setError(null);
        const data = await exportAssets3dCollectionApi(collectionName);
        const safe = collectionName.toLowerCase().replace(/[^a-z0-9_-]+/gi, "-");
        downloadJsonFile(`${safe || "collection"}.collection.json`, data);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [],
  );

  const addTraitRow = useCallback(() => {
    setAsset3dDraft((prev) => ({
      ...prev,
      traits: [...(prev.traits || []), { trait_type: "", value: "", display_type: "" }],
    }));
  }, []);

  const useSelected3dAsImageTo3dSource = useCallback(() => {
    if (!selected3dAsset) return;
    setGenMode("i23d");
    setGenImagePath(selected3dAsset.relativePath);
    if (asset3dDraft.polishPrompt?.trim()) setGenPrompt(asset3dDraft.polishPrompt.trim());
  }, [asset3dDraft.polishPrompt, selected3dAsset]);

  const copySelected3dPrompt = useCallback(() => {
    if (asset3dDraft.polishPrompt?.trim()) {
      setGenPrompt(asset3dDraft.polishPrompt.trim());
    }
  }, [asset3dDraft.polishPrompt]);

  const assignPreviewAsCover = useCallback(() => {
    if (!previewPath || detectPreviewKind(previewPath) !== "image") return;
    setAsset3dDraft((prev) => ({ ...prev, coverImagePath: previewPath }));
  }, [previewPath]);

  return (
    <div className="bg-grid mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-3 py-4 pb-24 text-zinc-100 sm:gap-6 sm:px-4 sm:py-8 sm:pb-8">
      <Script
        type="module"
        src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"
      />
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

      {appStatus?.modeSupport?.length ? (
        <section id="node-check" className="scroll-mt-20 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-zinc-300">Node-Check</h2>
            <span className="text-zinc-500">Comfy-Kompatibilität pro Modus</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {appStatus.modeSupport.map((item) => (
              <div key={item.mode} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200">{item.mode}</span>
                  <span className={item.ok ? "text-emerald-400" : "text-amber-400"}>
                    {item.ok ? "bereit" : "fehlt"}
                  </span>
                </div>
                {!item.ok ? (
                  <p className="mt-1 whitespace-pre-wrap text-[11px] text-zinc-500">
                    {item.missing.join("\n")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <nav className="sticky top-0 z-10 flex flex-wrap gap-2 border-y border-zinc-800 bg-zinc-950/95 py-2 text-xs backdrop-blur">
        <a href="#node-check" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          Node-Check
        </a>
        <a href="#models" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          Modelle
        </a>
        <a href="#studio" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          AI Studio
        </a>
        <a href="#workflow" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          Workflow
        </a>
        <a href="#gallery3d" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          3D Gallery
        </a>
        <a href="#uploads" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          Uploads
        </a>
      </nav>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-300">Tools</h2>
          <p className="text-[11px] text-zinc-500">Schnellwahl für Modi + Templates</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["t2v", "Text→Video"],
            ["i2v", "Bild→Video"],
            ["i2i", "KI-Foto"],
            ["upscale", "Upscale"],
            ["face-swap", "Face Swap"],
            ["i23d", "Image→3D"],
          ].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => loadTemplate(mode as GenMode, mode === "i2i" ? photoTool : undefined)}
              className={`rounded px-3 py-1.5 text-xs ${genMode === mode ? "bg-violet-500 text-white" : "border border-zinc-700 bg-zinc-900 text-zinc-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["generate", "enhance", "style", "background-remove", "retouch"] as PhotoToolKind[]).map((tool) => (
            <button
              key={tool}
              type="button"
              onClick={() => loadTemplate("i2i", tool)}
              className={`rounded px-3 py-1.5 text-xs ${photoTool === tool ? "bg-emerald-500 text-zinc-950" : "border border-zinc-700 bg-zinc-900 text-zinc-200"}`}
            >
              {tool}
            </button>
          ))}
        </div>
      </section>

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
                  {m.sourceUrl ? <p className="truncate text-[11px] text-zinc-600">Quelle bereit</p> : <p className="text-[11px] text-zinc-600">Quelle fehlt</p>}
                  {!m.ready ? (
                    <button
                      type="button"
                      onClick={() => void startModelDownload(m.key)}
                      className="mt-2 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
                    >
                      {m.sourceUrl ? "Download" : "Hinweis"}
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
                Fehlende Modelle
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
              {downloadStatus.status ? `Status: ${downloadStatus.status}\n` : ""}
              {downloadStatus.model ? `Modell: ${downloadStatus.model}\n` : ""}
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
                <option value="face-swap">Face Swap</option>
                <option value="i23d">Image to 3D</option>
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
              placeholder={genMode === "face-swap" ? "Optionaler Prompt / Notizen..." : genMode === "i23d" ? "Optional: 3D Stil / Material / Look..." : "Prompt..."}
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
              <div className="space-y-1">
                <p className="text-[11px] text-zinc-500">
                  {genMode === "face-swap" ? "Target / Zielbild" : "Bildpfad"}
                </p>
                <input
                  value={genImagePath}
                  onChange={(e) => setGenImagePath(e.target.value)}
                  placeholder={genMode === "face-swap" ? "Zielbild-Pfad (Uploads / Comfy)" : "Bildpfad (Uploads / Comfy)"}
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
                />
              </div>
            </div>
            {genMode === "face-swap" ? (
              <div className="mt-2 rounded border border-zinc-800 bg-zinc-900/50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-zinc-500">Source / Quellgesicht</p>
                  <button
                    type="button"
                    onClick={() => {
                      setGenImagePath(genSecondImagePath);
                      setGenSecondImagePath(genImagePath);
                    }}
                    className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300"
                  >
                    Target ↔ Source
                  </button>
                </div>
                <input
                  value={genSecondImagePath}
                  onChange={(e) => setGenSecondImagePath(e.target.value)}
                  placeholder="Quellgesicht-Pfad (Uploads / Comfy)"
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
                />
              </div>
            ) : null}
            {(genMode === "face-swap" || genMode === "i23d") ? (
              <p className="mt-2 text-[11px] text-zinc-500">
                Keine zusätzliche App-seitige Prompt-Zensur. Grenzen kommen nur von deinem Backend / den installierten Comfy-Nodes.
              </p>
            ) : null}
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
                        <div key={url} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                          <video
                            src={url}
                            controls
                            playsInline
                            className="max-h-48 max-w-[min(100%,280px)] rounded border border-zinc-700"
                          />
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 block text-[11px] text-emerald-400"
                          >
                            Download {getOutputFilename(url)}
                          </a>
                        </div>
                      ) : isImageOutputUrl(url) ? (
                        <div key={url} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                          {/* eslint-disable-next-line @next/next/no-img-element -- Comfy-Ausgabe */}
                          <img
                            src={url}
                            alt=""
                            className="max-h-48 max-w-[min(100%,280px)] rounded border border-zinc-700 object-contain"
                          />
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 block text-[11px] text-emerald-400"
                          >
                            Download {getOutputFilename(url)}
                          </a>
                        </div>
                      ) : (
                        <div key={url} className="min-w-[220px] rounded border border-zinc-800 bg-zinc-900 p-3">
                          <p className="text-xs text-zinc-200">{is3dOutputUrl(url) ? "3D Export" : "Datei"}</p>
                          <p className="mt-1 break-all text-[11px] text-zinc-500">{getOutputFilename(url)}</p>
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 block text-[11px] text-emerald-400"
                          >
                            {is3dOutputUrl(url) ? "3D-Datei öffnen / downloaden" : "Datei öffnen / downloaden"}
                          </a>
                        </div>
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

          <div id="gallery3d" className="scroll-mt-20 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-zinc-300">3D Gallery / Asset Library</p>
                <p className="text-[11px] text-zinc-500">
                  Sammlung, Preview, NFT-Metadaten und Feinschliff für deine 3D-Assets.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshAssets3d()}
                className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300"
              >
                Aktualisieren
              </button>
            </div>

            {assets3d.length > 0 ? (
              <div className="mt-3 space-y-3">
                <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-zinc-300">Collections / Grid</p>
                    <p className="text-[11px] text-zinc-500">NFT-Übersicht + Drag & Drop Sortierung</p>
                  </div>
                  <div className="mt-3 space-y-4">
                    {assetCollections.map((group) => (
                      <div
                        key={group.name}
                        draggable
                        onDragStart={() => setDragCollectionName(group.name)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => void moveCollection(dragCollectionName, group.name)}
                        className="rounded border border-zinc-800 bg-zinc-950/40 p-2"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                            {group.name} · {group.items.length}
                          </p>
                          <button
                            type="button"
                            onClick={() => void exportCollectionMetadata(group.name)}
                            className="rounded border border-fuchsia-700 bg-fuchsia-950/30 px-2 py-1 text-[11px] text-fuchsia-200"
                          >
                            Collection JSON
                          </button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          {group.items.map((asset) => (
                            <button
                              key={asset.relativePath}
                              type="button"
                              draggable
                              onDragStart={() => setDragAssetPath(asset.relativePath)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => void moveAssetInCollection(dragAssetPath, asset.relativePath)}
                              onClick={() => applySelected3dAsset(asset)}
                              className={`overflow-hidden rounded border text-left ${selected3dPath === asset.relativePath ? "border-violet-500 bg-violet-950/30" : "border-zinc-800 bg-zinc-950"}`}
                            >
                              {asset.metadata.coverImagePath ? (
                                // eslint-disable-next-line @next/next/no-img-element -- local cover thumbnail
                                <img
                                  src={fileUrlFromRelativePath(asset.metadata.coverImagePath)}
                                  alt=""
                                  className="h-32 w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-32 items-center justify-center bg-zinc-900 text-[11px] text-zinc-600">
                                  no cover
                                </div>
                              )}
                              <div className="p-2">
                                <p className="truncate text-xs text-zinc-200">
                                  {asset.metadata.title || getOutputFilename(asset.relativePath)}
                                </p>
                                <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
                                  <span>{asset.metadata.versionLabel || asset.metadata.stage || "draft"}</span>
                                  <span>.{asset.extension}</span>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
                  <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
                    {assets3d.map((asset) => (
                      <button
                        key={asset.relativePath}
                        type="button"
                        draggable
                        onDragStart={() => setDragAssetPath(asset.relativePath)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => void moveAssetInCollection(dragAssetPath, asset.relativePath)}
                        onClick={() => applySelected3dAsset(asset)}
                        className={`w-full rounded border p-2 text-left ${selected3dPath === asset.relativePath ? "border-violet-500 bg-violet-950/30" : "border-zinc-800 bg-zinc-900"}`}
                      >
                        <p className="truncate text-xs text-zinc-200">
                          {asset.metadata.title || getOutputFilename(asset.relativePath)}
                        </p>
                        <p className="truncate text-[11px] text-zinc-500">{asset.relativePath}</p>
                        <div className="mt-1 flex items-center justify-between text-[11px]">
                          <span className="text-zinc-500">.{asset.extension}</span>
                          <span className="text-zinc-400">{asset.metadata.versionLabel || asset.metadata.stage || "draft"}</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  {selected3dAsset ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
                        <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
                          {asset3dDraft.coverImagePath ? (
                            // eslint-disable-next-line @next/next/no-img-element -- local cover preview
                            <img
                              src={fileUrlFromRelativePath(asset3dDraft.coverImagePath)}
                              alt=""
                              className="mb-2 h-36 w-full rounded border border-zinc-800 object-cover"
                            />
                          ) : null}
                          {selected3dAsset.previewable ? (
                            <div ref={modelViewerRef} className="h-[360px] w-full" />
                          ) : (
                            <div className="flex h-[360px] items-center justify-center rounded bg-zinc-950 text-center text-xs text-zinc-500">
                              Kein Live-Preview für .{selected3dAsset.extension}. Datei bleibt downloadbar.
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                            <a href={selected3dAsset.url} target="_blank" rel="noreferrer" className="text-emerald-400">
                              Datei öffnen / downloaden
                            </a>
                            <button type="button" onClick={useSelected3dAsImageTo3dSource} className="text-sky-400">
                              Als Image→3D Quelle nutzen
                            </button>
                            <button type="button" onClick={copySelected3dPrompt} className="text-violet-400">
                              Polish-Prompt → Generator
                            </button>
                            <button type="button" onClick={assignPreviewAsCover} className="text-amber-400">
                              Preview als Cover
                            </button>
                            <button type="button" onClick={exportSelected3dMetadata} className="text-fuchsia-400">
                              NFT JSON exportieren
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void exportCollectionMetadata(
                                  selected3dAsset.metadata.collection?.trim() || "Ohne Collection",
                                )
                              }
                              className="text-pink-400"
                            >
                              Ganze Collection exportieren
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900 p-3">
                          <input
                            value={asset3dDraft.title || ""}
                            onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, title: e.target.value }))}
                            placeholder="Titel"
                            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                          />
                          <input
                            value={asset3dDraft.collection || ""}
                            onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, collection: e.target.value }))}
                            placeholder="Collection / Serie"
                            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                          />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <input
                              value={asset3dDraft.versionGroup || ""}
                              onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, versionGroup: e.target.value }))}
                              placeholder="Version Group / Asset Family"
                              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                            />
                            <input
                              value={asset3dDraft.versionLabel || ""}
                              onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, versionLabel: e.target.value }))}
                              placeholder="Version Label (v1, v2, final)"
                              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                            />
                          </div>
                          <input
                            value={asset3dDraft.coverImagePath || ""}
                            onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, coverImagePath: e.target.value }))}
                            placeholder="Cover-Bild Pfad"
                            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                          />
                          <input
                            value={asset3dTags}
                            onChange={(e) => setAsset3dTags(e.target.value)}
                            placeholder="Tags, comma separated"
                            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                          />
                          <select
                            value={asset3dDraft.stage || "draft"}
                            onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, stage: e.target.value as "draft" | "polish" | "final" }))}
                            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                          >
                            <option value="draft">Draft</option>
                            <option value="polish">Polish</option>
                            <option value="final">Final</option>
                          </select>
                          <textarea
                            value={asset3dDraft.polishPrompt || ""}
                            onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, polishPrompt: e.target.value }))}
                            placeholder="Polish-Prompt / Rework-Idee"
                            className="min-h-20 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                          />
                          <textarea
                            value={asset3dDraft.notes || ""}
                            onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, notes: e.target.value }))}
                            placeholder="Notizen / Feinschliff"
                            className="min-h-20 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                          />
                          <div className="grid gap-2 sm:grid-cols-3">
                            <input
                              type="number"
                              step="0.1"
                              value={asset3dDraft.scale ?? 1}
                              onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, scale: Number(e.target.value) }))}
                              placeholder="Scale"
                              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                            />
                            <input
                              type="number"
                              step="1"
                              value={asset3dDraft.rotationY ?? 0}
                              onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, rotationY: Number(e.target.value) }))}
                              placeholder="Y Rotation"
                              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                            />
                            <input
                              type="number"
                              step="0.1"
                              value={asset3dDraft.exposure ?? 1}
                              onChange={(e) => setAsset3dDraft((prev) => ({ ...prev, exposure: Number(e.target.value) }))}
                              placeholder="Exposure"
                              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200"
                            />
                          </div>

                          <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] text-zinc-500">Traits / Attributes</p>
                              <button type="button" onClick={addTraitRow} className="text-[11px] text-emerald-400">
                                + Trait
                              </button>
                            </div>
                            <div className="mt-2 space-y-2">
                              {(asset3dDraft.traits || []).map((trait, index) => (
                                <div key={`${index}-${trait.trait_type}-${trait.value}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_120px_32px]">
                                  <input
                                    value={trait.trait_type}
                                    onChange={(e) =>
                                      setAsset3dDraft((prev) => ({
                                        ...prev,
                                        traits: (prev.traits || []).map((item, i) =>
                                          i === index ? { ...item, trait_type: e.target.value } : item,
                                        ),
                                      }))
                                    }
                                    placeholder="trait_type"
                                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
                                  />
                                  <input
                                    value={trait.value}
                                    onChange={(e) =>
                                      setAsset3dDraft((prev) => ({
                                        ...prev,
                                        traits: (prev.traits || []).map((item, i) =>
                                          i === index ? { ...item, value: e.target.value } : item,
                                        ),
                                      }))
                                    }
                                    placeholder="value"
                                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
                                  />
                                  <input
                                    value={trait.display_type || ""}
                                    onChange={(e) =>
                                      setAsset3dDraft((prev) => ({
                                        ...prev,
                                        traits: (prev.traits || []).map((item, i) =>
                                          i === index ? { ...item, display_type: e.target.value } : item,
                                        ),
                                      }))
                                    }
                                    placeholder="display"
                                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setAsset3dDraft((prev) => ({
                                        ...prev,
                                        traits: (prev.traits || []).filter((_, i) => i !== index),
                                      }))
                                    }
                                    className="rounded border border-red-900 bg-red-950/40 px-2 py-2 text-xs text-red-300"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              {!(asset3dDraft.traits || []).length ? (
                                <p className="text-[11px] text-zinc-600">Noch keine NFT-Attribute.</p>
                              ) : null}
                            </div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              disabled={asset3dSaving}
                              onClick={() => void saveSelected3dAsset()}
                              className="rounded bg-emerald-500 px-3 py-2 text-xs font-medium text-zinc-950 disabled:opacity-50"
                            >
                              {asset3dSaving ? "Speichert…" : "Asset speichern"}
                            </button>
                            <button
                              type="button"
                              onClick={exportSelected3dMetadata}
                              className="rounded border border-fuchsia-700 bg-fuchsia-950/30 px-3 py-2 text-xs text-fuchsia-200"
                            >
                              NFT Metadata JSON
                            </button>
                          </div>

                          <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
                            <p className="text-[11px] text-zinc-500">Versionen</p>
                            <div className="mt-2 space-y-1">
                              {relatedVersions.map((asset) => (
                                <button
                                  key={asset.relativePath}
                                  type="button"
                                  onClick={() => applySelected3dAsset(asset)}
                                  className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left text-[11px] ${asset.relativePath === selected3dPath ? "border-violet-500 bg-violet-950/30 text-zinc-100" : "border-zinc-800 bg-zinc-900 text-zinc-400"}`}
                                >
                                  <span className="truncate">{asset.metadata.versionLabel || getOutputFilename(asset.relativePath)}</span>
                                  <span>{asset.metadata.stage || "draft"}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-zinc-500">
                Noch keine 3D-Dateien in den Uploads. Lade `.glb`, `.gltf`, `.obj`, `.ply`, `.stl`, `.fbx` oder `.usdz` hoch.
              </p>
            )}
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
                    className="text-[11px] text-emerald-400 hover:text-emerald-300"
                    onClick={() => setGenImagePath(f.relativePath)}
                  >
                    → Main
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-sky-400 hover:text-sky-300"
                    onClick={() => setGenImagePath(f.relativePath)}
                  >
                    → Target
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-violet-400 hover:text-violet-300"
                    onClick={() => setGenSecondImagePath(f.relativePath)}
                  >
                    → Source
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-amber-400 hover:text-amber-300"
                    onClick={() => setAsset3dDraft((prev) => ({ ...prev, coverImagePath: f.relativePath }))}
                  >
                    → Cover
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
