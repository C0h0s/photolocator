"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { tierFor } from "@/lib/format";
import { circleRing, streetViewUrl, zoomForRadius } from "@/lib/geo";
import { MAP_STYLES, SKY, TERRAIN_SOURCE, TERRAIN_SOURCE_ID, type MapStyleId } from "@/lib/mapStyles";
import type { LocationResult, RegionModelOutput } from "@/lib/types";

export interface MapFocus {
  lat: number;
  lng: number;
  zoom: number;
  /** Changes on every request so re-selecting the same spot flies again. */
  nonce: number;
}

export type MapLayout = "home" | "workspace";

interface Props {
  styleId: MapStyleId;
  layout?: MapLayout;
  spinning?: boolean;
  result?: LocationResult;
  regionModel?: RegionModelOutput;
  thumbUrl?: string;
  focus?: MapFocus | null;
  /** 0 = primary answer, n = alternatives[n - 1]. */
  selected?: number;
  onSelect?: (index: number) => void;
}

type MapLibre = typeof import("maplibre-gl");

const UNCERTAINTY = "uncertainty";
const HEAT = "region-heat";
// Copied into /public by scripts/copy-maplibre-worker.mjs (runs before dev and build).
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
const SPIN_DEGREES_PER_SECOND = 6;

export default function MapView({ styleId, layout = "workspace", spinning = false, result, regionModel, thumbUrl, focus, selected = 0, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const styleRef = useRef(styleId);
  const overlaysRef = useRef<{ result?: LocationResult; regionModel?: RegionModelOutput }>({});
  const selectRef = useRef(onSelect);
  const layoutRef = useRef(layout);
  const markersRef = useRef<HTMLElement[]>([]);
  // Layers can only be added once a style has loaded; setStyle() resets this.
  const styleLoadedRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    overlaysRef.current = { result, regionModel };
    selectRef.current = onSelect;
    layoutRef.current = layout;
  });

  // Create the map once. maplibre-gl touches `window`, so it is loaded lazily on the client.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    import("maplibre-gl").then((lib) => {
      if (cancelled || !containerRef.current) return;
      libRef.current = lib;
      lib.setWorkerUrl(WORKER_URL);
      map = new lib.Map({
        container: containerRef.current,
        style: MAP_STYLES[styleRef.current].style,
        center: [-40, 28],
        zoom: layoutRef.current === "home" ? 1.75 : 1.6,
        maxPitch: 75,
        attributionControl: { compact: true },
      });
      const current = map;
      current.on("style.load", () => {
        styleLoadedRef.current = true;
        decorate(current, styleRef.current, overlaysRef.current);
      });
      // Phones: start with the attribution folded behind its (i) button so it doesn't cover the map.
      current.once("load", () => {
        if (window.innerWidth < 900) containerRef.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      });
      mapRef.current = current;
      // Markers and camera moves work before the style arrives (or if a basemap fails to load).
      setReady(true);
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Basemap switcher.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || styleRef.current === styleId) return;
    styleRef.current = styleId;
    styleLoadedRef.current = false;
    map.setStyle(MAP_STYLES[styleId].style, { diff: false });
  }, [ready, styleId]);

  // Idle globe rotation; pauses while the user is handling the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !spinning) return;
    let frame = 0;
    let last = performance.now();
    let pausedUntil = 0;
    const pause = () => (pausedUntil = performance.now() + 4000);
    const events = ["mousedown", "touchstart", "wheel", "dragstart"] as const;
    events.forEach((e) => map.on(e, pause));
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (now > pausedUntil && !map.isMoving()) {
        const c = map.getCenter();
        map.setCenter([c.lng - dt * SPIN_DEGREES_PER_SECOND, c.lat]);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      events.forEach((e) => map.off(e, pause));
    };
  }, [ready, spinning]);

  // Region heatmap from GeoCLIP.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !regionModel || !styleLoadedRef.current) return;
    drawHeat(map, regionModel);
  }, [ready, regionModel]);

  // Result pin, ranked alternatives, uncertainty circle and the fly-in.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib || !result) return;
    // Otherwise decorate() draws it when the pending style finishes loading.
    if (styleLoadedRef.current) drawUncertainty(map, result);
    const primaryEl = pinElement(result, thumbUrl);
    primaryEl.addEventListener("click", () => selectRef.current?.(0));
    const markers: Marker[] = [new lib.Marker({ element: primaryEl, anchor: "bottom", offset: [0, 6] }).setLngLat([result.lng, result.lat]).addTo(map)];
    const elements: HTMLElement[] = [primaryEl];
    result.alternatives.forEach((alt, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `rank-pin rank-pin--${tierFor(alt.likelihood)}`;
      el.textContent = String(i + 2);
      el.title = `${alt.name}${alt.likelihood !== undefined ? ` · ${alt.likelihood}%` : ""}`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        selectRef.current?.(i + 1);
      });
      elements.push(el);
      markers.push(new lib.Marker({ element: el }).setLngLat([alt.lng, alt.lat]).addTo(map));
    });
    markersRef.current = elements;
    // Markers don't reposition when terrain tiles arrive after a camera move, which
    // leaves them floating at sea level. Re-seat them whenever the map settles.
    const reseat = () => markers.forEach((m) => m.setLngLat(m.getLngLat()));
    map.on("idle", reseat);
    const zoom = zoomForRadius(result.radiusKm, result.lat);
    map.flyTo({
      center: [result.lng, result.lat],
      zoom,
      pitch: zoom >= 11 ? 60 : zoom >= 7 ? 45 : 15,
      bearing: -18,
      padding: cameraPadding(layoutRef.current),
      duration: 5500,
      essential: true,
    });
    return () => {
      map.off("idle", reseat);
      markers.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [ready, result, thumbUrl]);

  useEffect(() => {
    markersRef.current.forEach((el, i) => el.classList.toggle("is-selected", i === selected));
  }, [selected, result]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: focus.zoom,
      pitch: focus.zoom >= 11 ? 60 : focus.zoom >= 7 ? 35 : 0,
      padding: cameraPadding(layoutRef.current),
      duration: 3000,
      essential: true,
    });
  }, [ready, focus]);

  return (
    <div className={`map-shell map-shell--${layout}`}>
      <div className="stars" aria-hidden />
      <div ref={containerRef} className="map-canvas" />
    </div>
  );
}

