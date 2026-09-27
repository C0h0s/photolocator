// Downloads the open models and data PhotoLocator runs locally:
//   • GeoCLIP (MIT) — ONNX export by Xenova of VicenteVivan/geo-clip (NeurIPS 2023)
//   • GeoNames cities5000 (CC BY 4.0) — offline gazetteer used to name regions
//
// Usage: npm run models:download [-- --fp32] [-- --force]
// Files land in $MODELS_DIR (default ./models).
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { inflateRawSync } from "node:zlib";

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const modelsDir = path.resolve(process.env.MODELS_DIR ?? "models");
const HF = "https://huggingface.co/Xenova/geoclip-large-patch14/resolve/main";
const GEONAMES = "https://download.geonames.org/export/dump";

const geoclipFiles = [
  args.has("--fp32") ? "onnx/vision_model.onnx" : "onnx/vision_model_quantized.onnx",
  "onnx/location_model.onnx",
  "gps_gallery/coordinates_100K.bin",
];

async function download(url, dest) {
  if (!force && existsSync(dest) && statSync(dest).size > 0) {
    console.log(`✓ ${path.relative(process.cwd(), dest)} (cached)`);
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`${url} → HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  let lastPrint = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    if (total && Date.now() - lastPrint > 1000) {
      lastPrint = Date.now();
      process.stdout.write(`  ${path.basename(dest)} ${((received / total) * 100).toFixed(0)}% of ${(total / 1e6).toFixed(0)} MB\r`);
    }
  });
  await pipeline(body, createWriteStream(`${dest}.part`));
  renameSync(`${dest}.part`, dest);
  console.log(`✓ ${path.relative(process.cwd(), dest)} (${(received / 1e6).toFixed(1)} MB)`);
}

/** Extracts one entry from a zip archive using its central directory. */
function unzipEntry(zip, name) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip archive");
  let p = zip.readUInt32LE(eocd + 16);
  const count = zip.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const offset = zip.readUInt32LE(p + 42);
    const entry = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (entry === name) {
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in archive`);
}

async function buildGazetteer() {
  const dir = path.join(modelsDir, "geonames");
  const out = path.join(dir, "places.json");
  if (!force && existsSync(out)) {
    console.log(`✓ ${path.relative(process.cwd(), out)} (cached)`);
    return;
  }
  await download(`${GEONAMES}/cities5000.zip`, path.join(dir, "cities5000.zip"));
  await download(`${GEONAMES}/admin1CodesASCII.txt`, path.join(dir, "admin1CodesASCII.txt"));
  await download(`${GEONAMES}/countryInfo.txt`, path.join(dir, "countryInfo.txt"));

  const admin1 = {};
  for (const line of readFileSync(path.join(dir, "admin1CodesASCII.txt"), "utf8").split("\n")) {
    const [code, name] = line.split("\t");
    if (code && name) admin1[code] = name;
  }
  const countries = {};
  for (const line of readFileSync(path.join(dir, "countryInfo.txt"), "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    countries[cols[0]] = cols[4];
  }
  const rows = [];
  const cities = unzipEntry(readFileSync(path.join(dir, "cities5000.zip")), "cities5000.txt").toString("utf8");
  for (const line of cities.split("\n")) {
    const c = line.split("\t");
    if (c.length < 15) continue;
    // [lat, lng, name, countryCode, admin1Code, population]
    rows.push([Number(Number(c[4]).toFixed(4)), Number(Number(c[5]).toFixed(4)), c[1], c[8], c[10], Number(c[14]) || 0]);
  }
  writeFileSync(out, JSON.stringify({ source: "GeoNames cities5000 (CC BY 4.0)", admin1, countries, rows }));
  console.log(`✓ ${path.relative(process.cwd(), out)} (${rows.length.toLocaleString()} places)`);
}

console.log(`Downloading models into ${modelsDir}`);
for (const file of geoclipFiles) await download(`${HF}/${file}`, path.join(modelsDir, "geoclip", file));
await buildGazetteer();
console.log("Done. GeoCLIP builds its gallery embedding cache on first use (~15 s).");
