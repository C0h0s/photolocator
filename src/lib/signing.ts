import { createHmac, timingSafeEqual } from "node:crypto";

// Compact HMAC-signed tokens for cookies: base64url(json).base64url(hmac).
// Payloads carry `exp` in seconds since the epoch.

function mac(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signToken(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function verifyToken<T>(token: string | undefined, secret: string, now = Date.now()): T | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(body, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload !== "object" || payload === null) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < now) return null;
    return payload as T;
  } catch {
    return null;
  }
}

/** Only allow same-site relative paths as post-login destinations. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}
