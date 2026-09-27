// Small geo helpers shared by the server and the map. No imports on purpose.

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Zoom level at which a circle of `radiusKm` spans roughly 250px on screen. */
export function zoomForRadius(radiusKm: number, lat: number): number {
  const metersPerPixelAtZ0 = 78271.517 * Math.cos(toRad(lat));
  const zoom = Math.log2((metersPerPixelAtZ0 * 250) / (Math.max(radiusKm, 0.05) * 1000));
  return Math.min(15.5, Math.max(2.5, zoom));
}

/** Closed ring of [lng, lat] points approximating a circle on the sphere. */
export function circleRing(center: LatLng, radiusKm: number, steps = 96): [number, number][] {
  const angular = radiusKm / EARTH_RADIUS_KM;
  const lat1 = toRad(center.lat);
  const lng1 = toRad(center.lng);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([((toDeg(lng2) + 540) % 360) - 180, toDeg(lat2)]);
  }
  return ring;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export const googleMapsUrl = ({ lat, lng }: LatLng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const streetViewUrl = ({ lat, lng }: LatLng) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
export const openStreetMapUrl = ({ lat, lng }: LatLng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;

export function formatRadius(radiusKm: number): string {
  if (radiusKm < 1) return `${Math.max(50, Math.round((radiusKm * 1000) / 50) * 50)} m`;
  if (radiusKm < 10) return `${radiusKm.toFixed(1).replace(/\.0$/, "")} km`;
  return `${Math.round(radiusKm).toLocaleString("en-US")} km`;
}

export interface WeightedPoint {
  lat: number;
  lng: number;
  p: number;
}

export interface Cluster {
  lat: number;
  lng: number;
  /** Summed probability of the member points. */
  weight: number;
  points: number;
}

/**
 * Greedy clustering of ranked predictions: each point joins the first
 * heavier cluster within `radiusKm`, else seeds a new one. Centers are the
 * probability-weighted mean of their members.
 */
export function clusterPredictions(points: WeightedPoint[], radiusKm = 150, maxClusters = 6): Cluster[] {
  const sorted = [...points].sort((a, b) => b.p - a.p);
  const clusters: (Cluster & { seed: LatLng; sumLat: number; sumLng: number })[] = [];
  for (const pt of sorted) {
    const home = clusters.find((c) => haversineKm(c.seed, pt) <= radiusKm);
    if (home) {
      home.weight += pt.p;
      home.points += 1;
      // Longitudes are averaged relative to the seed so clusters straddling ±180° stay intact.
      home.sumLat += pt.p * pt.lat;
      home.sumLng += pt.p * (home.seed.lng + ((((pt.lng - home.seed.lng) % 360) + 540) % 360) - 180);
    } else {
      clusters.push({ seed: pt, lat: pt.lat, lng: pt.lng, weight: pt.p, points: 1, sumLat: pt.p * pt.lat, sumLng: pt.p * pt.lng });
    }
  }
  return clusters
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxClusters)
    .map((c) => ({
      lat: c.sumLat / c.weight,
      lng: ((((c.sumLng / c.weight) % 360) + 540) % 360) - 180,
      weight: c.weight,
      points: c.points,
    }));
}
