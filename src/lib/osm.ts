import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";
import type { SessionUser } from "./types";

// "Sign in with OpenStreetMap" — OAuth 2.0 authorization code flow with PKCE.
// We only need the account's id, display name and avatar, so the sole scope
// requested is read_prefs, and the access token is revoked right after use.

const USER_AGENT = `PhotoLocator/0.1 (+${config.appUrl})`;

export function createPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(state: string, codeChallenge: string): string {
  const url = new URL(`${config.osm.baseUrl}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.osm.clientId,
    redirect_uri: config.osm.redirectUri,
    scope: config.osm.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<string> {
  const res = await fetch(`${config.osm.baseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.osm.redirectUri,
      client_id: config.osm.clientId,
      client_secret: config.osm.clientSecret,
      code_verifier: codeVerifier,
    }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.access_token !== "string") {
    throw new Error(`OSM token exchange failed (${res.status}): ${data.error_description ?? data.error ?? "no access token"}`);
  }
  return data.access_token;
}

export async function fetchOsmUser(accessToken: string): Promise<SessionUser> {
  const res = await fetch(`${config.osm.apiUrl}/api/0.6/user/details.json`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OSM user details request failed (${res.status})`);
  const { user } = await res.json();
  if (typeof user?.id !== "number" || typeof user?.display_name !== "string") {
    throw new Error("Unexpected OSM user details response");
  }
  return { uid: user.id, name: user.display_name, avatar: typeof user.img?.href === "string" ? user.img.href : undefined };
}

export async function revokeToken(accessToken: string): Promise<void> {
  try {
    await fetch(`${config.osm.baseUrl}/oauth2/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: new URLSearchParams({
        token: accessToken,
        client_id: config.osm.clientId,
        client_secret: config.osm.clientSecret,
      }),
      cache: "no-store",
    });
  } catch {
    // Best effort — the token is never stored anyway.
  }
}
