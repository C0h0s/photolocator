import exifr from "exifr";
import sharp from "sharp";
import type { ExifInfo } from "./types";

export class ImageError extends Error {}

// Claude downsamples anything larger than ~1568px on the long edge anyway.
const ANALYSIS_EDGE = 1568;
const THUMB_EDGE = 640;
// Big enough to read distant signs when the investigator zooms in.
const DETAIL_EDGE = 4096;

export interface PreparedImage {
  /** JPEG sent to the model; never written to disk. */
  analysis: Buffer;
  /** Near-original resolution for zoomed crops; kept in memory only. */
  detail: Buffer;
  /** Metadata-free JPEG kept for the result page and share links. */
  thumbnail: Buffer;
  exif?: ExifInfo;
}

export async function prepareImage(input: Buffer): Promise<PreparedImage> {
  const exif = await readExif(input);
  // .rotate() bakes in the EXIF orientation; sharp drops all metadata on output by default.
  const base = sharp(input, { failOn: "error" }).rotate();
  try {
    const [analysis, thumbnail, detail] = await Promise.all([
      base.clone().resize(ANALYSIS_EDGE, ANALYSIS_EDGE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer(),
      base.clone().resize(THUMB_EDGE, THUMB_EDGE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer(),
      base.clone().resize(DETAIL_EDGE, DETAIL_EDGE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(),
    ]);
    return { analysis, thumbnail, detail, exif };
  } catch {
    throw new ImageError("We couldn't read that image. Try a JPEG, PNG or WebP (HEIC photos need converting first).");
  }
}

async function readExif(input: Buffer): Promise<ExifInfo | undefined> {
  try {
    const data = await exifr.parse(input, { tiff: true, exif: true, gps: true, ifd1: false, xmp: false, icc: false, iptc: false });
    if (!data) return undefined;
    const info: ExifInfo = {};
    const { latitude, longitude } = data;
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0)) {
      info.lat = latitude;
      info.lng = longitude;
    }
    const taken = data.DateTimeOriginal;
    if (taken instanceof Date && !Number.isNaN(taken.getTime())) {
      // EXIF times are camera wall-clock without a zone; exifr parses them as server-local,
      // so read them back with local getters to keep the original wall-clock value.
      const pad = (n: number) => String(n).padStart(2, "0");
      info.takenAt = `${taken.getFullYear()}-${pad(taken.getMonth() + 1)}-${pad(taken.getDate())} ${pad(taken.getHours())}:${pad(taken.getMinutes())}`;
    }
    const camera = [data.Make, data.Model].filter((v) => typeof v === "string" && v.trim()).join(" ").trim();
    if (camera) info.camera = camera;
    return Object.keys(info).length ? info : undefined;
  } catch {
    return undefined;
  }
}
