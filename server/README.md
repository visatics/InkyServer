# InkyServer server — Phase 0.3a (DB-driven config + management API)

> Project overview and phase status: [`../README.md`](../README.md).

Stateless image server for Pimoroni Inky Frame colour e-paper devices. The device makes an
unauthenticated `GET /:uuid` keyed by a public UUID and receives JSON pointing at a finished,
full-colour baseline JPEG at the device resolution (600×448 for the Inky Frame 5.7"). The
device downloads the image and dithers on-device.

Phase 0.3a scope: device, screen, button and asset config now live in **Postgres** rather
than hard-coded constants, with an auth-scoped management API (`/api`) on top. The device
contract is unchanged — the same `GET /:uuid`, the same JSON. The state engine is unchanged
too: it takes config as a parameter instead of importing it, so the same pure functions
serve DB rows and test fixtures alike. No web UI yet (Phase 0.3b), and still only the
`slideshow` and `debug` providers. See `docs/InkyServer-PRD-v1.1.md` §5, §6 and §8.

## Setup

### 1. Environment

```bash
cp .env.example .env
```

Fill in:

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port (default 8080) |
| `PUBLIC_BASE_URL` | Externally reachable base URL of this server (used for the placeholder image URL) |
| `DEVICE_UUID` | The public UUID the device polls with — paste the same value into the device settings |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side only — never ship to a client) |
| `SUPABASE_STORAGE_BUCKET` | Storage bucket for rendered images (default `renders`) |
| `SUPABASE_DB_URL` | Postgres URI for `psql` migrations only. Dashboard → Project Settings → Database → Connection string → URI, **Session pooler** tab (the direct host is IPv6-only). |
| `DATABASE_URL` | Same URI — this one **is** read by the app for all config queries. |
| `SUPABASE_JWT_SECRET` | Optional. Set it for projects using legacy HS256 tokens; otherwise tokens are verified against the project's JWKS endpoint. |

### 2. Supabase: one-time bucket + migration

Two buckets with different trust levels — `renders` is **public** (the device downloads
from it unauthenticated); `uploads` is **private** (user source images, read server-side
with the service role):

```sql
insert into storage.buckets (id, name, public) values ('renders', 'renders', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false)
  on conflict (id) do nothing;
```

Run the migrations in order:

```bash
psql "$SUPABASE_DB_URL" -f migrations/001_renders.sql
psql "$SUPABASE_DB_URL" -f migrations/002_web_app.sql
```

Then seed the Phase 0.2 fixture device, which is what keeps `test/protocol.sh` meaningful
as a regression test:

```bash
node --env-file=.env scripts/seed-fixture.mjs
```

### 3. Run

```bash
npm install
npm run dev        # tsx watch
# or
npm run build && npm start
```

```bash
npm test           # unit tests: state/advancement logic + render cache keying
```

With the server running, verify the whole device contract against the live backend:

```bash
npm run test:protocol      # or: BASE_URL=https://... npm run test:protocol
```

That covers what the unit tests can't — render, upload, cache lookup and the bytes
actually served. Exits non-zero on failure, `2` if the server or `.env` is missing.

## Protocol (PRD §7)

```
GET /:uuid?screen=<n>&idx=<n>&button=<X>
```

The query string is the client-held state; the server is stateless. Response:

```json
{
  "image":   "https://<supabase>/storage/v1/object/public/renders/...jpg",
  "refresh": 1,
  "sha":     "05e56f039513ef6d0128acd9ca0f006a1925ea3c",
  "state":   { "screen": 1, "idx": 0 }
}
```

The query string is the client-held state plus an optional `button` (A–E). The route picks
exactly one of three transition paths per request:

1. **First boot** (no `screen` param, or an unknown screen) → the default screen's initial state.
2. **Button press** (`button` present) → `applyButton`: screen override wins, then device
   default, then no-op. `goto` switches screen and resets provider keys; `set`/`cycle` change
   one key; `slideshow next/prev` steps the photos; unknown buttons are no-ops.
3. **Timer/manual wake** (state, no button) → `applyRefresh`: slideshows advance (sequential)
   or pick a fresh random index; the debug screen re-renders the same state (same SHA, so the
   device skips the refresh).

Unknown UUIDs get a 404. Render failures return the last good image for that screen
(in-memory, per-process), else a locally-served placeholder — never a 5xx.

### Screens and buttons (Postgres; seeded by `scripts/seed-fixture.mjs`)

| Screen | Provider | Notes |
|---|---|---|
| 1 | slideshow | sequential, 3 photos (`assets/slideshow-a/`) |
| 2 | slideshow | random, 2 photos (`assets/slideshow-b/`) |
| 3 | debug | renders live state + the resolved A–E button legend |

Device defaults: A/B/C → goto screens 1/2/3, D → next photo, E → none.
Screen 3 overrides: D → `set mode=light`, E → `cycle mode` (light → dark → blue).

All of this is now editable through `/api` rather than by editing TypeScript.

## Management API (`/api`)

