# PhotoLocator

Find where any photo was taken, with no metadata required. An open region model ranks where on Earth the photo could be. An AI investigator then reads the clues, searches OpenStreetMap and the web, and checks satellite and reference imagery to pin the spot. Every answer comes with ranked candidates, calibrated likelihoods and the evidence behind it.

## The pipeline

| Stage | What happens | Powered by |
| --- | --- | --- |
| **1 · Find region** | The photo is embedded and scored against 100,000 geotagged places. This produces a heatmap and ranked regions in about 1 s. | [GeoCLIP](https://github.com/VicenteVivan/geo-clip) (NeurIPS 2023, MIT), run locally with ONNX Runtime, plus an offline [GeoNames](https://www.geonames.org) gazetteer for region names |
| **2 · Read clues** | Claude studies scripts, road markings, bollards, poles, vegetation, architecture and sun angle. In deep search it zooms into full-resolution crops to read distant signs. | Claude (`claude-opus-5`) with adaptive thinking |
| **3 · Find street** | Names it reads become coordinates. Overpass queries find where a distinctive combination of features exists, and web search fills gaps. | OpenStreetMap Nominatim + Overpass, Claude web search |
| **4 · Verify** | Candidates are compared against satellite imagery and nearby reference photos (road layout, footprints, skyline, terrain). | Esri World Imagery, Wikimedia Commons, Mapillary (optional) |

- **Quick find** runs stages 1–2: the region model's priors plus a single structured Claude call (~20 s).
- **Deep search** runs all four stages as a tool-using agent: up to ~24 tool calls, typically 1–4 min. It requires sign-in when OpenStreetMap sign-in is configured.

On a few geotagged test photos, GeoCLIP alone placed a Phoenix street 11 km off, Nairobi 23 km off and Moraine Lake 6 km off, each within a second. It spreads its probability thin on photos with no geographic signal, which is the right behaviour. Claude's investigation takes it from there.

### Models considered

| Model | Why it was or wasn't used |
| --- | --- |
| **GeoCLIP** ✅ | MIT license, an [ONNX export](https://huggingface.co/Xenova/geoclip-large-patch14) runs in Node with no Python, and it gives probabilities over 100K GPS points, which is ideal for a heatmap and for RAG priors. |
| [PIGEON / PIGEOTTO](https://github.com/LukasHaas/PIGEON) | Strong (CVPR 2024), but needs a Python/PyTorch service and its geocell data. A good upgrade path. |
| [PLONK](https://github.com/nicolas-dufour/plonk) | Generative (diffusion) geolocation with [OSV-5M weights](https://huggingface.co/nicolas-dufour/PLONK_OSV_5M). Python only. |
| [OSV-5M baseline](https://huggingface.co/osv5m/baseline) | Street-view specific benchmark model. Python only. |
| StreetCLIP | Non-commercial license. |

The Claude step follows the retrieval-augmented approach from [Img2Loc](https://dl.acm.org/doi/10.1145/3626772.3657673) and [G3](https://arxiv.org/abs/2405.14702): the retrieval model's candidates are handed to a multimodal model as priors to confirm or overrule.

## The workspace

- **Left rail:** the source photo, a pipeline stepper (Region → Clues → Street → Verify) and a live investigation log. The log shows every tool call and the model's thinking summaries as they happen.
- **Map:** a 3D MapLibre globe with Dark, Satellite, Outdoors and Streets basemaps plus terrain. The GeoCLIP heatmap appears as soon as the region stage finishes. Candidates are numbered pins coloured by likelihood (jade → lime → amber → red), with an uncertainty circle around the best match.
- **Right panel:** the best match (confidence, likelihood, radius, coordinates, links out), ranked candidates with likelihood bars, and the region model's shares. Evidence is shown side by side (your photo vs the satellite snapshot, reference photo or zoomed crop the investigator looked at), followed by cues, reasoning and verification.
- **Share & report:** results live at `/search/<id>`, and **Report** downloads a Markdown case file.
- **Cases:** signed-in users get a history at `/history`.

## Getting started

```bash
npm install
npm run models:download        # GeoCLIP (~350 MB) + GeoNames gazetteer
cp .env.example .env.local     # then fill it in
npm run dev                    # http://127.0.0.1:3000
```

- Use `127.0.0.1` rather than `localhost` in the browser, so the OAuth redirect lands on the origin that holds your cookies.
- On first use, GeoCLIP embeds its 100K-point gallery once (~15 s) and caches it in `models/geoclip/gallery_embeddings.f32` (200 MB). The server warms the model up at start.
- Without the model files, the app still works: it logs a warning and skips the region stage.
- `.npmrc` tells `onnxruntime-node` to skip its optional CUDA download; the CPU runtime is bundled.

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_URL` | yes | Public base URL. The OSM redirect URI is `${APP_URL}/api/auth/osm/callback`. |
| `ANTHROPIC_API_KEY` | yes | From [platform.claude.com](https://platform.claude.com). |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5`. |
| `SESSION_SECRET` | yes in prod | At least 32 characters; `openssl rand -base64 32`. |
| `OSM_CLIENT_ID` / `OSM_CLIENT_SECRET` | for sign-in | See below. When unset, sign-in is hidden and deep search is open to everyone (quotas still apply). |
| `MAPILLARY_TOKEN` | no | Free client token; enables the street-level imagery tool. |
| `WEB_SEARCH` | no | `off` disables Claude's web search tool. It must also be enabled for your org in the Claude Console. |
| `GEOCLIP` / `GEOCLIP_PRECISION` | no | `off` to skip the region model; `fp32` for the full-precision vision encoder. |
| `MODELS_DIR` / `DATA_DIR` | no | Defaults to `models` / `.data`. |
| `NOMINATIM_URL` / `OVERPASS_URLS` | no | Point at your own instances for heavy traffic. |
| `FREE_SEARCHES_PER_DAY` / `USER_SEARCHES_PER_DAY` | no | Daily quotas (default 1 / 5); searches that fail on the server's side are refunded. |

### Registering the OpenStreetMap app

1. Go to **My Account → OAuth 2 applications → Register new application** on openstreetmap.org.
2. Add these **redirect URIs**: `http://127.0.0.1:3000/api/auth/osm/callback` (OSM only accepts plain `http` for loopback) and `https://<your-domain>/api/auth/osm/callback`.
3. Leave it a **Confidential application**. Tick **only "Read user preferences (read_prefs)"**. The app reads your OSM id, name and avatar, then revokes the token.
4. Put the client ID and secret in `.env.local`. Treat the secret like a password. If it leaks, delete the app on OSM and register a new one.

## Deploying

The app needs **one long-running Node process** with a persistent disk (a VPS, Docker with a volume, Fly.io, Railway or Render with a disk). Plan for about 1.5 GB of RAM for GeoCLIP and ~600 MB of disk for the models.

```bash
npm ci && npm run models:download && npm run build && npm start
```

- Put it behind a reverse proxy that sets `X-Forwarded-For`. The anonymous quota keys on the rightmost entry.
- Serverless hosts (Vercel, Netlify) don't fit: GeoCLIP needs a warm process and the file store needs a disk. `src/lib/store.ts` is the only module that touches the filesystem, if you want to swap in a database.
- **Cost:** Quick find is one Claude call. Deep search is a multi-turn agent with images, so it costs noticeably more per search; prompt caching is enabled across turns. Keep quotas in mind.
- **Refusals:** requests use Claude's server-side refusal fallbacks (`fallbacks: "default"`).

### Third-party services

All map and data services are free and keyless, each with a fair-use policy:
- [OpenFreeMap](https://openfreemap.org) basemaps
- Esri World Imagery
- [OpenTopoMap](https://opentopomap.org)
- AWS Terrain Tiles
- Nominatim (1 request/s, enforced)
- Overpass (with a mirror fallback and a circuit breaker)
- Wikimedia Commons

For real traffic, use commercial or self-hosted equivalents; the endpoints are in `src/lib/mapStyles.ts`, `src/lib/geoservices.ts` and `.env.example`.

MapLibre 6 loads its web worker from a separate file. `npm run dev` and `npm run build` copy it into `public/maplibre/` first.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm run models:download` | Fetch GeoCLIP + GeoNames (`-- --fp32`, `-- --force`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Node's built-in runner) |

## Responsible use

Photo geolocation can expose where someone lives or spends time. The investigator is told never to identify people and to stop at street or neighbourhood level for private homes. Only a small, metadata-free thumbnail (plus the imagery the investigator looked at) is stored. Please don't use this to locate people who haven't agreed to it.
