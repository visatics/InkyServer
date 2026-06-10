# InkyServer — Phase 0.2 spike (buttons + state engine)

Stateless image server for Pimoroni Inky Frame colour e-paper devices. The device makes an
unauthenticated `GET /:uuid` keyed by a public UUID and receives JSON pointing at a finished,
full-colour baseline JPEG at the device resolution (600×448 for the Inky Frame 5.7"). The
device downloads the image and dithers on-device.

Phase 0.2 scope: three hard-coded screens (two slideshows + a `debug` test screen), buttons
A–E with real effect (device-level defaults + per-screen overrides), a pure state engine,
and in-memory last-known-good fallback. Providers are pure functions of state — all state
mutation lives in `src/lib/state.ts`. No auth, no DB-backed config, no other providers.
See `docs/InkyServer-PRD-v1.1.md` §8 and §13.

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

### 2. Supabase: one-time bucket + migration

Create a **public** storage bucket (Dashboard → Storage → New bucket → name `renders`,
tick "Public bucket"), or via SQL:

```sql
insert into storage.buckets (id, name, public) values ('renders', 'renders', true);
```

Run the migration (Dashboard → SQL Editor, or `psql`):

```bash
psql "$SUPABASE_DB_URL" -f migrations/001_renders.sql
```

### 3. Run

```bash
npm install
npm run dev        # tsx watch
# or
npm run build && npm start
```

```bash
npm test           # unit tests for the state/advancement logic
```

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

### Screens and buttons (hard-coded, `src/config/device.ts`)

| Screen | Provider | Notes |
|---|---|---|
| 1 | slideshow | sequential, 3 photos (`assets/slideshow-a/`) |
| 2 | slideshow | random, 2 photos (`assets/slideshow-b/`) |
| 3 | debug | renders live state + the resolved A–E button legend |

Device defaults: A/B/C → goto screens 1/2/3, D → next photo, E → none.
Screen 3 overrides: D → `set mode=light`, E → `cycle mode` (light → dark → blue).

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
src/lib/lastGood.ts      in-memory last-known-good render per screen
src/render/slideshow.ts  pure render(screen, state) for slideshow screens
src/render/debug.ts      throwaway debug screen: state + button legend (delete in Phase 0.3)
src/render/pipeline.ts   sharp resize/encode, sha1, text composer, placeholder
src/storage/supabase.ts  storage upload + renders cache access
assets/slideshow-a/      committed sample images (screen 1)
assets/slideshow-b/      committed sample images (screen 2)
migrations/001_renders.sql
```

To bust the render cache after changing screens or button mappings, bump `CONFIG_VERSION`
in `src/config/device.ts` (the debug legend bakes the mappings into the image).
