import sharp from "sharp";
import { config } from "./config";

// Thin clients for the open geo services the investigator uses. All of them
// are free; each has a fair-use policy, so requests are throttled, identified
// with a User-Agent and kept small.

const TIMEOUT_MS = 30_000;
const headers = () => ({ "User-Agent": config.userAgent, Accept: "application/json", "Accept-Language": "en" });

const throttles = globalThis as { __photolocatorThrottles?: Map<string, number> };

/** Spaces out calls to one host (Nominatim allows 1 request per second). */
async function throttle(key: string, gapMs: number): Promise<void> {
  const map = (throttles.__photolocatorThrottles ??= new Map());
  const now = Date.now();
  const at = Math.max(now, map.get(key) ?? 0);
  map.set(key, at + gapMs);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...headers(), ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as T;
}

async function getImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const round = (n: number, d = 5) => Number(n.toFixed(d));

// --- Nominatim (OpenStreetMap geocoder) --------------------------------------

interface NominatimPlace {
  display_name: string;
  lat: string;
  lon: string;
  category?: string;
  class?: string;
  type?: string;
  address?: Record<string, string>;
}

export async function geocode(query: string, countryCode: string): Promise<string> {
  await throttle("nominatim", 1100);
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "6" });
  if (/^[a-z]{2}(,[a-z]{2})*$/i.test(countryCode)) params.set("countrycodes", countryCode.toLowerCase());
  const results = await getJson<NominatimPlace[]>(`${config.tools.nominatimUrl}/search?${params}`);
  if (!results.length) return `No OpenStreetMap matches for "${query}".`;
  return results
    .map((r, i) => `${i + 1}. ${r.display_name} [${r.category ?? r.class}/${r.type}] at ${round(Number(r.lat))}, ${round(Number(r.lon))}`)
    .join("\n");
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  await throttle("nominatim", 1100);
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: "jsonv2", zoom: "17", addressdetails: "1" });
  const r = await getJson<NominatimPlace & { error?: string }>(`${config.tools.nominatimUrl}/reverse?${params}`);
  if (r.error) return `Nothing found at ${lat}, ${lng}.`;
  const address = Object.entries(r.address ?? {})
    .filter(([k]) => !k.startsWith("ISO"))
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return `${r.display_name}\n${address}`;
}

// --- Overpass (query OpenStreetMap features) --------------------------------

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const INTERESTING_TAGS = ["name", "brand", "operator", "amenity", "shop", "highway", "railway", "building", "tourism", "leisure", "landuse", "natural", "man_made", "power", "ref", "addr:street", "addr:city"];

// When every mirror has just failed, fail fast for a while instead of making
// each tool call wait out the timeouts again.
const overpassState = globalThis as { __photolocatorOverpassDownUntil?: number };

export async function overpass(query: string): Promise<string> {
  if ((overpassState.__photolocatorOverpassDownUntil ?? 0) > Date.now()) {
    throw new Error("Overpass is unavailable right now; use geocode or web search instead");
  }
  let q = query.trim();
  if (!/^\s*\[out:json/.test(q)) q = `[out:json][timeout:25];\n${q}`;
  let lastError: unknown;
  for (const url of config.tools.overpassUrls) {
    try {
      await throttle(url, 1000);
      const data = await getJson<{ elements: OverpassElement[]; remark?: string }>(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: q }),
      });
      const elements = data.elements ?? [];
      if (!elements.length) return `No elements matched.${data.remark ? ` Remark: ${data.remark}` : ""}`;
      const lines = elements.slice(0, 40).map((e) => {
        const lat = e.lat ?? e.center?.lat;
        const lon = e.lon ?? e.center?.lon;
        const tags = Object.entries(e.tags ?? {})
          .filter(([k]) => INTERESTING_TAGS.includes(k))
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        return `${e.type}/${e.id}${lat !== undefined && lon !== undefined ? ` at ${round(lat)}, ${round(lon)}` : ""}${tags ? ` — ${tags}` : ""}`;
      });
      const more = elements.length > 40 ? `\n… ${elements.length - 40} more (narrow the query or use out count).` : "";
      return `${elements.length} element(s):\n${lines.join("\n")}${more}`.slice(0, 8000);
    } catch (err) {
      lastError = err;
    }
  }
  overpassState.__photolocatorOverpassDownUntil = Date.now() + 10 * 60 * 1000;
  throw lastError instanceof Error ? lastError : new Error("Overpass is unavailable");
}

// --- Satellite imagery (Esri World Imagery tiles, stitched) -----------------

const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const TILE = 256;

