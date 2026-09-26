import { AnalysisError, analyzePhoto } from "./analyze";
import { refundQuota, updateSearch, type SearchRecord } from "./store";

/** Runs after the upload response has been sent (see `after()` in the search route). */
export async function runSearch(record: SearchRecord, jpeg: Buffer): Promise<void> {
  try {
    await updateSearch(record.id, { stage: "analyzing" });
    const result = await analyzePhoto(jpeg, record.mode, record.exif);
    await updateSearch(record.id, { status: "complete", stage: "done", result });
  } catch (err) {
    if (!(err instanceof AnalysisError)) console.error(`Search ${record.id} failed:`, err);
    const error = err instanceof AnalysisError ? err.message : "Something went wrong while analyzing this photo. Please try again.";
    await updateSearch(record.id, { status: "failed", stage: "done", error }).catch((e) => console.error(e));
    // Failures on our side shouldn't cost the user their search.
    await refundQuota(record.quotaKey, record.quotaDay).catch((e) => console.error(e));
  }
}
