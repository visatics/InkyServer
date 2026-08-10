# InkyServer

Self-hostable image server for Pimoroni **Inky Frame** colour e-paper devices.

InkyServer renders complete, display-ready screens server-side. The device downloads a
finished full-colour image and dithers it to its own palette on display — so the firmware
stays thin: an unauthenticated HTTP GET, a small JSON response, a conditional download, and a
panel update. RSS/ical parsing, layout, compositing and scaling all live on the server.

```
GET https://<inkyserver>/<device-uuid>?screen=1&idx=0&button=B
```

```json
{
  "image":   "https://<store>/renders/ab12cd….jpg",
  "refresh": 30,
  "sha":     "f1d2d2f924e986ac86fdf7b36c94bcdf32beec15",
  "state":   { "screen": 1, "idx": 0 }
}
```

The server is **stateless** about what any device is currently showing. The client holds a
small `state` object and round-trips it on every request; the server treats it as untrusted
input and re-derives a clean one. `sha` is the SHA-1 of the image bytes, letting the device
skip a slow, battery-costly panel refresh when nothing has changed.

Full specification: [`server/docs/InkyServer-PRD-v1.1.md`](server/docs/InkyServer-PRD-v1.1.md).

## Status

**Phase 0.3 complete and verified end-to-end** against a real Supabase backend.

| Phase | Scope | State |
|---|---|---|
| **0** | Hello-world spike: device GET contract, slideshow, render cache, byte-stable SHA | ✅ Done |
| **0.2** | Button + state engine: `goto` / `set` / `cycle` / `slideshow`, per-screen overrides, fallbacks | ✅ Done |
| **0.3a** | Config in Postgres, auth-scoped `/api`, JWT verification, upload hardening | ✅ Done |
| **0.3b** | Management web app: React SPA, button-mapping matrix, Preview mode | ✅ Done |
| **1** | Providers: `rss`, `calendar`, `remote` — with TTL feed cache and SSRF hardening | ⬜ Not started |

### What works today

- The complete device protocol (PRD §7) — first boot, timer polls, button wakes, 404 on
  unknown UUID, sanitisation of hostile query state.
- Buttons A–E with real effect: device-level defaults, overridden per screen.
- A pure, unit-tested state engine. All state mutation is isolated in one module; providers
  are pure functions of `(screen, state)`.
- Render-on-demand through sharp, with a Postgres-backed render cache giving byte-stable
  output — verified to survive a process restart.
- Images stored in a public Supabase Storage bucket and served at the device's exact
  resolution as baseline (non-progressive) JPEG.
- Graceful degradation: last-known-good render, then a generated placeholder. Never a 5xx
  while a displayable image exists.

### The management app

A React SPA at `/app`, served by the same Fastify process. Register and sign in, add devices
from a preset or a custom spec, manage screens and their images, and edit the button matrix —
rows A–E against "device default" plus every screen, storing the exact `ButtonAction` JSON the
engine consumes. It flags screens no button can reach.

**Preview mode** is an in-browser software device. It calls the same `GET /:uuid?state&button=X`
the firmware calls, holds the returned state exactly as PRD §7.3 describes, and re-requests on
every interaction — so it cannot drift from real device behaviour, and doubles as a live
integration test. The inspector shows the held state, `refresh`, `sha`, and flags when a SHA
repeats ("the device would skip the refresh").

![Preview mode](docs/screenshots/04-preview-boot.png)

### Not built yet

Only the `slideshow` provider is real; `rss`, `calendar` and `remote` are Phase 1, along with
the `feed_cache` table and SSRF hardening. The `debug` screen remains as a test fixture.

### Open decisions

- ~~Frontend framework~~ — settled as React + Vite + TypeScript for Phase 0.3b.
- ~~Whether device/screen config moves into Postgres~~ — done in Phase 0.3a.
- 4-button Inky Impression presets (they already work as custom devices).

## Repository layout

```
server/            Fastify + TypeScript backend
  src/             device route, /api, state engine, cache key, providers, storage
  test/            vitest suites + protocol.sh end-to-end contract check
  migrations/      Postgres schema
  scripts/         fixture seeding, auth verification
  assets/          committed sample slideshow images
  docs/            the PRD
web/               React + Vite SPA, built to web/dist and served at /app
```

Setup, environment variables, the manual test script and firmware-pointing instructions live
in [`server/README.md`](server/README.md).

## Quick start

```bash
cd server
cp .env.example .env          # fill in Supabase URL + service-role key, set a device UUID
npm install
psql "$SUPABASE_DB_URL" -f migrations/001_renders.sql
psql "$SUPABASE_DB_URL" -f migrations/002_web_app.sql
node --env-file=.env scripts/seed-fixture.mjs
npm run dev
```

Build the web app (served at `/app`; the server runs fine without it):

```bash
cd web && npm install && npm run build
```

```bash
npm test                      # 75 tests: state engine, cache keying, JWT, API, uploads
npm run test:protocol         # 33 end-to-end checks against the running server
```

The protocol suite is the one that covers render → upload → cache lookup → served bytes, and
asserts each screen serves its own asset set byte-for-byte.

## Stack

Fastify + TypeScript on fly.io · Supabase (Postgres + Storage) · sharp/libvips for
resize, encode and SVG rasterisation. Renders happen synchronously on the device request —
typically sub-second, so there is no worker queue. Dithering is the device's job.

## Non-goals

No per-device authentication — the unguessable UUID is the only thing protecting a device's
content, which is an accepted trade-off for a hobby project. No real-time push; the device
polls on a timer or button wake. No firmware in this repo — the protocol above is specified
precisely enough to write against.

## Licence

MIT
