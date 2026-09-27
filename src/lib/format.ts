// Small presentation helpers shared by client components. No Node imports.

import type { Confidence, LogEvent, SearchStage } from "./types";

/** Signal-lamp tiers: jade = strong, lime = good, amber = mid, red = weak. */
export type Tier = "jade" | "lime" | "amber" | "red";

export function tierFor(likelihood: number | undefined): Tier {
  const p = likelihood ?? 0;
  if (p >= 50) return "jade";
  if (p >= 25) return "lime";
  if (p >= 10) return "amber";
  return "red";
}

export const confidenceTier: Record<Confidence, Tier> = { high: "jade", medium: "amber", low: "red" };

export const STEPS: { stage: Exclude<SearchStage, "queued" | "done">; label: string; hint: string }[] = [
  { stage: "region", label: "Find region", hint: "GeoCLIP ranks regions worldwide" },
  { stage: "clues", label: "Read clues", hint: "Signs, architecture, terrain, vegetation" },
  { stage: "street", label: "Find street", hint: "Geocoding, OpenStreetMap, web search" },
  { stage: "verify", label: "Verify", hint: "Satellite and reference imagery" },
];

const ORDER: SearchStage[] = ["queued", "region", "clues", "street", "verify", "done"];
export const stageIndex = (stage: SearchStage) => ORDER.indexOf(stage);

export function elapsed(from: string, to: string): string {
  const s = Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000);
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function eventIcon(event: LogEvent): string {
  if (event.kind === "thought") return "thought";
  if (event.kind === "warn") return "warn";
  const l = event.label.toLowerCase();
  if (l.includes("satellite")) return "satellite";
  if (l.includes("photo") && l.includes("zoom")) return "zoom";
  if (l.includes("reference") || l.includes("street-level")) return "photos";
  if (l.includes("web")) return "web";
  if (l.includes("openstreetmap") || l.includes("geocod") || l.includes("address")) return "map";
  return "step";
}
