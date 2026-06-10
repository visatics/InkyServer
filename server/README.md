# InkyServer — Phase 0 spike

Stateless image server for Pimoroni Inky Frame colour e-paper devices. The device makes an
unauthenticated `GET /:uuid` keyed by a public UUID and receives JSON pointing at a finished,
full-colour baseline JPEG at the device resolution (600×448 for the Inky Frame 5.7"). The
device downloads the image and dithers on-device.

Phase 0 scope: one hard-coded device, one hard-coded slideshow screen, bundled sample images,
synchronous rendering, and a `renders` cache table. No auth, no buttons, no other providers.
See `docs/InkyServer-PRD-v1.1.md` §13.

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

`idx` in `state` is the index of the image shown in *this* response; the client echoes it back
and the next poll advances by one (wrapping). `button` is parsed and ignored in Phase 0.
Unknown UUIDs get a 404; render failures get a 200 with a locally-served placeholder image,
never a 5xx.

## Manual test script

```bash
# First boot (no state)
curl -s "$PUBLIC_BASE_URL/$DEVICE_UUID" | jq

# Simulate the device persisting state and polling again (advances)
curl -s "$PUBLIC_BASE_URL/$DEVICE_UUID?screen=1&idx=0" | jq

# Re-request the same effective index twice -> identical image + sha (cache hit)
curl -s "$PUBLIC_BASE_URL/$DEVICE_UUID?screen=1&idx=1" | jq '.sha'
curl -s "$PUBLIC_BASE_URL/$DEVICE_UUID?screen=1&idx=1" | jq '.sha'   # same value

# Download and verify size + that it is baseline (non-progressive) JPEG
IMG=$(curl -s "$PUBLIC_BASE_URL/$DEVICE_UUID" | jq -r '.image')
curl -s "$IMG" -o /tmp/inky.jpg && identify -verbose /tmp/inky.jpg | grep -E "Geometry|Interlace"
# Expect Geometry 600x448, Interlace: None
```

## Pointing a real Inky Frame at it

Configure the device with this server's base URL and the `DEVICE_UUID` from `.env`. Each
refresh the device polls, downloads the JPEG, dithers it on-device, and persists the returned
`state` for the next poll. `refresh` is in minutes (set to 1 here for easy testing — change
`SCREEN.refreshMinutes` in `src/config/device.ts`).

## Project layout

```
src/server.ts            Fastify bootstrap + locally-served /placeholder.jpg
src/config/device.ts     hard-coded device, screen, and asset list
src/routes/device.ts     GET /:uuid handler (cache -> render -> upload -> respond)
src/lib/state.ts         pure state parsing + slideshow advancement (unit-tested)
src/render/slideshow.ts  effective index -> asset path
src/render/pipeline.ts   sharp resize/encode, sha1, placeholder generator
src/storage/supabase.ts  storage upload + renders cache access
assets/slideshow/        committed sample images
migrations/001_renders.sql
```

To bust the render cache after changing screen config, bump `SCREEN.configVersion`.
