import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { haversineKm } from "./geo";

// Offline place names from GeoNames cities5000 (CC BY 4.0), built by
// `npm run models:download`. Used to label map regions instantly without
// hammering a geocoding API.

type Row = [lat: number, lng: number, name: string, cc: string, admin1: string, population: number];

interface Gazetteer {
  admin1: Record<string, string>;
  countries: Record<string, string>;
  rows: Row[];
}

export interface Place {
  name: string;
  admin1?: string;
  country: string;
  countryCode: string;
  distanceKm: number;
  label: string;
}

const holder = globalThis as { __photolocatorGazetteer?: Promise<Gazetteer | null> };

function load(): Promise<Gazetteer | null> {
  holder.__photolocatorGazetteer ??= fs
    .readFile(path.join(config.modelsDir, "geonames", "places.json"), "utf8")
    .then((text) => JSON.parse(text) as Gazetteer)
    .catch(() => {
      console.warn("Gazetteer missing — run `npm run models:download` for offline region names.");
      return null;
    });
  return holder.__photolocatorGazetteer;
}

function toPlace(g: Gazetteer, row: Row, distanceKm: number): Place {
  const admin1 = g.admin1[`${row[3]}.${row[4]}`];
  const country = g.countries[row[3]] ?? row[3];
  const label = [row[2], admin1 && admin1 !== row[2] ? admin1 : undefined, country].filter(Boolean).join(", ");
  return { name: row[2], admin1, country, countryCode: row[3], distanceKm, label };
}

/**
 * Best label for a point: prefers well-known towns nearby over the literal
 * nearest hamlet, so a region reads "Banff, Alberta, Canada".
 */
export async function describePlace(lat: number, lng: number, withinKm = 60): Promise<Place | null> {
  const g = await load();
  if (!g) return null;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best: { row: Row; score: number; d: number } | null = null;
  let nearest: { row: Row; d: number } | null = null;
  const degWindow = withinKm / 111 + 0.5;
  for (const row of g.rows) {
    const dLat = row[0] - lat;
    if (dLat > degWindow || dLat < -degWindow) continue;
    // Fast equirectangular distance; accurate enough for ranking within ~100 km.
    const dx = (row[1] - lng) * 111.32 * cosLat;
    const dy = dLat * 110.57;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (!nearest || d < nearest.d) nearest = { row, d };
    if (d > withinKm) continue;
    const score = Math.log10(Math.max(row[5], 1)) - d / 20;
    if (!best || score > best.score) best = { row, score, d };
  }
  const pick = best ?? nearest;
  if (!pick) return null;
  return toPlace(g, pick.row, haversineKm({ lat, lng }, { lat: pick.row[0], lng: pick.row[1] }));
}
