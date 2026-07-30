import path from "node:path";

export const MODELS_STORAGE_ROOT = path.join(process.cwd(), "storage", "models");

export const MODEL_ENTRIES = [
  {
    key: "wan21" as const,
    name: "WAN 2.1 Bundle",
    subfolder: "wan21",
    minReadyBytes: 80 * 1024 * 1024,
    sourceUrl: process.env.MODEL_WAN21_URL?.trim() || "",
    sourceFileName: process.env.MODEL_WAN21_FILENAME?.trim() || "wan21.bin",
  },
  {
    key: "wan22" as const,
    name: "WAN 2.2 Bundle",
    subfolder: "wan22",
    minReadyBytes: 80 * 1024 * 1024,
    sourceUrl: process.env.MODEL_WAN22_URL?.trim() || "",
    sourceFileName: process.env.MODEL_WAN22_FILENAME?.trim() || "wan22.bin",
  },
  {
    key: "ltx2" as const,
    name: "LTX Video 2",
    subfolder: "ltx2",
    minReadyBytes: 80 * 1024 * 1024,
    sourceUrl: process.env.MODEL_LTX2_URL?.trim() || process.env.MODEL_LTX_VIDEO2_URL?.trim() || "",
    sourceFileName: process.env.MODEL_LTX2_FILENAME?.trim() || "ltx2.bin",
  },
];

export type ModelKey = (typeof MODEL_ENTRIES)[number]["key"];
