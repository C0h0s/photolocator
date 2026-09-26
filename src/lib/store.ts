import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config";
import type { ExifInfo, PublicSearch, QuotaStatus } from "./types";

// File-backed persistence. Good for a single long-running server (`next start`,
// a VPS, a container with a volume). For serverless hosting, swap this module for
// a database — nothing else touches the filesystem directly.

export interface SearchRecord extends Omit<PublicSearch, "hasExifGps"> {
  ownerId?: string;
  quotaKey: string;
  quotaDay: string;
  exif?: ExifInfo;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STALE_AFTER_MS = 10 * 60 * 1000;
const OWNER_INDEX_LIMIT = 200;

export const isSearchId = (id: string) => UUID_RE.test(id);

const dir = (name: string) => path.join(config.dataDir, name);
const searchFile = (id: string) => path.join(dir("searches"), `${id}.json`);
const thumbFile = (id: string) => path.join(dir("images"), `${id}.jpg`);
const usageFile = (day: string) => path.join(dir("usage"), `${day}.json`);
const ownerFile = (ownerId: string) => path.join(dir("owners"), `${ownerId.replace(/[^a-z0-9_-]/gi, "_")}.json`);

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

// Serializes read-modify-write cycles within this process.
const lockHolder = globalThis as { __photolocatorLock?: Promise<unknown> };
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = (lockHolder.__photolocatorLock ?? Promise.resolve()).then(fn, fn);
  lockHolder.__photolocatorLock = run.catch(() => undefined);
  return run;
}

export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

// --- searches ---------------------------------------------------------------

export async function getSearch(id: string): Promise<SearchRecord | null> {
  if (!isSearchId(id)) return null;
  const record = await readJson<SearchRecord>(searchFile(id));
  if (record?.status === "processing" && Date.now() - Date.parse(record.updatedAt) > STALE_AFTER_MS) {
    return { ...record, status: "failed", error: "The analysis was interrupted. Please try again." };
  }
  return record;
}

export async function saveSearch(record: SearchRecord): Promise<void> {
  await writeFileAtomic(searchFile(record.id), JSON.stringify(record));
}

export function updateSearch(id: string, patch: Partial<SearchRecord>): Promise<SearchRecord | null> {
  return withLock(async () => {
    const record = await readJson<SearchRecord>(searchFile(id));
    if (!record) return null;
    const next = { ...record, ...patch, updatedAt: new Date().toISOString() };
    await saveSearch(next);
    return next;
  });
}

export function toPublic(record: SearchRecord): PublicSearch {
  const { ownerId, quotaKey, quotaDay, exif, ...rest } = record;
  return { ...rest, hasExifGps: exif?.lat !== undefined && exif?.lng !== undefined };
}

// --- thumbnails -------------------------------------------------------------

export async function saveThumbnail(id: string, jpeg: Buffer): Promise<void> {
  await writeFileAtomic(thumbFile(id), jpeg);
}

export async function readThumbnail(id: string): Promise<Buffer | null> {
  if (!isSearchId(id)) return null;
  try {
    return await fs.readFile(thumbFile(id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// --- per-user history -------------------------------------------------------

export function addToOwnerIndex(ownerId: string, searchId: string): Promise<void> {
  return withLock(async () => {
    const ids = (await readJson<string[]>(ownerFile(ownerId))) ?? [];
    await writeFileAtomic(ownerFile(ownerId), JSON.stringify([searchId, ...ids].slice(0, OWNER_INDEX_LIMIT)));
  });
}

export async function listOwnerSearches(ownerId: string, limit = 50): Promise<SearchRecord[]> {
  const ids = ((await readJson<string[]>(ownerFile(ownerId))) ?? []).slice(0, limit);
  const records = await Promise.all(ids.map(getSearch));
  return records.filter((r): r is SearchRecord => r !== null);
}

// --- daily quota ------------------------------------------------------------

type UsageFile = Record<string, number>;

export async function getQuota(key: string, limit: number): Promise<QuotaStatus> {
  const used = Math.min((await readJson<UsageFile>(usageFile(utcDay())))?.[key] ?? 0, limit);
  return { limit, used, remaining: Math.max(limit - used, 0) };
}

/** Atomically takes one search from today's allowance, if any is left. */
export function consumeQuota(key: string, limit: number): Promise<{ ok: boolean; day: string; quota: QuotaStatus }> {
  return withLock(async () => {
    const day = utcDay();
    const usage = (await readJson<UsageFile>(usageFile(day))) ?? {};
    const used = usage[key] ?? 0;
    if (used >= limit) return { ok: false, day, quota: { limit, used: limit, remaining: 0 } };
    usage[key] = used + 1;
    await writeFileAtomic(usageFile(day), JSON.stringify(usage));
    return { ok: true, day, quota: { limit, used: used + 1, remaining: limit - used - 1 } };
  });
}

/** Gives a search back, e.g. when the analysis failed on our side. */
export function refundQuota(key: string, day: string): Promise<void> {
  return withLock(async () => {
    const usage = await readJson<UsageFile>(usageFile(day));
    if (!usage?.[key]) return;
    usage[key] -= 1;
    await writeFileAtomic(usageFile(day), JSON.stringify(usage));
  });
}
