import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { z } from "zod";
import { config } from "./config";
import { isValidLatLng } from "./geo";
import { commonsPhotosNear, geocode, mapillaryNear, overpass, reverseGeocode, satelliteSnapshot, type ReferencePhoto } from "./geoservices";
import type { Evidence, LogEvent, SearchStage } from "./types";

// Client-side tools for the deep-search investigator. Each returns the
// tool_result content Claude sees and reports what it did to the live log.

type ToolResultContent = Anthropic.Beta.BetaToolResultBlockParam["content"];

export interface ToolContext {
  /** Near-original resolution photo for zoomed crops. */
  detail: Buffer;
  log(event: Omit<LogEvent, "at">): void;
  stage(stage: SearchStage): void;
  /** Stores an image the investigator looked at so the result page can show it. */
  addEvidence(meta: Omit<Evidence, "n">, jpeg: Buffer): Promise<void>;
}

interface ToolSpec<S extends z.ZodType> {
  description: string;
  schema: S;
  stage: SearchStage;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolResultContent>;
}

const defineTool = <S extends z.ZodType>(spec: ToolSpec<S>) => spec;

const image = (jpeg: Buffer): Anthropic.Beta.BetaImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
});

const lat = z.number().describe("Latitude in decimal degrees.");
const lng = z.number().describe("Longitude in decimal degrees.");
const fixed = (n: number) => n.toFixed(5);

function assertLatLng(latitude: number, longitude: number) {
  if (!isValidLatLng(latitude, longitude)) throw new Error("Coordinates out of range.");
}

async function referenceResult(
  photos: ReferencePhoto[],
  ctx: ToolContext,
  kind: Evidence["kind"],
  keep: number,
): Promise<ToolResultContent> {
  if (!photos.length) return "No photos found there. Try a larger radius or a different spot.";
  const content: Exclude<ToolResultContent, string | undefined> = [];
  for (const [i, p] of photos.entries()) {
    content.push({ type: "text", text: `${i + 1}. ${p.caption} — ${p.distanceM ? `${p.distanceM} m from the point, ` : ""}at ${fixed(p.lat)}, ${fixed(p.lng)}` });
    content.push(image(p.jpeg));
    if (i < keep) await ctx.addEvidence({ kind, caption: p.caption, lat: p.lat, lng: p.lng, credit: p.credit, link: p.link }, p.jpeg);
  }
  return content;
}

