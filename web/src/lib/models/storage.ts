import path from "node:path";

export const MODELS_STORAGE_ROOT = path.join(process.cwd(), "storage", "models");

export const MODEL_ENTRIES = [
  {
    key: "wan21" as const,
    name: "WAN 2.1 Bundle",
    subfolder: "wan21",
    minReadyBytes: 80 * 1024 * 1024,
  },
  {
    key: "wan22" as const,
    name: "WAN 2.2 Bundle",
    subfolder: "wan22",
    minReadyBytes: 80 * 1024 * 1024,
  },
  {
    key: "ltx2" as const,
    name: "LTX Video 2",
    subfolder: "ltx2",
    minReadyBytes: 80 * 1024 * 1024,
  },
];

export type ModelKey = (typeof MODEL_ENTRIES)[number]["key"];
