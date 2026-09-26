"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import MapView, { type MapFocus } from "@/components/MapView";
import { formatRadius, googleMapsUrl, openStreetMapUrl, zoomForRadius } from "@/lib/geo";
import { MAP_STYLE_IDS, MAP_STYLES, type MapStyleId } from "@/lib/mapStyles";
import type { PublicSearch } from "@/lib/types";

const POLL_MS = 1500;

export default function ResultView({ initial }: { initial: PublicSearch }) {
  const [search, setSearch] = useState(initial);
  const [styleId, setStyleId] = useState<MapStyleId>(initial.status === "complete" ? "satellite" : "dark");
  const userPickedStyle = useRef(false);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [shared, setShared] = useState(false);

  const { id, status, result } = search;
  const thumbUrl = `/api/search/${id}/image`;

  useEffect(() => {
    if (status !== "processing") return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/search/${id}`, { cache: "no-store" });
        if (res.ok && !stopped) setSearch(await res.json());
      } catch {
        // Transient network error; the next tick retries.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id, status]);

  // Reveal results over satellite imagery unless the user already chose a basemap.
  useEffect(() => {
    if (status === "complete" && !userPickedStyle.current) setStyleId("satellite");
  }, [status]);

  function chooseStyle(next: MapStyleId) {
    userPickedStyle.current = true;
    setStyleId(next);
  }

  function flyTo(lat: number, lng: number, radiusKm: number) {
    setFocus({ lat, lng, zoom: zoomForRadius(radiusKm, lat), nonce: Date.now() });
  }

  async function share() {
    const url = window.location.href;
    const title = result ? `${result.name} · PhotoLocator` : "PhotoLocator result";
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelled or unsupported — fall back to copying.
      }
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  }

  return (
    <main className="result">
      <MapView
        styleId={styleId}
        spinning={status !== "complete"}
        result={result}
        thumbUrl={thumbUrl}
        focus={focus}
        onSelectAlternative={(i) => {
          const alt = result?.alternatives[i];
          if (alt) flyTo(alt.lat, alt.lng, Math.max(result.radiusKm, 2));
        }}
      />

      <div className="overlay overlay--left">
        <Link href="/" className="chip chip--back">
          <span aria-hidden>←</span> New search
        </Link>
        <div className="style-chips">
          {MAP_STYLE_IDS.map((sid) => (
            <button key={sid} type="button" className={`chip${sid === styleId ? " chip--active" : ""}`} onClick={() => chooseStyle(sid)}>
              {MAP_STYLES[sid].label}
            </button>
          ))}
          {result && (
            <a className="chip chip--blue" href={googleMapsUrl(result)} target="_blank" rel="noopener noreferrer">
              Google Maps <span aria-hidden>↗</span>
            </a>
          )}
        </div>
      </div>

      <div className="overlay overlay--title">PhotoLocator · Result</div>

      <div className="overlay overlay--right">
        <button type="button" className="chip" onClick={share}>
          <ShareIcon /> {shared ? "Link copied" : "Share result"}
        </button>
      </div>

      <aside className="panel" aria-live="polite">
        <header className="panel__head">
          <span className={`status-dot status-dot--${status}`} aria-hidden />
          <span className="panel__mode">{search.mode === "deep" ? "Deep search" : "Quick find"}</span>
          <span className="panel__sep">·</span>
          <span className={`panel__status panel__status--${status}`}>
            {status === "complete" ? "Complete" : status === "failed" ? "Analysis failed" : "Analyzing"}
          </span>
          <span className="panel__badge">{status === "complete" ? "Completed" : status === "failed" ? "Failed" : <Elapsed since={search.createdAt} />}</span>
        </header>

        <div className="panel__body">
          <img src={thumbUrl} alt="Uploaded photo" className="panel__thumb" />

          {status === "processing" && <Progress stage={search.stage} hasExifGps={search.hasExifGps} />}

          {status === "failed" && <p className="notice notice--error">{search.error ?? "Something went wrong."}</p>}

          {status === "complete" && result && (
            <>
              <section className="card">
                <div className="card__row">
                  <span className="label">Identified location</span>
                  <span className={`confidence confidence--${result.confidence}`}>{result.confidence} confidence</span>
                </div>
                <h1 className="place">{result.name}</h1>
                <div className="coords">
                  <Coord label="Lat" value={result.lat} />
                  <Coord label="Lng" value={result.lng} />
                </div>
                <div className="card__meta">
                  <span>± {formatRadius(result.radiusKm)}</span>
                  {result.source === "exif" && <span className="tag">GPS metadata</span>}
                  <a href={openStreetMapUrl(result)} target="_blank" rel="noopener noreferrer">
                    OpenStreetMap ↗
                  </a>
                </div>
              </section>

              {result.cues.length > 0 && (
                <section>
                  <h2 className="label">
                    Visual evidence — {result.cues.length} cue{result.cues.length === 1 ? "" : "s"}
                  </h2>
                  <ul className="cues">
                    {result.cues.map((cue) => (
                      <li key={cue}>{cue}</li>
                    ))}
                  </ul>
                </section>
              )}

              {result.reasoning && (
                <section>
                  <h2 className="label">Reasoning</h2>
                  <p className="reasoning">{result.reasoning}</p>
                </section>
              )}

              {result.alternatives.length > 0 && (
                <section>
                  <h2 className="label">Other possible results</h2>
                  <ul className="alts">
                    <li>
                      <button type="button" className="alt" onClick={() => flyTo(result.lat, result.lng, result.radiusKm)}>
                        <span className="alt__num alt__num--primary">1</span>
                        <span className="alt__text">
                          <span className="alt__name">{result.name}</span>
                          <span className="alt__coords">Best match</span>
                        </span>
                      </button>
                    </li>
                    {result.alternatives.map((alt, i) => (
                      <li key={`${alt.name}-${i}`}>
                        <button type="button" className="alt" onClick={() => flyTo(alt.lat, alt.lng, Math.max(result.radiusKm, 2))}>
                          <span className="alt__num">{i + 2}</span>
                          <span className="alt__text">
                            <span className="alt__name">{alt.name}</span>
                            <span className="alt__coords">
                              {alt.lat.toFixed(4)}°, {alt.lng.toFixed(4)}°
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="panel__foot">Search ID · {id}</footer>
      </aside>
    </main>
  );
}

function Coord({ label, value }: { label: string; value: number }) {
  const [copied, setCopied] = useState(false);
  const text = `${value.toFixed(5)}°`;
  return (
    <button
      type="button"
      className="coord"
      title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(value.toFixed(6)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      <span className="coord__label">{copied ? "Copied" : label}</span>
      <span className="coord__value">{text}</span>
    </button>
  );
}

function Progress({ stage, hasExifGps }: { stage: PublicSearch["stage"]; hasExifGps: boolean }) {
  const steps = [
    { label: "Photo received", done: true },
    { label: hasExifGps ? "GPS metadata found" : "Checked file metadata", done: true },
    { label: "Reading visual clues", done: false, active: stage === "analyzing" },
    { label: "Pinpointing the location", done: false },
  ];
  return (
    <ol className="steps">
      {steps.map((s) => (
        <li key={s.label} className={s.done ? "steps__done" : s.active ? "steps__active" : ""}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <>…</>;
  return <>{Math.max(0, Math.round((now - Date.parse(since)) / 1000))}s</>;
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}
