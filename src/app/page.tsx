import * as Icon from "@/components/icons";
import MapView from "@/components/MapView";
import TopBar from "@/components/TopBar";
import UploadCard from "@/components/UploadCard";
import { config, osmEnabled } from "@/lib/config";
import { getRequester, getRequesterQuota } from "@/lib/requester";

const STEPS = [
  {
    n: "01",
    icon: Icon.Globe,
    title: "Find region",
    body: "GeoCLIP embeds the photo and scores it against 100,000 geotagged places worldwide, producing a heatmap and ranked regions in about a second. No landmarks or metadata needed.",
  },
  {
    n: "02",
    icon: Icon.Eye,
    title: "Read the clues",
    body: "Claude studies the scene like a seasoned geolocator: scripts, road markings, bollards, poles, vegetation, architecture and sun angle. It zooms into full-resolution crops to read distant signs.",
  },
  {
    n: "03",
    icon: Icon.Road,
    title: "Find the street",
    body: "Names it reads become coordinates via OpenStreetMap geocoding. Overpass queries find where the distinctive combination of features actually exists, and web search fills in the rest.",
  },
  {
    n: "04",
    icon: Icon.Shield,
    title: "Verify",
    body: "Candidates are checked against satellite imagery and nearby reference photos: road layout, building footprints, skyline and terrain. You get ranked leads with calibrated likelihoods.",
  },
];

const MODELS = [
  {
    name: "GeoCLIP",
    role: "Region model",
    detail: "CLIP ViT-L/14 image encoder aligned with a GPS encoder (NeurIPS 2023). Runs on this server via ONNX Runtime.",
    license: "MIT",
    href: "https://github.com/VicenteVivan/geo-clip",
  },
  {
    name: "Claude",
    role: "Investigator",
    detail: "Reads visual clues, reasons over the region model's priors and drives the geo tools in deep search.",
    license: "Anthropic API",
    href: "https://www.anthropic.com/claude",
  },
  {
    name: "OpenStreetMap",
    role: "Street finder",
    detail: "Nominatim geocoding and Overpass feature queries over the world's open map.",
    license: "ODbL",
    href: "https://www.openstreetmap.org/copyright",
  },
  {
    name: "Reference imagery",
    role: "Verification",
    detail: "Esri World Imagery for satellite views, geotagged Wikimedia Commons photos, and Mapillary street level when configured.",
    license: "Per source",
    href: "https://commons.wikimedia.org",
  },
  {
    name: "GeoNames",
    role: "Gazetteer",
    detail: "69,000 towns and cities, stored offline, to name regions instantly.",
    license: "CC BY 4.0",
    href: "https://www.geonames.org",
  },
];

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requester = await getRequester();
  const quota = await getRequesterQuota(requester);
  const { auth_error: authError } = await searchParams;
  const osm = osmEnabled();

  return (
    <main className="home">
      <section className="hero">
        <MapView styleId="dark" layout="home" spinning />
        <div className="hero__veil" aria-hidden />
        <TopBar user={requester.user} osmEnabled={osm} sections />
        <div className="hero__inner">
          <div className="hero__copy">
            <span className="chip chip--iris mono">
              <span className="lamp lamp--processing" aria-hidden /> Visual geolocation · no metadata required
            </span>
            <h1 className="hero__title">
              Pixels in.
              <br />
              <em>Coordinates out.</em>
            </h1>
            <p className="hero__lede">
              Drop in any photo. An open region model ranks where on Earth it could be, then an AI investigator reads the clues, searches OpenStreetMap and
              checks satellite imagery to pin the spot, with the evidence to back it up.
            </p>
            <UploadCard
              signedIn={Boolean(requester.user)}
              osmEnabled={osm}
              deepLocked={osm && !requester.user}
              quota={quota}
              authError={typeof authError === "string" ? authError : undefined}
            />
          </div>
        </div>
        <dl className="metrics">
          <div>
            <dt className="mono">Reference places</dt>
            <dd>100K</dd>
          </div>
          <div>
            <dt className="mono">Region search</dt>
            <dd>~1 s</dd>
          </div>
          <div>
            <dt className="mono">Pipeline stages</dt>
            <dd>4</dd>
          </div>
          <div>
            <dt className="mono">Photos kept</dt>
            <dd>Thumbnail only</dd>
          </div>
        </dl>
      </section>

      <section id="how" className="section">
        <header className="section__head">
          <span className="eyebrow mono">How it works</span>
          <h2 className="section__title">
            From a single photo to <em>ranked, verified leads.</em>
          </h2>
        </header>
        <ol className="steps">
          {STEPS.map(({ n, icon: I, title, body }) => (
            <li key={n} className="step glass">
              <span className="step__n mono">{n}</span>
              <span className="step__icon">
                <I size={18} />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="models" className="section">
        <header className="section__head">
          <span className="eyebrow mono">Models &amp; data</span>
          <h2 className="section__title">
            Open where it can be. <em>Explainable everywhere.</em>
          </h2>
          <p className="section__lede">
            Every answer shows its working: the region model&apos;s heatmap, each tool call in the investigation log, and the imagery it was checked against.
          </p>
        </header>
        <div className="models">
          {MODELS.map((m) => (
            <a key={m.name} href={m.href} target="_blank" rel="noopener noreferrer" className="model glass">
              <span className="model__role mono">{m.role}</span>
              <span className="model__name">
                {m.name} <Icon.External size={13} />
              </span>
              <span className="model__detail">{m.detail}</span>
              <span className="chip mono">{m.license}</span>
            </a>
          ))}
        </div>
      </section>

      <section id="trust" className="section section--trust">
        <div className="trust glass">
          <div>
            <span className="eyebrow mono">Responsible use</span>
            <h2 className="section__title section__title--sm">Built to find places, not people.</h2>
          </div>
          <ul className="trust__list">
            <li>
              <Icon.Check size={14} /> The investigator never identifies people, and stops at street level for private homes.
            </li>
            <li>
              <Icon.Check size={14} /> Uploads are processed in memory. Only a small thumbnail, stripped of metadata, is kept for your share link.
            </li>
            <li>
              <Icon.Check size={14} /> The region model runs on this server; anonymous quotas use a keyed hash, never your raw IP.
            </li>
            <li>
              <Icon.Check size={14} /> Please don&apos;t use this to locate someone who hasn&apos;t agreed to it.
            </li>
          </ul>
        </div>
      </section>

      <footer className="footer mono">
        <span>
          <Icon.Logo size={14} /> PhotoLocator
        </span>
        <span>
          Region model: GeoCLIP (MIT) · Map data © OpenStreetMap contributors · Places: GeoNames
          {config.tools.mapillaryToken ? " · Street level: Mapillary" : ""}
        </span>
      </footer>
    </main>
  );
}
