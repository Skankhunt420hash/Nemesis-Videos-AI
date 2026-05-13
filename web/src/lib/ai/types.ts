export type GenerationMode = "t2v" | "i2v" | "i2i" | "upscale";
export type BackendMode = "local" | "cloud" | "hybrid";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type PhotoToolKind =
  | "generate"
  | "enhance"
  | "style"
  | "background-remove"
  | "retouch";

export type PhotoTool = PhotoToolKind;

export interface MotionControl {
  enabled: boolean;
  strength: number;
  cameraPath?: string;
  trajectoryPrompt?: string;
  referenceVideoPath?: string;
}

export interface GenerationRequest {
  mode: GenerationMode;
  prompt: string;
  negativePrompt?: string;
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  imageInputPath?: string;
  styleFilter?: string;
  backendMode?: BackendMode;
  photoTool?: PhotoToolKind;
  motion?: MotionControl;
}

export interface GenerationJob {
  id: string;
  request: GenerationRequest;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  backendUsed: "local" | "cloud";
  remoteJobId?: string;
  outputPaths: string[];
  logs: string[];
  error?: string;
}

export interface GenerationResponse {
  jobId: string;
  status: string;
  backendUsed: string;
  durationSec?: number;
  mode?: GenerationMode;
}

export interface BrainSuggestion {
  id: string;
  title: string;
  description: string;
  kind: "filter" | "workflow" | "tool";
  generatedAt: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}
