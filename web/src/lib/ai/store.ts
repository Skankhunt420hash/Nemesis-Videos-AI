import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BrainSuggestion, GenerationJob, GenerationRequest } from "./types";

const STORAGE_ROOT = path.join(process.cwd(), "storage", "ai");
const JOBS_FILE = path.join(STORAGE_ROOT, "jobs.json");
const BRAIN_FILE = path.join(STORAGE_ROOT, "brain.json");

type JobsMap = Record<string, GenerationJob>;
type BrainState = {
  suggestions: BrainSuggestion[];
};

async function ensureStorage(): Promise<void> {
  await mkdir(STORAGE_ROOT, { recursive: true });
}

async function readJsonOrDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureStorage();
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

export async function createJob(
  req: GenerationRequest,
  backendUsed: "local" | "cloud",
): Promise<GenerationJob> {
  const jobs = await readJsonOrDefault<JobsMap>(JOBS_FILE, {});
  const now = new Date().toISOString();
  const job: GenerationJob = {
    id: randomUUID(),
    request: req,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    backendUsed,
    outputPaths: [],
    logs: ["Job erstellt"],
  };
  jobs[job.id] = job;
  await writeJson(JOBS_FILE, jobs);
  return job;
}

export async function getJob(id: string): Promise<GenerationJob | null> {
  const jobs = await readJsonOrDefault<JobsMap>(JOBS_FILE, {});
  return jobs[id] || null;
}

export async function updateJob(
  id: string,
  patch: Partial<GenerationJob>,
  logLine?: string,
): Promise<GenerationJob | null> {
  const jobs = await readJsonOrDefault<JobsMap>(JOBS_FILE, {});
  const existing = jobs[id];
  if (!existing) return null;
  const updated: GenerationJob = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
    logs: logLine ? [...existing.logs, logLine] : existing.logs,
  };
  jobs[id] = updated;
  await writeJson(JOBS_FILE, jobs);
  return updated;
}

export async function listBrainSuggestions(): Promise<BrainSuggestion[]> {
  const state = await readJsonOrDefault<BrainState>(BRAIN_FILE, { suggestions: [] });
  return state.suggestions.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function addBrainSuggestion(
  suggestion: Omit<BrainSuggestion, "id" | "generatedAt">,
): Promise<BrainSuggestion> {
  const state = await readJsonOrDefault<BrainState>(BRAIN_FILE, { suggestions: [] });
  const next: BrainSuggestion = {
    ...suggestion,
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
  };
  state.suggestions.push(next);
  await writeJson(BRAIN_FILE, state);
  return next;
}