Every route requires a Supabase JWT (`Authorization: Bearer <token>`) and is scoped to the
owner. Cross-user access returns **404**, not 403 — a 403 would confirm the resource exists.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/presets` | The three Inky Frame presets |
| GET/POST | `/api/devices` | List / create (from `presetId` or a custom spec) |
| GET/PATCH/DELETE | `/api/devices/:id` | Read / update / delete |
| POST | `/api/devices/:id/regenerate-uuid` | Invalidate the old UUID |
| GET/POST | `/api/devices/:id/screens` | List / create screens |
| PATCH/DELETE | `/api/screens/:id` | Update / delete a screen |
| POST | `/api/devices/:id/screens/reorder` | Rewrite ordinals |
| GET | `/api/devices/:id/mappings` | Device-level button defaults |
| PUT/DELETE | `/api/devices/:id/mappings/:button` | Set / clear one button |
| GET/POST | `/api/screens/:id/assets` | List / upload slideshow images |
| POST | `/api/screens/:id/assets/reorder` | Rewrite positions |
| DELETE | `/api/assets/:id` | Delete an asset and its object |

Button mappings store the **exact `ButtonAction` JSON** the engine consumes — the API does
no translation, so what the matrix editor saves is what the state engine reads.

Uploads are validated, EXIF-stripped and re-encoded server-side (PRD §11); source bytes are
never stored as received.

## Manual test script

```bash
U="$PUBLIC_BASE_URL/$DEVICE_UUID"

# Boot -> screen 1, idx 0
curl -s "$U" | jq '.state'                                  # {screen:1, idx:0}

# Timer poll advances the sequential slideshow
curl -s "$U?screen=1&idx=0" | jq '.state'                   # {screen:1, idx:1}

# Button A from screen 2 jumps to screen 1 (resets idx)
curl -s "$U?screen=2&idx=1&button=A" | jq '.state'          # {screen:1, idx:0}

# Button C -> debug screen; then E cycles mode
curl -s "$U?screen=1&idx=0&button=C" | jq '.state'          # {screen:3, mode:"light"}
curl -s "$U?screen=3&mode=light&button=E" | jq '.state'     # {screen:3, mode:"dark"}

# No-op button leaves state unchanged; a bare poll advances instead
S1=$(curl -s "$U?screen=1&idx=2&button=E" | jq -r '.sha')
S2=$(curl -s "$U?screen=1&idx=2"          | jq -r '.sha')   # applyRefresh advances, so expect DIFFERENT here
echo "$S1 / $S2"

# Unknown button is a no-op
curl -s "$U?screen=1&idx=0&button=Z" | jq '.state'          # {screen:1, idx:0}

# Same resolved state twice -> identical image URL + sha (render cache)
curl -s "$U?screen=3&mode=light&button=E" | jq -r '.sha'
curl -s "$U?screen=3&mode=light&button=E" | jq -r '.sha'    # same value

# Download and verify size + that it is baseline (non-progressive) JPEG
IMG=$(curl -s "$U" | jq -r '.image')
curl -s "$IMG" -o /tmp/inky.jpg && identify -verbose /tmp/inky.jpg | grep -E "Geometry|Interlace"
# Expect Geometry 600x448, Interlace: None
```

## Pointing a real Inky Frame at it

Configure the device with this server's base URL and the `DEVICE_UUID` from `.env`. Each
refresh the device polls, downloads the JPEG, dithers it on-device, and persists the returned
`state` for the next poll. On the panel: A/B/C switch screens, D steps the photos (or sets
the debug mode on screen 3), E cycles the debug mode. `refresh` is in minutes per screen
(`refreshMinutes` in `src/config/device.ts`).

## Project layout

```
src/server.ts            Fastify bootstrap + locally-served /placeholder.jpg
src/config/device.ts     hard-coded device, screens, assets, and button mappings
src/routes/device.ts     GET /:uuid handler (transition -> cache/render -> respond)
src/lib/state.ts         the state engine: parse/initial/applyButton/applyRefresh (pure, unit-tested)
src/lib/cacheKey.ts      render cache key: device + screen identity + config + resolved state
src/lib/lastGood.ts      in-memory last-known-good render per screen
src/render/slideshow.ts  pure render(screen, state) for slideshow screens
src/render/debug.ts      throwaway debug screen: state + button legend (delete in Phase 0.3)
src/render/pipeline.ts   sharp resize/encode, sha1, text composer, placeholder
src/storage/supabase.ts  storage upload + renders cache access
assets/slideshow-a/      committed sample images (screen 1)
assets/slideshow-b/      committed sample images (screen 2)
test/state.test.ts       unit tests for the pure state engine
test/cacheKey.test.ts    unit tests for render cache keying (screen isolation)
test/protocol.sh         end-to-end device-contract check against a running server
migrations/001_renders.sql
```

### Render cache keying

The cache key (`src/lib/cacheKey.ts`) covers the device UUID + resolution, the provider, a
fingerprint of the **screen** (ordinal, config, asset list), and the resolved render state.
Screen identity is load-bearing: without it two screens sharing a provider — e.g. the two
slideshows here — collide and serve each other's images.

Editing a screen's config or assets changes the fingerprint and busts the cache on its own.
**Button mappings are not in the key**, so after changing `DEVICE_BUTTONS` or
`SCREEN_BUTTON_OVERRIDES` you must still bump `CONFIG_VERSION` in `src/config/device.ts` —
the debug screen bakes the mapping legend into the image.
