import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "./config";
import { haversineKm, isValidLatLng } from "./geo";
import { isClientTool, jsonSchema, runTool, toolDefinitions, type ToolContext } from "./tools";
import type { ExifInfo, LocationResult, RegionModelOutput, SearchMode } from "./types";

export class AnalysisError extends Error {}

let client: Anthropic | undefined;

const EFFORT: Record<SearchMode, "medium" | "high"> = { quick: "medium", deep: "high" };
const DEEP_MAX_TURNS = 18;
const DEEP_TOOL_BUDGET = 24;

const Answer = z.object({
  location_name: z
    .string()
    .describe("Most specific place name the evidence supports, e.g. 'Cucamonga Canyon Wash, Rancho Cucamonga, California, USA'."),
  country: z.string(),
  latitude: z.number().describe("Decimal degrees, where the camera most likely was."),
  longitude: z.number().describe("Decimal degrees, where the camera most likely was."),
  confidence: z.enum(["high", "medium", "low"]),
  likelihood: z.number().describe("0–100: how likely this answer is right, within uncertainty_km."),
  uncertainty_km: z.number().describe("Radius in km within which the true spot very likely lies."),
  visual_cues: z.array(z.string()).describe("3–8 short phrases, each an observable clue in the photo."),
  reasoning: z.string().describe("One short paragraph (at most ~120 words) tying the cues to the answer."),
  verification: z.string().describe("What you cross-checked and how it matched (satellite, reference photos, OSM, web). Empty if nothing was verified."),
  alternatives: z
    .array(z.object({ location_name: z.string(), latitude: z.number(), longitude: z.number(), likelihood: z.number().describe("0–100.") }))
    .describe("Up to 4 other plausible locations, most likely first. Empty if none are credible."),
});
type AnswerT = z.infer<typeof Answer>;

const SYSTEM_BASE = `You are PhotoLocator's geolocation analyst: the eye of a top GeoGuessr player with the methods of an OSINT investigator. Work out where a photo was taken as precisely as the evidence supports.

Weigh everything the photo offers: terrain and geology, vegetation and climate, sky and sun angle, architecture and building materials, road surfaces and markings, signage, scripts and languages, bollards, utility poles and power lines, vehicles and plates, driving side, businesses, brands and infrastructure style.

You'll also get the output of a region model (GeoCLIP), which compares the photo's look against 100,000 geotagged places. It is good at the broad region and at landscapes, can't read text, and leans toward well-photographed places. Treat it as a prior: confirm it or overrule it, and say which in your reasoning.

Coordinates mark where the camera most likely stood, not the centre of the surrounding city. When you can only narrow things to a region, pick its most plausible point and widen uncertainty_km to match.

Calibrate honestly: "high" only when distinctive, mutually consistent evidence pins down a specific place; "medium" when the region is clear but the exact spot is not; "low" for broad guesses. The likelihoods of the answer and its alternatives should add up to at most 100. Every photo gets a best guess, even when the evidence is thin.

Locate places only. Never identify, name or describe people. If the photo shows a private home (its interior, front door or yard), stop at street or neighbourhood level rather than pinning a specific address.

If file metadata is provided, treat it as evidence to check against the photo, since metadata can be missing, wrong or edited.`;

const SYSTEM_DEEP = `${SYSTEM_BASE}

You have tools. Work the way a professional geolocator does:
1. Clues: study the photo and zoom into signs, text, plates, shopfronts and distant landmarks.
2. Region: combine the clues with the region model's prior to settle the country and region.
3. Street: turn names you can read into coordinates (geocode, web search) and use OpenStreetMap queries to find where the distinctive combination of features actually exists.
4. Verify: look at satellite imagery and nearby reference photos at your candidate and compare them with the photo: road layout, building footprints, terrain, vegetation, skyline. Move or downgrade the pin when they don't match.

Run independent tool calls in parallel. You have roughly ${DEEP_TOOL_BUDGET} tool calls; stop searching once more work won't change the answer. Finish by calling submit_answer, and say in "verification" what you checked and how it matched.`;

