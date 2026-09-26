import path from "node:path";

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const appUrl = (process.env.APP_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

export const config = {
  appUrl,
  secureCookies: appUrl.startsWith("https://"),
  dataDir: path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? ".data"),
  model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
  maxUploadBytes: 15 * 1024 * 1024,
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
