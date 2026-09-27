// Shared between server and client code — keep this file free of Node imports.

export type SearchMode = "quick" | "deep";
export type SearchStatus = "processing" | "complete" | "failed";
/** Pipeline position, mirrored by the stepper on the result page. */
export type SearchStage = "queued" | "region" | "clues" | "street" | "verify" | "done";
export type Confidence = "high" | "medium" | "low";

export interface Candidate {
  name: string;
  lat: number;
  lng: number;
  /** 0–100, how likely the model thinks this spot is. */
  likelihood?: number;
}

export interface LocationResult {
  name: string;
  country: string;
  lat: number;
  lng: number;
  confidence: Confidence;
  /** 0–100 likelihood for the primary answer. */
  likelihood?: number;
  /** How far off the pin could plausibly be. */
  radiusKm: number;
  cues: string[];
  reasoning: string;
  /** How the answer was cross-checked (satellite layout, reference photos, OSM features…). */
  verification?: string;
  alternatives: Candidate[];
  /** "exif" when the pin was snapped to GPS coordinates embedded in the file. */
  source: "visual" | "exif";
}

/** A cluster of GeoCLIP predictions — the "find region" stage. */
export interface RegionGuess {
  name: string;
  lat: number;
  lng: number;
  /** Share of GeoCLIP's probability mass (0–1). */
  share: number;
}

export interface RegionModelOutput {
  model: string;
  regions: RegionGuess[];
  /** [lat, lng, weight] points for the heatmap. */
  heat: [number, number, number][];
}

export type EvidenceKind = "satellite" | "street" | "reference" | "crop";

export interface Evidence {
  /** Index used in /api/search/<id>/evidence/<n>. */
  n: number;
  kind: EvidenceKind;
  caption: string;
  lat?: number;
  lng?: number;
  credit?: string;
  link?: string;
}

export interface LogEvent {
  at: string;
  kind: "stage" | "tool" | "thought" | "warn";
  label: string;
  detail?: string;
}

export interface ExifInfo {
  lat?: number;
  lng?: number;
  takenAt?: string;
  camera?: string;
}

/** What the result page and the status API expose. */
export interface PublicSearch {
  id: string;
  mode: SearchMode;
  status: SearchStatus;
  stage: SearchStage;
  createdAt: string;
  updatedAt: string;
  hasExifGps: boolean;
  regionModel?: RegionModelOutput;
  events?: LogEvent[];
  evidence?: Evidence[];
  result?: LocationResult;
  error?: string;
}

export interface SessionUser {
  uid: number;
  name: string;
  avatar?: string;
}

export interface QuotaStatus {
  limit: number;
  used: number;
  remaining: number;
}
