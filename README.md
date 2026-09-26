# PhotoLocator

Upload a photo and find out where it was taken. Claude reads the terrain, vegetation, architecture, road markings and signage, then pins its best guess on a 3D globe with the visual evidence, its reasoning and a few alternative spots.

- **Upload** by drag-and-drop, file picker or pasting a screenshot.
- **Quick find** (fast) and **Deep search** (more reasoning, requires sign-in).
- **3D globe** built on MapLibre, with Dark, Satellite, Outdoors and Streets basemaps, terrain, an uncertainty circle, and links to Google Maps, Street View and OpenStreetMap.
- **Shareable results** at `/search/<id>`, with the status panel polling live while the analysis runs.
- **Sign in with OpenStreetMap** (OAuth 2 + PKCE) for a larger daily quota, Deep search and a search history.
- **Daily quotas** that reset at 00:00 UTC. A search that fails on the server's side doesn't count.
- **GPS metadata**: if the photo carries EXIF GPS that agrees with the visual read, the pin snaps to it.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · MapLibre GL JS 6 · Claude API (`@anthropic-ai/sdk`, structured outputs) · sharp · exifr. Storage is plain files on disk. There is no database to set up.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill it in (see below)
npm run dev                  # http://127.0.0.1:3000
```

Use `127.0.0.1` rather than `localhost` in the browser, so the OAuth redirect lands on the same origin that holds your cookies.

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_URL` | yes | Public base URL, e.g. `https://photolocator.example`. The OSM redirect URI is `${APP_URL}/api/auth/osm/callback`. |
| `ANTHROPIC_API_KEY` | yes | From [platform.claude.com](https://platform.claude.com). |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5`. |
| `SESSION_SECRET` | yes in prod | At least 32 characters; `openssl rand -base64 32`. Without it, a random per-process secret is used and everyone is signed out on restart. |
| `OSM_CLIENT_ID` / `OSM_CLIENT_SECRET` | for sign-in | See below. Sign-in is hidden when these are unset. |
| `FREE_SEARCHES_PER_DAY` | no | Anonymous quota per IP (default `1`). Set to `0` to require sign-in. |
| `USER_SEARCHES_PER_DAY` | no | Quota per signed-in OSM account (default `5`). |
| `DATA_DIR` | no | Where records, thumbnails and counters live (default `.data`). |

### Registering the OpenStreetMap app

1. Open **My Account → OAuth 2 applications → Register new application** on openstreetmap.org (`/oauth2/applications/new`).
2. **Redirect URIs**, one per line:
   - `http://127.0.0.1:3000/api/auth/osm/callback` for local development (OSM only accepts plain `http` for loopback addresses)
   - `https://<your-domain>/api/auth/osm/callback` for production
3. Leave **Confidential application** ticked.
4. Tick **only "Read user preferences (read_prefs)"**. The app just reads your OSM id, display name and avatar, and revokes the token straight away. Don't grant write or moderator permissions (`write_api`, `write_redactions`, `write_blocks`, messaging…); a leaked secret for an app with those scopes is a real liability.
5. Copy the client ID and secret into `.env.local`. The secret is shown once.

Treat the client secret like a password. Keep it out of git (`.env*.local` is ignored), chat messages and screenshots. If it leaks, delete the application on OSM and register a new one.

To test against the OSM dev server, register the app on `https://master.apis.dev.openstreetmap.org` and set `OSM_BASE_URL` and `OSM_API_URL` to that host.

## How it works

1. `POST /api/search` validates the upload, reads EXIF (GPS, capture time, camera), and uses sharp to make a 1568 px JPEG for the model plus a 640 px metadata-free thumbnail. It then takes one search from the day's quota, saves the record and returns its id.
2. The analysis runs after the response is sent, via `after()`. `src/lib/analyze.ts` streams a request to Claude with adaptive thinking, `effort: low` (Quick) or `high` (Deep), and a Zod schema as structured output. Server-side refusal fallbacks are enabled (`fallbacks: "default"`).
3. The result page (`/search/<id>`) polls `GET /api/search/<id>` every 1.5 s while the globe spins, then flies to the pin.

The original upload never touches the disk. Only the thumbnail is kept, so the share link works. Anonymous quotas are keyed by an HMAC of the client IP, never the raw address.

## Deploying

The file store (`src/lib/store.ts`) expects **one long-running Node process with a persistent disk**, e.g. a VPS, Docker with a volume, Fly.io, Railway or Render with a disk:

```bash
npm ci && npm run build && npm start   # or PORT=8080 npm start
```

- Put it behind a reverse proxy that sets `X-Forwarded-For`, which the anonymous quota uses.
- On serverless hosts (Vercel, Netlify), swap `src/lib/store.ts` for a database or KV store. Nothing else touches the filesystem.

### Map tiles

All basemaps are free and keyless: [OpenFreeMap](https://openfreemap.org) (Dark, Streets), Esri World Imagery (Satellite), [OpenTopoMap](https://opentopomap.org) (Outdoors), and the AWS Terrain Tiles open dataset for 3D terrain. Each has its own fair-use policy. For real traffic, switch to a commercial provider (MapTiler, Stadia, Mapbox…) by editing `src/lib/mapStyles.ts`.

MapLibre 6 loads its web worker from a separate file. `npm run dev` and `npm run build` copy it into `public/maplibre/` first (`scripts/copy-maplibre-worker.mjs`).

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Node's built-in runner) |

## Responsible use

Photo geolocation can expose where someone lives or spends time. The model is told not to identify people. Please don't use this to locate people who haven't agreed to it.
