import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "./config";
import { haversineKm, isValidLatLng } from "./geo";
import type { ExifInfo, LocationResult, SearchMode } from "./types";

export class AnalysisError extends Error {}

let client: Anthropic | undefined;

const EFFORT: Record<SearchMode, "low" | "high"> = { quick: "low", deep: "high" };

const Answer = z.object({
  location_name: z
    .string()
    .describe("Most specific place name the evidence supports, e.g. 'Cucamonga Canyon Wash, Rancho Cucamonga, California, USA'."),
  country: z.string(),
  latitude: z.number().describe("Decimal degrees, where the camera most likely was."),
  longitude: z.number().describe("Decimal degrees, where the camera most likely was."),
  confidence: z.enum(["high", "medium", "low"]),
  uncertainty_km: z.number().describe("Radius in km within which the true spot very likely lies."),
  visual_cues: z.array(z.string()).describe("3-8 short phrases, each an observable clue in the photo."),
  reasoning: z.string().describe("One short paragraph (at most ~120 words) tying the cues to the answer."),
  alternatives: z
    .array(z.object({ location_name: z.string(), latitude: z.number(), longitude: z.number() }))
    .describe("Up to 4 other plausible locations, most likely first. Empty if none are credible."),
});

const SYSTEM_PROMPT = `You are an expert photo geolocation analyst, combining the eye of a top GeoGuessr player with OSINT research habits. Given a photo, work out where it was taken as precisely as the evidence allows.

Look at everything the photo offers: terrain and geology, vegetation and climate, sky and sun angle, architecture and building materials, road surfaces and markings, signage, scripts and languages, bollards, utility poles and power lines, vehicles and plates, driving side, businesses, brands and infrastructure style. Form candidate regions, test each against the clues, then narrow down to the most specific spot you can defend.

The coordinates should mark where the camera most likely stood, not the centre of the surrounding city or region. When you can only narrow things to a region, pick its most plausible point and widen uncertainty_km to match.

Calibrate honestly: "high" only when distinctive, mutually consistent evidence pins down a specific place; "medium" when the region is clear but the exact spot is not; "low" for broad guesses. Every photo gets a best guess, even when the evidence is thin.

Use the photo only to locate the place. Do not identify, name or describe any people in it.

If file metadata is provided, treat it as evidence to check against what the photo shows, since metadata can be missing, wrong or edited.`;

function metadataNote(exif?: ExifInfo): string {
  if (!exif) return "The file carried no useful metadata.";
  const lines = ["File metadata:"];
  if (exif.lat !== undefined && exif.lng !== undefined) lines.push(`- GPS: ${exif.lat.toFixed(6)}, ${exif.lng.toFixed(6)}`);
  if (exif.takenAt) lines.push(`- Taken (camera clock, local time): ${exif.takenAt}`);
  if (exif.camera) lines.push(`- Camera: ${exif.camera}`);
  return lines.join("\n");
}

// Server-side refusal fallbacks are available on the Opus 5 / Fable families.
const supportsFallbacks = /^claude-(opus-5|fable-5)/.test(config.model);

export async function analyzePhoto(jpeg: Buffer, mode: SearchMode, exif?: ExifInfo): Promise<LocationResult> {
  let message;
  try {
    client ??= new Anthropic({ maxRetries: 2 });
    const stream = client.beta.messages.stream({
      model: config.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT[mode], format: betaZodOutputFormat(Answer) },
      ...(supportsFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
            { type: "text", text: `Where was this photo taken?\n\n${metadataNote(exif)}` },
          ],
        },
      ],
    });
    message = await stream.finalMessage();
  } catch (err) {
    // APIConnectionError subclasses APIError, so it has to be checked first.
    if (err instanceof Anthropic.APIConnectionError) {
      console.error("Couldn't reach the Claude API:", err.message);
      throw new AnalysisError("Couldn't reach the analysis service. Please try again.");
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error("Claude API credentials rejected:", err.message);
      throw new AnalysisError("The analysis service isn't configured correctly. Please try again later.");
    }
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
      throw new AnalysisError("The analysis service is busy right now. Please try again in a minute.");
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`Claude API error ${err.status}:`, err.message);
      throw new AnalysisError("The analysis failed. Please try again.");
    }
    throw err;
  }

  if (message.stop_reason === "refusal") {
    throw new AnalysisError("This photo can't be analyzed.");
  }
  const answer = message.parsed_output;
  if (message.stop_reason === "max_tokens" || !answer) {
    throw new AnalysisError("The analysis didn't produce a usable answer. Please try again.");
  }
  return toResult(answer, exif);
}

function toResult(answer: z.infer<typeof Answer>, exif?: ExifInfo): LocationResult {
  if (!isValidLatLng(answer.latitude, answer.longitude)) {
    throw new AnalysisError("The analysis returned invalid coordinates. Please try again.");
  }
  const result: LocationResult = {
    name: answer.location_name.trim(),
    country: answer.country.trim(),
    lat: answer.latitude,
    lng: answer.longitude,
    confidence: answer.confidence,
    radiusKm: Math.min(Math.max(answer.uncertainty_km, 0.05), 2500),
    cues: answer.visual_cues.map((c) => c.trim()).filter(Boolean).slice(0, 8),
    reasoning: answer.reasoning.trim(),
    alternatives: answer.alternatives
      .filter((a) => isValidLatLng(a.latitude, a.longitude))
      .slice(0, 4)
      .map((a) => ({ name: a.location_name.trim(), lat: a.latitude, lng: a.longitude })),
    source: "visual",
  };

  // If the file's GPS agrees with the visual read, snap the pin to the exact coordinates.
  if (exif?.lat !== undefined && exif.lng !== undefined) {
    const gps = { lat: exif.lat, lng: exif.lng };
    if (haversineKm(gps, result) <= Math.max(25, result.radiusKm)) {
      return { ...result, ...gps, confidence: "high", radiusKm: Math.min(result.radiusKm, 0.1), source: "exif" };
    }
  }
  return result;
}