function metadataNote(exif?: ExifInfo): string {
  if (!exif) return "File metadata: none useful.";
  const lines = ["File metadata:"];
  if (exif.lat !== undefined && exif.lng !== undefined) lines.push(`- GPS: ${exif.lat.toFixed(6)}, ${exif.lng.toFixed(6)}`);
  if (exif.takenAt) lines.push(`- Taken (camera clock, local time): ${exif.takenAt}`);
  if (exif.camera) lines.push(`- Camera: ${exif.camera}`);
  return lines.join("\n");
}

function regionNote(regionModel?: RegionModelOutput | null): string {
  if (!regionModel?.regions.length) return "Region model: unavailable for this search.";
  const lines = regionModel.regions.map(
    (r, i) => `${i + 1}. ${r.name}: ${(r.share * 100).toFixed(1)}% (centred near ${r.lat.toFixed(3)}, ${r.lng.toFixed(3)})`,
  );
  return `Region model (${regionModel.model}), share of its probability mass:\n${lines.join("\n")}`;
}

// Server-side refusal fallbacks are available on the Opus 5 / Fable families.
const supportsFallbacks = /^claude-(opus-5|fable-5)/.test(config.model);
const fallbackParams = supportsFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};

function toAnalysisError(err: unknown): never {
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

export interface InvestigationInput extends ToolContext {
  mode: SearchMode;
  /** ≤1568 px JPEG given to the model up front. */
  analysis: Buffer;
  exif?: ExifInfo;
  regionModel?: RegionModelOutput | null;
}

export async function investigate(input: InvestigationInput): Promise<LocationResult> {
  client ??= new Anthropic({ maxRetries: 2 });
  const opening: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.analysis.toString("base64") } },
    { type: "text", text: `Where was this photo taken?\n\n${metadataNote(input.exif)}\n\n${regionNote(input.regionModel)}` },
  ];
  const answer = input.mode === "deep" ? await deepSearch(client, opening, input) : await quickFind(client, opening, input);
  return toResult(answer, input.exif);
}

/** One structured call: the photo plus the region model's priors. */
async function quickFind(client: Anthropic, opening: Anthropic.Beta.BetaContentBlockParam[], input: InvestigationInput): Promise<AnswerT> {
  input.stage("clues");
  input.log({ kind: "stage", label: "Reading visual clues" });
  let message;
  try {
    message = await client.beta.messages
      .stream({
        model: config.model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT.quick, format: betaZodOutputFormat(Answer) },
        ...fallbackParams,
        system: SYSTEM_BASE,
        messages: [{ role: "user", content: opening }],
      })
      .finalMessage();
  } catch (err) {
    toAnalysisError(err);
  }
  if (message.stop_reason === "refusal") throw new AnalysisError("This photo can't be analyzed.");
  if (message.stop_reason === "max_tokens" || !message.parsed_output) {
    throw new AnalysisError("The analysis didn't produce a usable answer. Please try again.");
  }
  return message.parsed_output;
}

const firstSentence = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  const cut = clean.search(/(?<=[.!?])\s/);
  return (cut > 40 ? clean.slice(0, cut) : clean).slice(0, 220);
};

