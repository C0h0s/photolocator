import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { config, osmEnabled } from "@/lib/config";
import { ImageError, prepareImage, type PreparedImage } from "@/lib/image";
import { runSearch } from "@/lib/pipeline";
import { getRequester } from "@/lib/requester";
import { addToOwnerIndex, consumeQuota, refundQuota, saveSearch, saveThumbnail, type SearchRecord } from "@/lib/store";

export const runtime = "nodejs";
// Lets serverless hosts keep the function alive while `after()` runs the analysis.
export const maxDuration = 300;

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

function quotaMessage(limit: number, signedIn: boolean): string {
  const signInHint = !signedIn && osmEnabled();
  if (limit === 0) return signInHint ? "Sign in with OpenStreetMap to start searching." : "Searching is currently disabled.";
  const used = `You've used your ${limit} free search${limit === 1 ? "" : "es"} today.`;
  return signInHint
    ? `${used} Sign in with OpenStreetMap for more, or come back after 00:00 UTC.`
    : `${used} Come back after 00:00 UTC.`;
}

export async function POST(request: Request) {
  const tooLarge = `That photo is too large (${config.maxUploadBytes / 1024 / 1024} MB max).`;
  if (Number(request.headers.get("content-length") ?? 0) > config.maxUploadBytes + 64 * 1024) return fail(tooLarge, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Upload a photo to search.", 400);
  }
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return fail("Upload a photo to search.", 400);
  if (file.size > config.maxUploadBytes) return fail(tooLarge, 413);
  const mode = form.get("mode") === "deep" ? "deep" : "quick";

  const requester = await getRequester();
  // With OSM sign-in configured, deep search (the costly mode) is for signed-in users.
  if (mode === "deep" && !requester.user && osmEnabled()) {
    return fail("Sign in with OpenStreetMap to use Deep search.", 401, { code: "auth" });
  }

  let image: PreparedImage;
  try {
    image = await prepareImage(Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof ImageError) return fail(err.message, 415);
    throw err;
  }

  const { ok, day, quota } = await consumeQuota(requester.quotaKey, requester.limit);
  if (!ok) return fail(quotaMessage(requester.limit, Boolean(requester.user)), 429, { code: "quota", quota });

  const now = new Date().toISOString();
  const record: SearchRecord = {
    id: randomUUID(),
    mode,
    status: "processing",
    stage: "queued",
    createdAt: now,
    updatedAt: now,
    ownerId: requester.user ? `osm:${requester.user.uid}` : undefined,
    quotaKey: requester.quotaKey,
    quotaDay: day,
    exif: image.exif,
  };

  try {
    await saveThumbnail(record.id, image.thumbnail);
    await saveSearch(record);
    if (record.ownerId) await addToOwnerIndex(record.ownerId, record.id);
  } catch (err) {
    await refundQuota(record.quotaKey, day);
    throw err;
  }

  const prepared = image;
  after(() => runSearch(record, prepared));
  return NextResponse.json({ id: record.id, quota }, { status: 201 });
}
