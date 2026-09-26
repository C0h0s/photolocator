// maplibre-gl 6 loads its web worker from a file next to the library module.
// Bundlers move the library, so serve the worker (and the chunk it imports) from
// /public and point maplibre at it with setWorkerUrl(). Runs before dev/build so
// the copies always match the installed version.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const dist = path.dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json"));
const target = path.join(process.cwd(), "public", "maplibre");
mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, "dist", file), path.join(target, file));
}
console.log("Copied maplibre-gl worker to public/maplibre/");
