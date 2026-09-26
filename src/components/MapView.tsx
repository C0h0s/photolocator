"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { circleRing, streetViewUrl, zoomForRadius } from "@/lib/geo";
import { MAP_STYLES, SKY, TERRAIN_SOURCE, TERRAIN_SOURCE_ID, type MapStyleId } from "@/lib/mapStyles";
import type { LocationResult } from "@/lib/types";

export interface MapFocus {
  lat: number;
  lng: number;
  zoom: number;
  /** Changes on every request so re-selecting the same spot flies again. */
  nonce: number;
}

interface Props {
  styleId: MapStyleId;
  spinning?: boolean;
  result?: LocationResult;
  thumbUrl?: string;
  focus?: MapFocus | null;
  onSelectAlternative?: (index: number) => void;
}

type MapLibre = typeof import("maplibre-gl");

const UNCERTAINTY = "uncertainty";
// Copied into /public by scripts/copy-maplibre-worker.mjs (runs before dev and build).
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
const SPIN_DEGREES_PER_SECOND = 6;

export default function MapView({ styleId, spinning = false, result, thumbUrl, focus, onSelectAlternative }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const styleRef = useRef(styleId);
  const resultRef = useRef(result);
  const selectRef = useRef(onSelectAlternative);
  // Layers can only be added once a style has loaded; setStyle() resets this.
  const styleLoadedRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    resultRef.current = result;
    selectRef.current = onSelectAlternative;
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
        zoom: 1.6,
        maxPitch: 75,
        attributionControl: { compact: true },
      });
      const current = map;
      current.on("style.load", () => {
        styleLoadedRef.current = true;
        decorate(current, styleRef.current, resultRef.current);
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

  // Result pin, alternatives, uncertainty circle and the fly-in.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib || !result) return;
    // Otherwise decorate() draws it when the pending style finishes loading.
    if (styleLoadedRef.current) drawUncertainty(map, result);
    const pin = new lib.Marker({ element: pinElement(result, thumbUrl), anchor: "bottom", offset: [0, 6] }).setLngLat([result.lng, result.lat]).addTo(map);
    const alternatives = result.alternatives.map((alt, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "alt-pin";
      el.textContent = String(i + 2);
      el.title = alt.name;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        selectRef.current?.(i);
      });
      return new lib.Marker({ element: el }).setLngLat([alt.lng, alt.lat]).addTo(map);
    });
    // Markers don't reposition when terrain tiles arrive after a camera move, which
    // leaves them floating at sea level. Re-seat them whenever the map settles.
    const reseat = () => [pin, ...alternatives].forEach((m) => m.setLngLat(m.getLngLat()));
    map.on("idle", reseat);
    const zoom = zoomForRadius(result.radiusKm, result.lat);
    map.flyTo({
      center: [result.lng, result.lat],
      zoom,
      pitch: zoom >= 11 ? 60 : zoom >= 7 ? 45 : 15,
      bearing: -18,
      padding: cameraPadding(),
      duration: 5500,
      essential: true,
    });
    return () => {
      map.off("idle", reseat);
      pin.remove();
      alternatives.forEach((m) => m.remove());
    };
  }, [ready, result, thumbUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    map.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom, pitch: focus.zoom >= 11 ? 60 : 30, padding: cameraPadding(), duration: 3000, essential: true });
  }, [ready, focus]);

  return (
    <div className="map-shell">
      <div className="stars" aria-hidden />
      <div ref={containerRef} className="map-canvas" />
    </div>
  );
}

/** Re-applied after every style load: setStyle() resets projection, terrain and our layers. */
function decorate(map: MapLibreMap, styleId: MapStyleId, result?: LocationResult) {
  map.setProjection({ type: "globe" });
  map.setSky(SKY);
  if (MAP_STYLES[styleId].terrain) {
    if (!map.getSource(TERRAIN_SOURCE_ID)) map.addSource(TERRAIN_SOURCE_ID, TERRAIN_SOURCE);
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.25 });
  } else {
    map.setTerrain(null);
  }
  if (result) drawUncertainty(map, result);
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
  map.addLayer({ id: `${UNCERTAINTY}-fill`, type: "fill", source: UNCERTAINTY, paint: { "fill-color": "#60a5fa", "fill-opacity": 0.12 } });
  map.addLayer({
    id: `${UNCERTAINTY}-line`,
    type: "line",
    source: UNCERTAINTY,
    paint: { "line-color": "#93c5fd", "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.8 },
  });
}

/** Keeps the pin clear of the result panel (right on desktop, bottom sheet on phones). */
function cameraPadding() {
  if (window.innerWidth < 820) return { top: 110, bottom: Math.round(window.innerHeight * 0.45), left: 24, right: 24 };
  return { top: 120, bottom: 48, left: 48, right: 470 };
}

function pinElement(result: LocationResult, thumbUrl?: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "pin";

  const label = document.createElement("div");
  label.className = "pin__label";
  label.textContent = "Identified location";

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