/** Tool-using investigation loop that ends when Claude calls submit_answer. */
async function deepSearch(client: Anthropic, opening: Anthropic.Beta.BetaContentBlockParam[], input: InvestigationInput): Promise<AnswerT> {
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    ...toolDefinitions(),
    ...(config.tools.webSearch ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 6 }] : []),
    {
      name: "submit_answer",
      description: "Submit your final answer. Call this exactly once, when you're done investigating.",
      input_schema: jsonSchema(Answer),
      strict: true,
    },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opening }];
  let toolCalls = 0;
  let nudged = false;
  input.stage("clues");
  input.log({ kind: "stage", label: "Investigation started" });

  for (let turn = 0; turn < DEEP_MAX_TURNS; turn++) {
    let response;
    try {
      response = await client.beta.messages.create({
        model: config.model,
        max_tokens: 16000,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: EFFORT.deep },
        ...fallbackParams,
        // Caches the growing conversation prefix (photo + earlier tool results) between turns.
        cache_control: { type: "ephemeral" },
        system: SYSTEM_DEEP,
        tools,
        messages,
      });
    } catch (err) {
      toAnalysisError(err);
    }
    messages.push({ role: "assistant", content: response.content });

    for (const block of response.content) {
      if (block.type === "thinking" && block.thinking.trim()) input.log({ kind: "thought", label: firstSentence(block.thinking) });
      if (block.type === "server_tool_use" && block.name === "web_search") {
        const query = (block.input as { query?: string })?.query;
        input.stage("street");
        input.log({ kind: "tool", label: "Searched the web", detail: query ? `“${query}”` : undefined });
      }
    }

    if (response.stop_reason === "refusal") throw new AnalysisError("This photo can't be analyzed.");
    if (response.stop_reason === "max_tokens") throw new AnalysisError("The investigation ran too long. Please try again.");
    // A server tool (web search) hit its iteration limit; re-sending resumes it.
    if (response.stop_reason === "pause_turn") continue;

    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const submit = uses.find((u) => u.name === "submit_answer");
    if (submit) {
      const parsed = Answer.safeParse(submit.input);
      if (parsed.success) {
        input.stage("done");
        return parsed.data;
      }
    }
    if (!uses.length) {
      if (nudged) throw new AnalysisError("The investigation ended without an answer. Please try again.");
      nudged = true;
      messages.push({ role: "user", content: "Please call submit_answer now with your best answer." });
      continue;
    }

    const results = await Promise.all(
      uses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        if (use.name === "submit_answer") {
          return { type: "tool_result", tool_use_id: use.id, is_error: true, content: "The answer didn't match the schema. Fix it and call submit_answer again." };
        }
        if (toolCalls >= DEEP_TOOL_BUDGET + 4 || !isClientTool(use.name)) {
          return { type: "tool_result", tool_use_id: use.id, is_error: true, content: isClientTool(use.name) ? "Tool budget exhausted." : `Unknown tool ${use.name}.` };
        }
        try {
          return { type: "tool_result", tool_use_id: use.id, content: await runTool(use.name, use.input, input) };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          input.log({ kind: "warn", label: `${use.name.replace(/_/g, " ")} failed`, detail: message });
          return { type: "tool_result", tool_use_id: use.id, is_error: true, content: message };
        }
      }),
    );
    toolCalls += uses.length;

    const remaining = DEEP_TOOL_BUDGET - toolCalls;
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...results];
    if (remaining <= 4 || turn >= DEEP_MAX_TURNS - 3) {
      content.push({
        type: "text",
        text: remaining <= 0 || turn >= DEEP_MAX_TURNS - 2 ? "Budget used up: call submit_answer now." : `About ${remaining} tool calls left; start wrapping up.`,
      });
    }
    messages.push({ role: "user", content });
  }
  throw new AnalysisError("The investigation ran out of steps. Please try again.");
}

function toResult(answer: AnswerT, exif?: ExifInfo): LocationResult {
  if (!isValidLatLng(answer.latitude, answer.longitude)) {
    throw new AnalysisError("The analysis returned invalid coordinates. Please try again.");
  }
  const pct = (n: number) => Math.round(Math.min(Math.max(n, 0), 100));
  const result: LocationResult = {
    name: answer.location_name.trim(),
    country: answer.country.trim(),
    lat: answer.latitude,
    lng: answer.longitude,
    confidence: answer.confidence,
    likelihood: pct(answer.likelihood),
    radiusKm: Math.min(Math.max(answer.uncertainty_km, 0.02), 2500),
    cues: answer.visual_cues.map((c) => c.trim()).filter(Boolean).slice(0, 8),
    reasoning: answer.reasoning.trim(),
    verification: answer.verification.trim() || undefined,
    alternatives: answer.alternatives
      .filter((a) => isValidLatLng(a.latitude, a.longitude))
      .slice(0, 4)
      .map((a) => ({ name: a.location_name.trim(), lat: a.latitude, lng: a.longitude, likelihood: pct(a.likelihood) })),
    source: "visual",
  };

  // If the file's GPS agrees with the visual read, snap the pin to the exact coordinates.
  if (exif?.lat !== undefined && exif.lng !== undefined) {
    const gps = { lat: exif.lat, lng: exif.lng };
    if (haversineKm(gps, result) <= Math.max(25, result.radiusKm)) {
      return { ...result, ...gps, confidence: "high", likelihood: Math.max(result.likelihood ?? 0, 90), radiusKm: Math.min(result.radiusKm, 0.1), source: "exif" };
    }
  }
  return result;
}