export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** A north-up 512×512 satellite snapshot centred on the point, with a crosshair on it. */
export async function satelliteSnapshot(lat: number, lng: number, zoom: number): Promise<{ jpeg: Buffer; widthMeters: number }> {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const cx = Math.floor(x);
  const cy = Math.floor(y);

  const tiles = await Promise.all(
    [-1, 0, 1].flatMap((dy) =>
      [-1, 0, 1].map(async (dx) => {
        const tx = (((cx + dx) % n) + n) % n;
        const ty = cy + dy;
        if (ty < 0 || ty >= n) return null;
        const input = await getImage(`${ESRI_IMAGERY}/${zoom}/${ty}/${tx}`).catch(() => null);
        return input ? { input, left: (dx + 1) * TILE, top: (dy + 1) * TILE } : null;
      }),
    ),
  );
  const placed = tiles.filter((t): t is NonNullable<typeof t> => t !== null);
  if (!placed.length) throw new Error("No satellite imagery available here");

  const px = (x - (cx - 1)) * TILE;
  const py = (y - (cy - 1)) * TILE;
  const size = 512;
  const left = Math.round(Math.min(Math.max(px - size / 2, 0), 3 * TILE - size));
  const top = Math.round(Math.min(Math.max(py - size / 2, 0), 3 * TILE - size));
  const mx = px - left;
  const my = py - top;
  const crosshair = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <g stroke="#ff2d2d" stroke-width="2" fill="none">
        <circle cx="${mx}" cy="${my}" r="14"/>
        <path d="M${mx - 26} ${my}h14M${mx + 12} ${my}h14M${mx} ${my - 26}v14M${mx} ${my + 12}v14"/>
      </g>
      <text x="${size - 22}" y="24" fill="#fff" font-family="sans-serif" font-size="16" font-weight="700" stroke="#000" stroke-width="0.6">N</text>
    </svg>`,
  );
  const mosaic = await sharp({ create: { width: 3 * TILE, height: 3 * TILE, channels: 3, background: "#222" } })
    .composite(placed)
    .jpeg()
    .toBuffer();
  const jpeg = await sharp(mosaic)
    .extract({ left, top, width: size, height: size })
    .composite([{ input: crosshair }])
    .jpeg({ quality: 82 })
    .toBuffer();
  return { jpeg, widthMeters: size * metersPerPixel(lat, zoom) };
}

// --- Reference photos (Wikimedia Commons geotagged files) -------------------

interface CommonsPage {
  title: string;
  coordinates?: { lat: number; lon: number; dist?: number }[];
  imageinfo?: { thumburl?: string; mime?: string; descriptionurl?: string; extmetadata?: Record<string, { value: string }> }[];
}

export interface ReferencePhoto {
  jpeg: Buffer;
  lat: number;
  lng: number;
  distanceM: number;
  caption: string;
  credit: string;
  link: string;
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

export async function commonsPhotosNear(lat: number, lng: number, radiusM: number, limit = 4): Promise<ReferencePhoto[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "geosearch",
    ggscoord: `${lat}|${lng}`,
    ggsradius: String(Math.min(Math.max(Math.round(radiusM), 10), 10_000)),
    ggsnamespace: "6",
    ggslimit: "20",
    prop: "imageinfo|coordinates",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "640",
    iiextmetadatafilter: "Artist|LicenseShortName",
    codistancefrompoint: `${lat}|${lng}`,
  });
  await throttle("commons", 500);
  const data = await getJson<{ query?: { pages?: Record<string, CommonsPage> } }>(`https://commons.wikimedia.org/w/api.php?${params}`);
  const pages = Object.values(data.query?.pages ?? {})
    .filter((p) => p.imageinfo?.[0]?.thumburl && /image\/(jpeg|png|webp)/.test(p.imageinfo[0].mime ?? "") && p.coordinates?.[0])
    .sort((a, b) => (a.coordinates![0].dist ?? 0) - (b.coordinates![0].dist ?? 0))
    .slice(0, limit);
  const photos = await Promise.all(
    pages.map(async (p): Promise<ReferencePhoto | null> => {
      const info = p.imageinfo![0];
      const coord = p.coordinates![0];
      const raw = await getImage(info.thumburl!).catch(() => null);
      if (!raw) return null;
      const jpeg = await sharp(raw).rotate().resize(512, 512, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
      const artist = stripHtml(info.extmetadata?.Artist?.value ?? "") || "Unknown author";
      const license = info.extmetadata?.LicenseShortName?.value ?? "see file page";
      return {
        jpeg,
        lat: coord.lat,
        lng: coord.lon,
        distanceM: Math.round(coord.dist ?? 0),
        caption: p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
        credit: `${artist} · ${license} · Wikimedia Commons`,
        link: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
      };
    }),
  );
  return photos.filter((p): p is ReferencePhoto => p !== null);
}

// --- Street-level imagery (Mapillary, needs a free client token) ------------

interface MapillaryImage {
  id: string;
  thumb_1024_url?: string;
  captured_at?: number;
  compass_angle?: number;
  geometry?: { coordinates: [number, number] };
}

export async function mapillaryNear(lat: number, lng: number, radiusM: number, limit = 3): Promise<ReferencePhoto[]> {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const params = new URLSearchParams({
    access_token: config.tools.mapillaryToken,
    fields: "id,thumb_1024_url,captured_at,compass_angle,geometry",
    bbox: [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((v) => v.toFixed(6)).join(","),
    limit: String(limit * 3),
  });
  const data = await getJson<{ data?: MapillaryImage[] }>(`https://graph.mapillary.com/images?${params}`);
  const images = (data.data ?? []).filter((i) => i.thumb_1024_url && i.geometry).slice(0, limit);
  const photos = await Promise.all(
    images.map(async (img): Promise<ReferencePhoto | null> => {
      const raw = await getImage(img.thumb_1024_url!).catch(() => null);
      if (!raw) return null;
      const [ilng, ilat] = img.geometry!.coordinates;
      const when = img.captured_at ? new Date(img.captured_at).toISOString().slice(0, 10) : "unknown date";
      const heading = img.compass_angle !== undefined ? `, facing ${Math.round(img.compass_angle)}°` : "";
      return {
        jpeg: await sharp(raw).resize(640, 640, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer(),
        lat: ilat,
        lng: ilng,
        distanceM: 0,
        caption: `Street level, ${when}${heading}`,
        credit: "© Mapillary contributors · CC BY-SA",
        link: `https://www.mapillary.com/app/?pKey=${img.id}`,
      };
    }),
  );
  return photos.filter((p): p is ReferencePhoto => p !== null);
}
