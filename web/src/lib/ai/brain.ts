import { addBrainSuggestion } from "./store";

export async function processFeedbackAndSuggest(payload: {
  prompt: string;
  mode: string;
  rating: number;
  durationSec: number;
  motionEnabled: boolean;
}): Promise<void> {
  const r = payload.rating;
  if (r <= 2) {
    await addBrainSuggestion({
      title: "Sanftere Motion",
      description: "Reduziere Motion-Stärke oder teste kürzere Clips.",
      kind: "filter",
      confidence: 0.72,
    });
  } else if (r >= 4) {
    await addBrainSuggestion({
      title: "Bold Cinematic",
      description: "Erhöhe Kontrast-Prompt und nutze längere Kamera-Pfade.",
      kind: "workflow",
      confidence: 0.68,
    });
  }
  await addBrainSuggestion({
    title: "Batch-Tool",
    description: `Für Modus ${payload.mode}: mehrere Varianten in ComfyUI-Warteschlange legen.`,
    kind: "tool",
    confidence: 0.55,
  });
}
