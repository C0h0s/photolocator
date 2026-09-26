import type { Map as MapLibreMap } from "maplibre-gl";

// Every basemap here is free to use without an API key. Swap URLs to use a
// commercial provider (MapTiler, Stadia, Mapbox…) for heavier traffic.

type StyleSpec = Exclude<Parameters<MapLibreMap["setStyle"]>[0], string | null | undefined>;
type SkySpec = Parameters<MapLibreMap["setSky"]>[0];

export type MapStyleId = "dark" | "satellite" | "outdoors" | "streets";

interface MapStyleOption {
  label: string;
  style: string | StyleSpec;
  /** Drape the basemap over 3D terrain. */
  terrain: boolean;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

function rasterStyle(layers: { id: string; tiles: string[]; attribution: string; maxzoom: number; tileSize?: number }[]): StyleSpec {
  return {
    version: 8,
    // Glyphs are required for any symbol layers added later; harmless otherwise.
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: Object.fromEntries(
      layers.map((l) => [l.id, { type: "raster", tiles: l.tiles, tileSize: l.tileSize ?? 256, maxzoom: l.maxzoom, attribution: l.attribution }]),
    ),
    layers: [
      { id: "space", type: "background", paint: { "background-color": "#05070d" } },
      ...layers.map((l) => ({ id: l.id, type: "raster" as const, source: l.id })),
    ],
  };
}

export const MAP_STYLES: Record<MapStyleId, MapStyleOption> = {
  dark: { label: "Dark", style: "https://tiles.openfreemap.org/styles/dark", terrain: false },
  satellite: {
    label: "Satellite",
    terrain: true,
    style: rasterStyle([
      {
        id: "imagery",
        tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
        maxzoom: 19,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      },
      { id: "roads", tiles: [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`], maxzoom: 19, attribution: "© Esri" },
      { id: "places", tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], maxzoom: 19, attribution: "© Esri" },
    ]),
  },
  outdoors: {
    label: "Outdoors",
    terrain: true,
    style: rasterStyle([
      {
        id: "topo",
        tiles: ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
        maxzoom: 17,
        attribution: 'Map: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), data © OpenStreetMap contributors',
      },
    ]),
  },
  streets: { label: "Streets", style: "https://tiles.openfreemap.org/styles/liberty", terrain: false },
};

export const MAP_STYLE_IDS = Object.keys(MAP_STYLES) as MapStyleId[];

export const TERRAIN_SOURCE_ID = "terrain-dem";
export const TERRAIN_SOURCE = {
  type: "raster-dem" as const,
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium" as const,
  tileSize: 256,
  maxzoom: 15,
  attribution: '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain: Mapzen, AWS Open Data</a>',
};

export const SKY: SkySpec = {
  "sky-color": "#0b1226",
  "horizon-color": "#243b63",
  "fog-color": "#0b1226",
  "sky-horizon-blend": 0.5,
  "horizon-fog-blend": 0.6,
  "fog-ground-blend": 0.85,
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0],
};