const TOOLS = {
  zoom_photo: defineTool({
    description:
      "Crop part of the uploaded photo at full resolution to read small text (signs, shop names, plates, route numbers) or inspect distant details. Coordinates are fractions (0–1) of the photo's width and height, measured from the top-left corner.",
    schema: z.object({
      left: z.number().describe("Left edge, 0–1."),
      top: z.number().describe("Top edge, 0–1."),
      width: z.number().describe("Width, 0–1."),
      height: z.number().describe("Height, 0–1."),
      purpose: z.string().describe("What you're looking for, in a few words (shown to the user)."),
    }),
    stage: "clues",
    async run({ left, top, width, height, purpose }, ctx) {
      const { width: W = 1, height: H = 1 } = await sharp(ctx.detail).metadata();
      const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
      const x = Math.round(clamp(left) * W);
      const y = Math.round(clamp(top) * H);
      const w = Math.max(16, Math.min(Math.round(clamp(width) * W), W - x));
      const h = Math.max(16, Math.min(Math.round(clamp(height) * H), H - y));
      if (x >= W - 1 || y >= H - 1) throw new Error("The crop starts outside the photo.");
      const jpeg = await sharp(ctx.detail)
        .extract({ left: x, top: y, width: Math.min(w, W - x), height: Math.min(h, H - y) })
        .resize(1024, 1024, { fit: "inside", kernel: "lanczos3" })
        .jpeg({ quality: 88 })
        .toBuffer();
      ctx.log({ kind: "tool", label: "Zoomed into the photo", detail: purpose });
      await ctx.addEvidence({ kind: "crop", caption: purpose }, jpeg);
      return [{ type: "text", text: `Crop of ${w}×${h} source pixels:` }, image(jpeg)];
    },
  }),

  geocode: defineTool({
    description:
      "Search OpenStreetMap (Nominatim) for a place, street, business or landmark by name and get coordinates. Use for names you read in the photo or candidate towns. Include the town or region in the query when you know it.",
    schema: z.object({
      query: z.string().describe("Free-text search, e.g. 'Sapphire Street, Rancho Cucamonga'."),
      country_code: z.string().describe("ISO 3166-1 alpha-2 code(s), comma-separated, to restrict results; empty string for worldwide."),
    }),
    stage: "street",
    async run({ query, country_code }, ctx) {
      ctx.log({ kind: "tool", label: `Geocoded “${query}”`, detail: country_code ? `Limited to ${country_code.toUpperCase()}` : undefined });
      return geocode(query, country_code);
    },
  }),

  reverse_geocode: defineTool({
    description: "Get the address, street, town and country at a coordinate from OpenStreetMap.",
    schema: z.object({ latitude: lat, longitude: lng }),
    stage: "street",
    async run({ latitude, longitude }, ctx) {
      assertLatLng(latitude, longitude);
      ctx.log({ kind: "tool", label: "Looked up the address at a point", detail: `${fixed(latitude)}, ${fixed(longitude)}` });
      return reverseGeocode(latitude, longitude);
    },
  }),

  osm_query: defineTool({
    description:
      "Run an Overpass QL query against OpenStreetMap to find features, e.g. every railway crossing next to a church within a town, or a named bus stop. Keep queries bounded (use around: or a bbox) and end with `out center 40;` or similar. Results list type/id, coordinates and key tags.",
    schema: z.object({
      query: z.string().describe("Overpass QL. A [out:json][timeout:25] header is added if missing."),
      purpose: z.string().describe("What the query looks for, in a few words (shown to the user)."),
    }),
    stage: "street",
    async run({ query, purpose }, ctx) {
      ctx.log({ kind: "tool", label: "Searched OpenStreetMap features", detail: purpose });
      return overpass(query);
    },
  }),

  satellite_view: defineTool({
    description:
      "Get a north-up satellite image centred on a coordinate (red crosshair marks it) to compare road layout, building footprints, fields, water and terrain with the photo. Zoom 13 shows ~5 km across, 16 ~600 m, 18 ~150 m.",
    schema: z.object({ latitude: lat, longitude: lng, zoom: z.number().describe("Integer 12–19.") }),
    stage: "verify",
    async run({ latitude, longitude, zoom }, ctx) {
      assertLatLng(latitude, longitude);
      const level = Math.min(Math.max(Math.round(zoom), 12), 19);
      ctx.log({ kind: "tool", label: "Checked satellite imagery", detail: `${fixed(latitude)}, ${fixed(longitude)} · zoom ${level}` });
      const { jpeg, widthMeters } = await satelliteSnapshot(latitude, longitude, level);
      await ctx.addEvidence(
        { kind: "satellite", caption: `Satellite · zoom ${level}`, lat: latitude, lng: longitude, credit: "Esri, Maxar, Earthstar Geographics" },
        jpeg,
      );
      return [{ type: "text", text: `Satellite view, north up, ~${Math.round(widthMeters)} m across.` }, image(jpeg)];
    },
  }),

  reference_photos: defineTool({
    description:
      "Fetch geotagged photos taken near a coordinate (Wikimedia Commons) to compare landmarks, skyline, architecture and scenery with the uploaded photo. Best in towns and at landmarks; sparse in rural areas.",
    schema: z.object({ latitude: lat, longitude: lng, radius_m: z.number().describe("Search radius in metres, 10–10000.") }),
    stage: "verify",
    async run({ latitude, longitude, radius_m }, ctx) {
      assertLatLng(latitude, longitude);
      ctx.log({ kind: "tool", label: "Pulled reference photos nearby", detail: `${fixed(latitude)}, ${fixed(longitude)} · ${Math.round(radius_m)} m` });
      return referenceResult(await commonsPhotosNear(latitude, longitude, radius_m), ctx, "reference", 2);
    },
  }),

  street_level_photos: defineTool({
    description:
      "Fetch street-level imagery (Mapillary) captured near a coordinate to compare the scene at road level: buildings, poles, signage, road markings.",
    schema: z.object({ latitude: lat, longitude: lng, radius_m: z.number().describe("Search radius in metres, 10–500.") }),
    stage: "verify",
    async run({ latitude, longitude, radius_m }, ctx) {
      assertLatLng(latitude, longitude);
      ctx.log({ kind: "tool", label: "Compared street-level imagery", detail: `${fixed(latitude)}, ${fixed(longitude)}` });
      return referenceResult(await mapillaryNear(latitude, longitude, Math.min(Math.max(radius_m, 10), 500)), ctx, "street", 2);
    },
  }),
};

type ToolName = keyof typeof TOOLS;

function enabledTools(): ToolName[] {
  const names = Object.keys(TOOLS) as ToolName[];
  return names.filter((n) => n !== "street_level_photos" || Boolean(config.tools.mapillaryToken));
}

export function jsonSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest as Anthropic.Beta.BetaTool.InputSchema;
}

export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return enabledTools().map((name) => ({ name, description: TOOLS[name].description, input_schema: jsonSchema(TOOLS[name].schema), strict: true }));
}

export function isClientTool(name: string): name is ToolName {
  return enabledTools().includes(name as ToolName);
}

export async function runTool(name: ToolName, input: unknown, ctx: ToolContext): Promise<ToolResultContent> {
  const tool = TOOLS[name] as ToolSpec<z.ZodType>;
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  ctx.stage(tool.stage);
  return tool.run(parsed.data, ctx);
}
