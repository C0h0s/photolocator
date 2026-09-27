import { promises as fs } from "node:fs";
import path from "node:path";
import type { InferenceSession } from "onnxruntime-node";
import sharp from "sharp";
import { config } from "./config";
import { clusterPredictions, type WeightedPoint } from "./geo";
import { describePlace } from "./gazetteer";
import type { RegionModelOutput } from "./types";

// GeoCLIP (Vivanco Cepeda et al., NeurIPS 2023, MIT license) run locally with
// onnxruntime. The image encoder (CLIP ViT-L/14 + projection) embeds the photo;
// a location encoder has embedded a gallery of 100K GPS points once. Softmax
// over their scaled cosine similarity gives a probability for each point.
// Model files come from `npm run models:download` (Xenova/geoclip-large-patch14).

export const GEOCLIP_NAME = "GeoCLIP ViT-L/14";
const LOGIT_SCALE = Math.exp(3.681034803390503);
const SIZE = 224;
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];
const HEAT_POINTS = 400;

interface Model {
  vision: InferenceSession;
  gps: Float32Array;
  embeds: Float32Array;
  dim: number;
}

const holder = globalThis as { __photolocatorGeoclip?: Promise<Model | null> };
const dir = () => path.join(config.modelsDir, "geoclip");

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  return v.map((x) => x / n);
}

async function loadModel(): Promise<Model | null> {
  const visionFile = path.join(dir(), "onnx", config.geoclip.precision === "fp32" ? "vision_model.onnx" : "vision_model_quantized.onnx");
  const locationFile = path.join(dir(), "onnx", "location_model.onnx");
  const galleryFile = path.join(dir(), "gps_gallery", "coordinates_100K.bin");
  for (const file of [visionFile, locationFile, galleryFile]) {
    if (!(await exists(file))) {
      console.warn(`GeoCLIP disabled: ${path.relative(process.cwd(), file)} is missing. Run \`npm run models:download\`.`);
      return null;
    }
  }

  const ort = await import("onnxruntime-node");
  const started = Date.now();
  const vision = await ort.InferenceSession.create(visionFile);
  const raw = await fs.readFile(galleryFile);
  const gps = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const count = gps.length / 2;

  // Gallery embeddings never change for a given model, so compute them once and cache.
  const cacheFile = path.join(dir(), "gallery_embeddings.f32");
  let embeds: Float32Array;
  let dim = 512;
  const cached = await fs.readFile(cacheFile).catch(() => null);
  if (cached && cached.byteLength === count * dim * 4) {
    embeds = new Float32Array(cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength));
  } else {
    const location = await ort.InferenceSession.create(locationFile);
    const batch = 4096;
    embeds = new Float32Array(0);
    for (let i = 0; i < count; i += batch) {
      const n = Math.min(batch, count - i);
      const out = await location.run({
        [location.inputNames[0]]: new ort.Tensor("float32", gps.slice(i * 2, (i + n) * 2), [n, 2]),
      });
      const tensor = out[location.outputNames[0]];
      if (i === 0) {
        dim = tensor.dims[1] as number;
        embeds = new Float32Array(count * dim);
      }
      const data = tensor.data as Float32Array;
      for (let j = 0; j < n; j++) embeds.set(normalize(data.subarray(j * dim, (j + 1) * dim)), (i + j) * dim);
    }
    await location.release();
    await fs.writeFile(`${cacheFile}.tmp`, Buffer.from(embeds.buffer));
    await fs.rename(`${cacheFile}.tmp`, cacheFile);
  }
  console.log(`GeoCLIP ready in ${Date.now() - started} ms (${count.toLocaleString()} gallery points).`);
  return { vision, gps, embeds, dim };
}

/** Loads the model once per process; resolves to null when it's unavailable or disabled. */
export function getGeoclip(): Promise<Model | null> {
  if (!config.geoclip.enabled) return Promise.resolve(null);
  holder.__photolocatorGeoclip ??= loadModel().catch((err) => {
    console.error("GeoCLIP failed to load:", err);
    return null;
  });
  return holder.__photolocatorGeoclip;
}

/** CLIP preprocessing for one square view: bicubic resize + crop to 224, normalize, CHW. */
async function toPixels(image: Buffer, position: string): Promise<Float32Array> {
  const { data } = await sharp(image)
    .removeAlpha()
    .resize(SIZE, SIZE, { fit: "cover", position, kernel: "cubic" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plane = SIZE * SIZE;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

/**
 * Probability for every gallery point, averaged over up to three square views
 * so wide or tall photos aren't judged by their middle alone.
 */
async function predict(model: Model, image: Buffer): Promise<Float64Array> {
  const ort = await import("onnxruntime-node");
  const { width = 1, height = 1 } = await sharp(image).metadata();
  const aspect = width / height;
  const positions = aspect > 1.3 ? ["left", "centre", "right"] : aspect < 0.77 ? ["top", "centre", "bottom"] : ["centre"];

  const count = model.gps.length / 2;
  const probs = new Float64Array(count);
  const logits = new Float64Array(count);
  for (const position of positions) {
    const pixels = await toPixels(image, position);
    const out = await model.vision.run({ [model.vision.inputNames[0]]: new ort.Tensor("float32", pixels, [1, 3, SIZE, SIZE]) });
    const img = normalize(out[model.vision.outputNames[0]].data as Float32Array);
    let max = -Infinity;
    for (let i = 0; i < count; i++) {
      let dot = 0;
      const offset = i * model.dim;
      for (let k = 0; k < model.dim; k++) dot += img[k] * model.embeds[offset + k];
      logits[i] = LOGIT_SCALE * dot;
      if (logits[i] > max) max = logits[i];
    }
    let sum = 0;
    for (let i = 0; i < count; i++) {
      logits[i] = Math.exp(logits[i] - max);
      sum += logits[i];
    }
    for (let i = 0; i < count; i++) probs[i] += logits[i] / sum / positions.length;
  }
  return probs;
}

function topPoints(model: Model, probs: Float64Array, k: number): WeightedPoint[] {
  const idx = Array.from({ length: probs.length }, (_, i) => i);
  idx.sort((a, b) => probs[b] - probs[a]);
  return idx.slice(0, k).map((i) => ({ lat: model.gps[i * 2], lng: model.gps[i * 2 + 1], p: probs[i] }));
}

/** Ranked regions and heatmap points for a photo, or null when GeoCLIP isn't available. */
export async function findRegions(image: Buffer): Promise<RegionModelOutput | null> {
  const model = await getGeoclip();
  if (!model) return null;
  const points = topPoints(model, await predict(model, image), HEAT_POINTS);
  const clusters = clusterPredictions(points, 150, 6);
  const regions = await Promise.all(
    clusters.map(async (c) => {
      const place = await describePlace(c.lat, c.lng);
      return {
        name: place?.label ?? `${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}`,
        lat: c.lat,
        lng: c.lng,
        share: c.weight,
      };
    }),
  );
  const top = points[0]?.p || 1;
  return {
    model: GEOCLIP_NAME,
    regions,
    heat: points.map((p) => [Number(p.lat.toFixed(4)), Number(p.lng.toFixed(4)), Number((p.p / top).toFixed(4))]),
  };
}
