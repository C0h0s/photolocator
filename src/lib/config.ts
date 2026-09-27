import path from "node:path";

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const off = (value: string | undefined) => ["0", "off", "false", "no"].includes((value ?? "").toLowerCase());

const appUrl = (process.env.APP_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

export const config = {
  appUrl,
  secureCookies: appUrl.startsWith("https://"),
  dataDir: path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? ".data"),
  modelsDir: path.resolve(/* turbopackIgnore: true */ process.env.MODELS_DIR ?? "models"),
  model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
  maxUploadBytes: 15 * 1024 * 1024,
  userAgent: `PhotoLocator/0.2 (+${appUrl})`,
  geoclip: {
    enabled: !off(process.env.GEOCLIP),
    /** "quantized" (≈300 MB, default) or "fp32" (≈1.2 GB, slightly more accurate). */
    precision: process.env.GEOCLIP_PRECISION === "fp32" ? "fp32" : "quantized",
  },
  tools: {
    webSearch: !off(process.env.WEB_SEARCH),
    mapillaryToken: process.env.MAPILLARY_TOKEN ?? "",
    nominatimUrl: (process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org").replace(/\/+$/, ""),
    overpassUrls: (process.env.OVERPASS_URLS ?? "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  osm: {
    clientId: process.env.OSM_CLIENT_ID ?? "",
    clientSecret: process.env.OSM_CLIENT_SECRET ?? "",
    baseUrl: (process.env.OSM_BASE_URL ?? "https://www.openstreetmap.org").replace(/\/+$/, ""),
    apiUrl: (process.env.OSM_API_URL ?? "https://api.openstreetmap.org").replace(/\/+$/, ""),
    redirectUri: `${appUrl}/api/auth/osm/callback`,
    scope: "read_prefs",
  },
  quota: {
    anonymousPerDay: int(process.env.FREE_SEARCHES_PER_DAY, 1),
    userPerDay: int(process.env.USER_SEARCHES_PER_DAY, 5),
  },
};

export function osmEnabled(): boolean {
  return Boolean(config.osm.clientId && config.osm.clientSecret);
}
