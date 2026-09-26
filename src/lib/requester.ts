import { headers } from "next/headers";
import { config } from "./config";
import { getSession, hashIdentifier } from "./session";
import { getQuota } from "./store";
import type { QuotaStatus, SessionUser } from "./types";

export interface Requester {
  user: SessionUser | null;
  /** Key the daily quota is counted against. */
  quotaKey: string;
  limit: number;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  // The rightmost X-Forwarded-For entry is the one appended by the proxy nearest to us
  // (or by Next itself); anything to its left can be forged by the client. Behind two
  // proxies (e.g. Cloudflare → nginx) you'd want the second-to-last entry instead.
  const hops = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return hops.at(-1) || h.get("x-real-ip") || "unknown";
}

export async function getRequester(): Promise<Requester> {
  const user = await getSession();
  if (user) return { user, quotaKey: `osm:${user.uid}`, limit: config.quota.userPerDay };
  return { user: null, quotaKey: `ip:${hashIdentifier(await clientIp())}`, limit: config.quota.anonymousPerDay };
}

export async function getRequesterQuota(requester: Requester): Promise<QuotaStatus> {
  return getQuota(requester.quotaKey, requester.limit);
}
