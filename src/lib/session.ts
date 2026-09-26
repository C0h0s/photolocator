import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { config } from "./config";
import { signToken, verifyToken } from "./signing";
import type { SessionUser } from "./types";

export const SESSION_COOKIE = "pl_session";
export const OAUTH_COOKIE = "pl_oauth";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const globals = globalThis as { __photolocatorSecret?: string };

function secret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (!globals.__photolocatorSecret) {
    // Safe but ephemeral: everyone is signed out and anonymous quotas reset on restart.
    console.warn("SESSION_SECRET is missing or shorter than 32 characters; using a random per-process secret.");
    globals.__photolocatorSecret = randomBytes(32).toString("hex");
  }
  return globals.__photolocatorSecret;
}

export function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: config.secureCookies, path: "/", maxAge };
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const payload = verifyToken<SessionUser & { exp: number }>(jar.get(SESSION_COOKIE)?.value, secret());
  if (!payload) return null;
  return { uid: payload.uid, name: payload.name, avatar: payload.avatar };
}

export function createSessionCookie(user: SessionUser) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return {
    name: SESSION_COOKIE,
    value: signToken({ ...user, exp }, secret()),
    options: cookieOptions(SESSION_TTL_SECONDS),
  };
}

export function sign(payload: Record<string, unknown>): string {
  return signToken(payload, secret());
}

export function verify<T>(token: string | undefined): T | null {
  return verifyToken<T>(token, secret());
}

/** Stable, non-reversible identifier (used so raw IP addresses never hit the disk). */
export function hashIdentifier(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url").slice(0, 32);
}
