"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Icon from "@/components/icons";
import MapView, { type MapFocus } from "@/components/MapView";
import { confidenceTier, elapsed, eventIcon, stageIndex, STEPS, tierFor } from "@/lib/format";
import { formatRadius, googleMapsUrl, openStreetMapUrl, streetViewUrl, zoomForRadius } from "@/lib/geo";
import { MAP_STYLE_IDS, MAP_STYLES, type MapStyleId } from "@/lib/mapStyles";
import type { Candidate, Evidence, LogEvent, PublicSearch, SearchStage } from "@/lib/types";

const POLL_MS = 1500;

type StepState = "done" | "active" | "pending" | "skipped";

export default function ResultView({ initial }: { initial: PublicSearch }) {
  const [search, setSearch] = useState(initial);
  const [styleId, setStyleId] = useState<MapStyleId>(initial.status === "complete" ? "satellite" : "dark");
  const userPickedStyle = useRef(false);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [selected, setSelected] = useState(0);
  const [lightbox, setLightbox] = useState<{ src: string; caption: string } | null>(null);
  const [shared, setShared] = useState(false);
  const flewToRegion = useRef(false);

  const { id, status, result, regionModel } = search;
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

  // "Find region": as soon as GeoCLIP answers, swing the globe to its top region.
  useEffect(() => {
    const top = regionModel?.regions[0];
    if (!top || result || flewToRegion.current) return;
    flewToRegion.current = true;
    setFocus({ lat: top.lat, lng: top.lng, zoom: 4.2, nonce: Date.now() });
  }, [regionModel, result]);

  // Reveal results over satellite imagery unless the user already chose a basemap.
  useEffect(() => {
    if (status === "complete" && !userPickedStyle.current) setStyleId("satellite");
  }, [status]);

  const ranked: Candidate[] = useMemo(
    () => (result ? [{ name: result.name, lat: result.lat, lng: result.lng, likelihood: result.likelihood }, ...result.alternatives] : []),
    [result],
  );

  function select(index: number) {
    const c = ranked[index];
    if (!c || !result) return;
    setSelected(index);
    setFocus({ lat: c.lat, lng: c.lng, zoom: zoomForRadius(index === 0 ? result.radiusKm : Math.max(result.radiusKm, 2), c.lat), nonce: Date.now() });
  }

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: result ? `${result.name} · PhotoLocator` : "PhotoLocator case", url });
        return;
      } catch {
        // Cancelled or unsupported — fall back to copying.
      }
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  }

  const steps = stepStates(search);
  const statusLabel = status === "complete" ? "Complete" : status === "failed" ? "Failed" : "Investigating";

  return (
    <main className="workspace">
      <MapView
        styleId={styleId}
        spinning={status === "processing" && !regionModel}
        result={result}
        regionModel={regionModel}
        thumbUrl={thumbUrl}
        focus={focus}
        selected={selected}
        onSelect={select}
      />

      <header className="ws-bar">
        <div className="ws-bar__left">
          <Link href="/" className="btn btn--ghost" aria-label="New search">
            <Icon.ArrowLeft /> <span className="btn__text">New search</span>
          </Link>
          <span className="ws-case mono">
            Case <span className="ws-case__id">{id.slice(0, 8)}</span>
          </span>
        </div>
        <div className="ws-bar__right">
          <div className="seg" role="group" aria-label="Basemap">
            {MAP_STYLE_IDS.map((sid) => (
              <button
                key={sid}
                type="button"
                className={`seg__btn${sid === styleId ? " is-on" : ""}`}
                onClick={() => {
                  userPickedStyle.current = true;
                  setStyleId(sid);
                }}
              >
                {MAP_STYLES[sid].label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--ghost" onClick={share} aria-label="Share">
            <Icon.Share /> <span className="btn__text">{shared ? "Link copied" : "Share"}</span>
          </button>
          {result && (
            <button type="button" className="btn btn--ghost" onClick={() => downloadReport(search)} aria-label="Download report">
              <Icon.Download /> <span className="btn__text">Report</span>
            </button>
          )}
        </div>
      </header>

      <aside className="rail glass">
        <button type="button" className="source" onClick={() => setLightbox({ src: thumbUrl, caption: "Uploaded photo" })}>
          <img src={thumbUrl} alt="Uploaded photo" />
          <span className="source__meta mono">
            <span className="chip chip--iris">{search.mode === "deep" ? "Deep search" : "Quick find"}</span>
            {search.hasExifGps && <span className="chip chip--jade">GPS in file</span>}
          </span>
        </button>

        <section className="rail__section">
          <h2 className="label">Pipeline</h2>
          <ol className="stepper">
            {STEPS.map((s, i) => (
              <li key={s.stage} className={`stepper__item is-${steps[s.stage]}`}>
                <span className="stepper__dot">{steps[s.stage] === "done" ? <Icon.Check size={11} /> : String(i + 1).padStart(2, "0")}</span>
                <span className="stepper__text">
                  <span className="stepper__label">{s.label}</span>
                  <span className="stepper__hint">{steps[s.stage] === "skipped" ? skippedHint(search, s.stage) : s.hint}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="rail__section rail__section--grow">
          <h2 className="label">
            Investigation log <span className="label__aside">{status === "processing" ? <Elapsed since={search.createdAt} /> : elapsed(search.createdAt, search.updatedAt)}</span>
          </h2>
          <LogFeed events={search.events ?? []} start={search.createdAt} live={status === "processing"} />
        </section>
      </aside>

      <aside className="panel glass" aria-live="polite">
        <header className="panel__head mono">
          <span className={`lamp lamp--${status}`} aria-hidden />
          {search.mode === "deep" ? "Deep search" : "Quick find"}
          <span className="panel__sep">/</span>
          <span className={`panel__status panel__status--${status}`}>{statusLabel}</span>
        </header>

        <div className="panel__body">
          {status === "failed" && <p className="notice notice--error">{search.error ?? "Something went wrong."}</p>}

          {status === "processing" && (
            <section className="card card--pending">
              <span className="label">Pinpointing location</span>
              <div className="shimmer shimmer--title" />
              <div className="shimmer" />
              <p className="muted small">{pendingHint(search.stage, search.mode)}</p>
            </section>
          )}

          {result && (
            <section className="card card--result">
              <div className="card__row">
                <span className="label">Best match</span>
                <span className={`chip chip--${confidenceTier[result.confidence]}`}>{result.confidence} confidence</span>
              </div>
              <h1 className="place">{result.name}</h1>
              <div className="stats">
                <Stat label="Likelihood" value={result.likelihood !== undefined ? `${result.likelihood}%` : "—"} />
                <Stat label="Radius" value={`±${formatRadius(result.radiusKm)}`} />
                <Coord label="Lat" value={result.lat} />
                <Coord label="Lng" value={result.lng} />
              </div>
              {result.source === "exif" && (
                <p className="note mono">
                  <Icon.Check size={12} /> Snapped to GPS coordinates in the file, which agree with the visual analysis.
                </p>
              )}
              <div className="links">
                <a href={googleMapsUrl(result)} target="_blank" rel="noopener noreferrer" className="btn btn--sm">
                  Google Maps <Icon.External size={12} />
                </a>
                <a href={streetViewUrl(result)} target="_blank" rel="noopener noreferrer" className="btn btn--sm">
                  Street View <Icon.External size={12} />
                </a>
                <a href={openStreetMapUrl(result)} target="_blank" rel="noopener noreferrer" className="btn btn--sm">
                  OpenStreetMap <Icon.External size={12} />
                </a>
              </div>
            </section>
          )}

          {ranked.length > 1 && (
            <section>
              <h2 className="label">Ranked candidates</h2>
              <ul className="ranked">
                {ranked.map((c, i) => (
                  <li key={`${c.name}-${i}`}>
                    <button type="button" className={`ranked__item${i === selected ? " is-selected" : ""}`} onClick={() => select(i)}>
                      <span className={`rank rank--${i === 0 ? "primary" : tierFor(c.likelihood)}`}>{i + 1}</span>
                      <span className="ranked__text">
                        <span className="ranked__name">{c.name}</span>
                        <Bar value={c.likelihood ?? 0} tier={i === 0 ? "jade" : tierFor(c.likelihood)} />
                      </span>
                      <span className="ranked__pct mono">{c.likelihood !== undefined ? `${c.likelihood}%` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {regionModel && regionModel.regions.length > 0 && (
            <section>
              <h2 className="label">
                Region model <span className="label__aside">{regionModel.model}</span>
              </h2>
              <ul className="regions">
                {regionModel.regions.slice(0, 5).map((r) => (
                  <li key={`${r.name}-${r.lat}`}>
                    <button type="button" className="regions__item" onClick={() => setFocus({ lat: r.lat, lng: r.lng, zoom: 6, nonce: Date.now() })}>
                      <span className="regions__name">{r.name}</span>
                      <span className="regions__pct mono">{(r.share * 100).toFixed(r.share < 0.1 ? 1 : 0)}%</span>
                      <Bar value={r.share * 100} tier="iris" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted small">Visual similarity against 100,000 geotagged places. A prior, not a verdict.</p>
            </section>
          )}

          {(search.evidence?.length ?? 0) > 0 && (
            <EvidenceCompare
              searchId={id}
              thumbUrl={thumbUrl}
              evidence={search.evidence!}
              onOpen={setLightbox}
              onLocate={(e) => e.lat !== undefined && e.lng !== undefined && setFocus({ lat: e.lat, lng: e.lng, zoom: 16, nonce: Date.now() })}
            />
          )}

          {result && result.cues.length > 0 && (
            <section>
              <h2 className="label">
                Visual evidence <span className="label__aside">{result.cues.length} cues</span>
              </h2>
              <ul className="cues">
                {result.cues.map((cue) => (
                  <li key={cue}>{cue}</li>
                ))}
              </ul>
            </section>
          )}

          {result?.reasoning && (
            <section>
              <h2 className="label">Reasoning</h2>
              <p className="prose">{result.reasoning}</p>
            </section>
          )}

          {result?.verification && (
            <section className="verify">
              <h2 className="label">
                <Icon.Shield size={13} /> Verification
              </h2>
              <p className="prose">{result.verification}</p>
            </section>
          )}
        </div>

        <footer className="panel__foot mono">Case ID · {id}</footer>
      </aside>

      {lightbox && (
        <div className="lightbox" role="dialog" aria-label={lightbox.caption} onClick={() => setLightbox(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.caption} />
            <figcaption className="mono">{lightbox.caption}</figcaption>
          </figure>
          <button type="button" className="lightbox__close btn btn--ghost" onClick={() => setLightbox(null)}>
            Close
          </button>
        </div>
      )}
    </main>
  );
}

function stepStates(search: PublicSearch): Record<(typeof STEPS)[number]["stage"], StepState> {
  const current = stageIndex(search.stage);
  const events = search.events ?? [];
  const used = (kinds: string[]) => events.some((e) => kinds.includes(eventIcon(e)));
  const finished = search.status !== "processing";
  const state = (stage: SearchStage, ran: boolean): StepState => {
    const i = stageIndex(stage);
    if (search.stage === stage && !finished) return "active";
    if (finished) return ran ? "done" : "skipped";
    return current > i ? (ran ? "done" : "skipped") : "pending";
  };
  return {
    region: state("region", Boolean(search.regionModel)),
    clues: state("clues", current > stageIndex("clues") || (finished && search.status === "complete")),
    street: search.mode === "quick" ? "skipped" : state("street", used(["map", "web"])),
    verify: search.mode === "quick" ? "skipped" : state("verify", used(["satellite", "photos"])),
  };
}

function skippedHint(search: PublicSearch, stage: SearchStage): string {
  if (search.mode === "quick" && (stage === "street" || stage === "verify")) return "Deep search only";
  if (stage === "region") return "Region model unavailable";
  return "Not needed for this photo";
}

function pendingHint(stage: SearchStage, mode: PublicSearch["mode"]): string {
  switch (stage) {
    case "queued":
      return "Queued…";
    case "region":
      return "Comparing the photo against 100,000 geotagged places…";
    case "clues":
      return mode === "deep" ? "Studying the photo and zooming into details…" : "Reading signs, architecture, terrain and vegetation…";
    case "street":
      return "Narrowing down to a street with OpenStreetMap and the web…";
    case "verify":
      return "Cross-checking satellite and reference imagery…";
    default:
      return "Finishing up…";
  }
}

const EVENT_ICONS: Record<string, (p: { size?: number }) => React.ReactElement> = {
  satellite: Icon.Satellite,
  zoom: Icon.Zoom,
  photos: Icon.Photos,
  web: Icon.Search,
  map: Icon.MapIcon,
  thought: Icon.Spark,
  warn: Icon.Warn,
  step: Icon.Layers,
};

function LogFeed({ events, start, live }: { events: LogEvent[]; start: string; live: boolean }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  if (!events.length) return <p className="muted small">{live ? "Waiting for the first step…" : "No log for this search."}</p>;
  return (
    <ol className="log" ref={ref}>
      {events.map((e, i) => {
        const I = EVENT_ICONS[eventIcon(e)] ?? Icon.Layers;
        return (
          <li key={`${e.at}-${i}`} className={`log__item log__item--${e.kind}`}>
            <span className="log__icon">
              <I size={13} />
            </span>
            <span className="log__body">
              <span className="log__label">{e.label}</span>
              {e.detail && <span className="log__detail">{e.detail}</span>}
            </span>
            <span className="log__time mono">+{elapsed(start, e.at)}</span>
          </li>
        );
      })}
      {live && <li className="log__item log__item--live" aria-hidden />}
    </ol>
  );
}

const KIND_LABEL: Record<Evidence["kind"], string> = { satellite: "Satellite", reference: "Reference photo", street: "Street level", crop: "Zoomed detail" };

function EvidenceCompare({
  searchId,
  thumbUrl,
  evidence,
  onOpen,
  onLocate,
}: {
  searchId: string;
  thumbUrl: string;
  evidence: Evidence[];
  onOpen: (v: { src: string; caption: string }) => void;
  onLocate: (e: Evidence) => void;
}) {
  const [index, setIndex] = useState(0);
  const current = evidence[Math.min(index, evidence.length - 1)];
  const src = (e: Evidence) => `/api/search/${searchId}/evidence/${e.n}`;
  return (
    <section>
      <h2 className="label">
        Evidence <span className="label__aside">{evidence.length} items</span>
      </h2>
      <div className="compare">
        <figure className="compare__side">
          <img src={thumbUrl} alt="Uploaded photo" />
          <figcaption className="mono">Your photo</figcaption>
        </figure>
        <figure className="compare__side">
          <button type="button" onClick={() => onOpen({ src: src(current), caption: current.caption })}>
            <img src={src(current)} alt={current.caption} />
          </button>
          <figcaption className="mono">{KIND_LABEL[current.kind]}</figcaption>
        </figure>
      </div>
      <div className="compare__meta">
        <span className="compare__caption">{current.caption}</span>
        <span className="compare__credit">
          {current.credit}
          {current.link && (
            <>
              {" · "}
              <a href={current.link} target="_blank" rel="noopener noreferrer">
                source
              </a>
            </>
          )}
          {current.lat !== undefined && (
            <>
              {" · "}
              <button type="button" className="linklike" onClick={() => onLocate(current)}>
                show on map
              </button>
            </>
          )}
        </span>
      </div>
      <div className="strip">
        {evidence.map((e, i) => (
          <button key={e.n} type="button" className={`strip__item${i === index ? " is-on" : ""}`} onClick={() => setIndex(i)} title={e.caption}>
            <img src={src(e)} alt="" loading="lazy" />
            <span className={`strip__kind strip__kind--${e.kind}`} />
          </button>
        ))}
      </div>
    </section>
  );
}

function Bar({ value, tier }: { value: number; tier: string }) {
  return (
    <span className="bar" aria-hidden>
      <span className={`bar__fill bar__fill--${tier}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__label mono">{label}</span>
      <span className="stat__value mono">{value}</span>
    </div>
  );
}

function Coord({ label, value }: { label: string; value: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="stat stat--button"
      title="Copy"
      onClick={() =>
        navigator.clipboard?.writeText(value.toFixed(6)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        })
      }
    >
      <span className="stat__label mono">{copied ? "Copied" : label}</span>
      <span className="stat__value mono">{value.toFixed(5)}°</span>
    </button>
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

function downloadReport(search: PublicSearch) {
  const r = search.result;
  if (!r) return;
  const url = window.location.href;
  const lines = [
    `# PhotoLocator case report`,
    ``,
    `- **Case:** ${search.id}`,
    `- **Link:** ${url}`,
    `- **Mode:** ${search.mode === "deep" ? "Deep search" : "Quick find"}`,
    `- **Created:** ${search.createdAt}`,
    ``,
    `## Best match`,
    ``,
    `**${r.name}** (${r.country})`,
    ``,
    `- Coordinates: ${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`,
    `- Confidence: ${r.confidence}${r.likelihood !== undefined ? ` · likelihood ${r.likelihood}%` : ""} · ±${formatRadius(r.radiusKm)}`,
    `- Source: ${r.source === "exif" ? "GPS metadata, confirmed visually" : "visual analysis"}`,
    `- Map: ${googleMapsUrl(r)}`,
    ``,
    `## Ranked candidates`,
    ``,
    ...[{ name: r.name, lat: r.lat, lng: r.lng, likelihood: r.likelihood }, ...r.alternatives].map(
      (c, i) => `${i + 1}. ${c.name} — ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}${c.likelihood !== undefined ? ` — ${c.likelihood}%` : ""}`,
    ),
    ``,
    `## Visual evidence`,
    ``,
    ...r.cues.map((c) => `- ${c}`),
    ``,
    `## Reasoning`,
    ``,
    r.reasoning,
    ...(r.verification ? [``, `## Verification`, ``, r.verification] : []),
    ...(search.regionModel
      ? [``, `## Region model (${search.regionModel.model})`, ``, ...search.regionModel.regions.map((g) => `- ${g.name}: ${(g.share * 100).toFixed(1)}%`)]
      : []),
    ...(search.evidence?.length
      ? [``, `## Evidence`, ``, ...search.evidence.map((e) => `- ${KIND_LABEL[e.kind]}: ${e.caption}${e.credit ? ` (${e.credit})` : ""}${e.link ? ` ${e.link}` : ""}`)]
      : []),
    ...(search.events?.length ? [``, `## Investigation log`, ``, ...search.events.map((e) => `- +${elapsed(search.createdAt, e.at)} ${e.label}${e.detail ? ` — ${e.detail}` : ""}`)] : []),
    ``,
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `photolocator-${search.id.slice(0, 8)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
