// Shared between server and client code — keep this file free of Node imports.

export type SearchMode = "quick" | "deep";
export type SearchStatus = "processing" | "complete" | "failed";
export type SearchStage = "queued" | "analyzing" | "done";
export type Confidence = "high" | "medium" | "low";

export interface Candidate {
  name: string;
  lat: number;
  lng: number;
}

export interface LocationResult {
  name: string;
  country: string;
  lat: number;
  lng: number;
  confidence: Confidence;
  /** How far off the pin could plausibly be. */
  radiusKm: number;
  cues: string[];
  reasoning: string;
  alternatives: Candidate[];
  /** "exif" when the pin was snapped to GPS coordinates embedded in the file. */
  source: "visual" | "exif";
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
