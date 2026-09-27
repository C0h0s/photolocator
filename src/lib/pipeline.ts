import { AnalysisError, investigate } from "./analyze";
import { findRegions } from "./geoclip";
import type { PreparedImage } from "./image";
import { mutateSearch, refundQuota, saveEvidence, type SearchRecord } from "./store";
import type { Evidence, LogEvent, SearchStage } from "./types";

const MAX_EVIDENCE = 16;
const MAX_EVENTS = 120;

/** Runs after the upload response has been sent (see `after()` in the search route). */
export async function runSearch(record: SearchRecord, image: PreparedImage): Promise<void> {
  const id = record.id;
  // Record updates are serialized so log lines and evidence land in order.
  let writes: Promise<unknown> = Promise.resolve();
  const enqueue = (fn: (r: SearchRecord) => SearchRecord) => {
    writes = writes.then(() => mutateSearch(id, fn)).catch((e) => console.error(e));
    return writes;
  };
  const log = (event: Omit<LogEvent, "at">) =>
    enqueue((r) => ({ ...r, events: [...(r.events ?? []), { ...event, at: new Date().toISOString() }].slice(-MAX_EVENTS) }));
  let currentStage: SearchStage = "queued";
  const stage = (next: SearchStage) => {
    if (next === currentStage) return;
    currentStage = next;
    enqueue((r) => ({ ...r, stage: next }));
  };
  let evidenceCount = 0;
  const addEvidence = async (meta: Omit<Evidence, "n">, jpeg: Buffer) => {
    if (evidenceCount >= MAX_EVIDENCE) return;
    const n = evidenceCount++;
    await saveEvidence(id, n, jpeg);
    await enqueue((r) => ({ ...r, evidence: [...(r.evidence ?? []), { ...meta, n }] }));
  };

  try {
    log({ kind: "stage", label: record.exif?.lat !== undefined ? "Found GPS coordinates in the file metadata" : "No GPS metadata in the file" });

    stage("region");
    const started = Date.now();
    const regionModel = await findRegions(image.analysis).catch((err) => {
      console.error("GeoCLIP failed:", err);
      return null;
    });
    if (regionModel) {
      const top = regionModel.regions[0];
      await enqueue((r) => ({ ...r, regionModel }));
      log({
        kind: "stage",
        label: `Region model ranked ${regionModel.regions.length} regions`,
        detail: top ? `Top: ${top.name} (${Math.round(top.share * 100)}%) · ${((Date.now() - started) / 1000).toFixed(1)} s` : undefined,
      });
    } else {
      log({ kind: "warn", label: "Region model unavailable; continuing with visual analysis only" });
    }

    const result = await investigate({
      mode: record.mode,
      analysis: image.analysis,
      detail: image.detail,
      exif: record.exif,
      regionModel,
      log,
      stage,
      addEvidence,
    });
    log({ kind: "stage", label: `Located: ${result.name}`, detail: `${result.confidence} confidence · ±${result.radiusKm < 1 ? `${Math.round(result.radiusKm * 1000)} m` : `${result.radiusKm.toFixed(1)} km`}` });
    await writes;
    await mutateSearch(id, (r) => ({ ...r, status: "complete", stage: "done", result }));
  } catch (err) {
    if (!(err instanceof AnalysisError)) console.error(`Search ${id} failed:`, err);
    const error = err instanceof AnalysisError ? err.message : "Something went wrong while analyzing this photo. Please try again.";
    await writes;
    await mutateSearch(id, (r) => ({ ...r, status: "failed", stage: "done", error })).catch((e) => console.error(e));
    // Failures on our side shouldn't cost the user their search.
    await refundQuota(record.quotaKey, record.quotaDay).catch((e) => console.error(e));
  }
}