/** Re-applied after every style load: setStyle() resets projection, terrain and our layers. */
function decorate(map: MapLibreMap, styleId: MapStyleId, overlays: { result?: LocationResult; regionModel?: RegionModelOutput }) {
  map.setProjection({ type: "globe" });
  map.setSky(SKY);
  if (MAP_STYLES[styleId].terrain) {
    if (!map.getSource(TERRAIN_SOURCE_ID)) map.addSource(TERRAIN_SOURCE_ID, TERRAIN_SOURCE);
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.25 });
  } else {
    map.setTerrain(null);
  }
  if (overlays.regionModel) drawHeat(map, overlays.regionModel);
  if (overlays.result) drawUncertainty(map, overlays.result);
}

function drawHeat(map: MapLibreMap, regionModel: RegionModelOutput) {
  const data: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: regionModel.heat.map(([lat, lng, w]) => ({ type: "Feature", properties: { w }, geometry: { type: "Point", coordinates: [lng, lat] } })),
  };
  const source = map.getSource<GeoJSONSource>(HEAT);
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(HEAT, { type: "geojson", data });
  map.addLayer({
    id: HEAT,
    type: "heatmap",
    source: HEAT,
    maxzoom: 13,
    paint: {
      "heatmap-weight": ["get", "w"],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1.1, 6, 2, 12, 3],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 9, 3, 18, 6, 30, 10, 45, 13, 60],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 9, 0.7, 13, 0],
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(0,0,0,0)",
        0.12,
        "rgba(123,122,254,0.35)",
        0.35,
        "rgba(24,81,255,0.6)",
        0.65,
        "rgba(31,216,164,0.78)",
        1,
        "rgba(236,255,248,0.95)",
      ],
    },
  });
}

function drawUncertainty(map: MapLibreMap, result: LocationResult) {
  const data: GeoJSON.Feature = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [circleRing(result, result.radiusKm)] },
  };
  const source = map.getSource<GeoJSONSource>(UNCERTAINTY);
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(UNCERTAINTY, { type: "geojson", data });
  map.addLayer({ id: `${UNCERTAINTY}-fill`, type: "fill", source: UNCERTAINTY, paint: { "fill-color": "#1fd8a4", "fill-opacity": 0.1 } });
  map.addLayer({
    id: `${UNCERTAINTY}-line`,
    type: "line",
    source: UNCERTAINTY,
    paint: { "line-color": "#8df8d7", "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.85 },
  });
}

/** Keeps the pin clear of the workspace panels (side rails on desktop, bottom sheet on phones). */
function cameraPadding(layout: MapLayout) {
  const w = window.innerWidth;
  if (layout === "home") return { top: 40, bottom: 40, left: 40, right: 40 };
  if (w < 900) return { top: 110, bottom: 30, left: 20, right: 20 };
  return { top: 90, bottom: 40, left: 360, right: 460 };
}

function pinElement(result: LocationResult, thumbUrl?: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "pin";

  const label = document.createElement("div");
  label.className = "pin__label";
  label.textContent = result.likelihood !== undefined ? `Best match · ${result.likelihood}%` : "Best match";

  const photo = document.createElement("a");
  photo.className = "pin__photo";
  photo.href = streetViewUrl(result);
  photo.target = "_blank";
  photo.rel = "noopener noreferrer";
  photo.title = "Open Google Street View here";
  if (thumbUrl) {
    const img = document.createElement("img");
    img.src = thumbUrl;
    img.alt = "";
    photo.append(img);
  }
  const badge = document.createElement("span");
  badge.className = "pin__badge";
  badge.textContent = "Street view";
  photo.append(badge);

  const stem = document.createElement("div");
  stem.className = "pin__stem";
  const dot = document.createElement("div");
  dot.className = "pin__dot";

  root.append(label, photo, stem, dot);
  return root;
}
