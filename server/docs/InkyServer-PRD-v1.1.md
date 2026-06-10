# InkyServer — Product Requirements Document

**Version:** 1.1
**Status:** Requirements finalised for initial build
**Owner:** Nigel / Visatics.ai
**Type:** Hobbyist self-hostable image server for Pimoroni Inky Frame e-paper devices

> **Conventions**
> **Decision:** a point where the brief was ambiguous or silent and a choice has been made (with reasoning).
> **Open:** a decision deferred to a later phase (none block the initial build).

> **Changed since v0.1**
> - **Render-on-demand** replaces the BullMQ worker queue + pre-warm scheduler. Redis/BullMQ dropped from the v1.0 stack. Most renders complete in well under a second.
> - **Client-side dithering.** The device dithers the received image to its display colours (native PicoGraphics behaviour). The server sends full-colour images.
> - **Palette removed from the device model.** It was only load-bearing for *server-side* dithering; with on-device dithering, a device needs only name + resolution (reverting to the original brief). The two 7.3" presets collapse into one.
> - Open decisions from v0.1 are now resolved/locked for the initial version (§12).
>
> **Changed since v1.0**
> - Added interactive **Preview mode** in the web UI: an in-browser software device that exercises the real device endpoint, with A–E buttons, a refresh tick, and a state/SHA inspector (§6).

---

## 1. Overview

InkyServer renders complete, display-ready screen images for colour e-paper "Inky Frame" devices. Data fetching, layout, compositing and scaling happen server-side; the device downloads a finished full-colour image and dithers it to its own palette on display. The on-device client stays deliberately thin: an unauthenticated HTTP GET, a small JSON response pointing at an image, a conditional download, and a panel update.

The offloading boundary sits one step before the final dither: the server owns everything that would otherwise bloat the firmware (RSS/ical parsing, layout engines, compositing, scaling), and the device performs only the one operation its libraries already do well — dithering a full-colour image to the panel's colours. The "thin, stable firmware" goal is fully preserved.

This suits the hardware: infrequent updates, ~20–25 s panel refreshes, limited compute/memory, battery operation.

### 1.1 Goals

- Let a registered user define one or more **devices** and, per device, any number of **screens**.
- Render each screen to a full-colour image at the device's exact resolution.
- Serve images over a simple, stateless, unauthenticated, UUID-keyed HTTP contract.
- Support server-defined **button interactions** (screen switching, mode changes) with no client-side configuration.
- Ship with four default providers: `slideshow` (default), `rss`, `calendar`, `remote`.
- Be straightforward to self-host for users wanting stronger security than the public-UUID model.

### 1.2 Non-goals (v1.0)

- **No per-device authentication.** The public UUID is the sole differentiator; accepted for a hobby project. Users wanting more fork and self-host.
- **No client firmware in this repo.** InkyServer defines the protocol (§7) precisely enough to write firmware against; the firmware itself is separate.
- **No real-time push.** The device pulls on a timer or on button wake.
- **No teams/billing/quotas** beyond basic abuse protection.
- **No pixel-editing UI**; users upload assets and configure providers.
- **No user-supplied render code.** Providers are server-defined.
- **No server-side dithering.** The client handles it.

---

## 2. Hardware reference

Predefined devices map to the Pimoroni **Inky Frame** range — all **5 buttons** (A–E) with LED indicators.

| Predefined device | Resolution | Buttons |
|---|---|---|
| Inky Frame 4.0" | 640 × 400 | 5 (A–E) |
| Inky Frame 5.7" | 600 × 448 | 5 (A–E) |
| Inky Frame 7.3" | 800 × 480 | 5 (A–E) |

Palette differs by panel (4.0"/5.7" are 7-colour ACeP; the 7.3" is 7-colour ACeP or 6-colour Spectra 6 depending on generation), but **the server no longer needs it** — the device dithers on its own. Palette is therefore not stored or used in v1.0.

**Note (not predefined):** Inky Impression boards have **4** side buttons (4.0" 600×400, 7.3" 800×480, 13.3" 1600×1200). They work today as **custom** devices; a 4-button preset family is a later candidate. The button model (§8) is button-count-agnostic, so no protocol change is needed.

The ~20–25 s e-paper refresh is a hardware property, not server latency. A button press therefore cannot feel instant — the perceived delay is the panel, not InkyServer.

---

## 3. Core concepts

- **User** — an authenticated web-app account. Owns devices and assets.
- **Device** — a physical Inky Frame (or custom panel). Has a name, resolution, button count, a public **UUID**, and a default screen. The UUID is entered once into the firmware settings.
- **Screen** — a configured view belonging to a device, identified by an ordinal (1, 2, 3…). Has a provider, provider config, refresh, and button-mapping overrides. A device may define any number.
- **State** — a small JSON object the *client* holds and round-trips. Always contains `screen`; providers may add keys (e.g. slideshow index, mode). The server is **stateless** about what a device is currently showing.
- **Provider** — server-side logic turning `(device, screen config, state)` into a full-colour image. Four ship by default; the interface is open.
- **Button mapping** — server-defined rules `(screen, button) → state transition`, defined per device and overridable per screen.

---

## 4. System architecture

```
                ┌─────────────────────────────────────────────┐
                │              InkyServer (fly.io)              │
                │                                               │
  Device  ──────┼──▶ Device API (Fastify)                       │
  (GET /:uuid)  │      1. resolve device + screen + state       │
                │      2. apply button mapping (pure fn)        │
                │      3. render-on-demand (sync, <1s typical): │
                │           • provider produces full-colour img │
                │           • resize to device resolution       │
                │           • encode (JPEG/PNG) + SHA-1          │
                │           • store image, write cache row       │
                │      4. return {image, refresh, sha, state}   │
                │              │            ▲                    │
                │              ▼            │ hit                │
                │        Render cache ──────┘                    │
                │        (Postgres)                              │
                │        Feed-data cache (TTL) for rss/ical/remote│
                │                                               │
  User    ──────┼──▶ Management Web App (auth) ──▶ Postgres      │
                └─────────────────────────────────────────────┘
                        Supabase Storage (public images)
```

**Stack** (aligned to the standard Visatics stack, trimmed for v1.0):

- **Backend:** Fastify + TypeScript on fly.io.
- **Data:** Supabase (Postgres + Storage).
- **Image rendering:** in-process via **sharp** (libvips) for resize/encode/composite; text-based screens composed as SVG and rasterised through sharp (deterministic, fast, no headless browser). **No Redis/BullMQ in v1.0.**
- **Email:** Resend (verification, reset).
- **Observability:** Sentry + PostHog (web app only; device traffic excluded from product analytics).

### 4.1 Rendering strategy

**Decision:** render-on-demand, synchronously, on the device request. Typical render (resize + encode, or SVG compose + rasterise) is sub-second. No worker queue.

Two caches keep this clean:

1. **Render cache** (lazy). Keyed on a deterministic hash of inputs that affect output: `deviceId + resolution + provider + providerConfigVersion + resolvedState (minus volatile keys)`. A cache hit returns the existing image URL + SHA without re-rendering. This also guarantees **byte-stable output for identical inputs**, which is what makes the client's SHA short-circuit (§7.4) work — without it, encoder non-determinism could change the SHA on every poll.
2. **Feed-data cache** (TTL) for `rss`/`calendar`/`remote`. External fetches are the one slow/failure-prone step in an otherwise fast path, so the *fetched data* is cached with a TTL tied to the screen's `refresh_minutes`. Most requests render from warm data; only the first request after expiry re-fetches.

**Decision — fetch safety on the request thread:** because external fetches now happen inline, each has a hard timeout (e.g. 3 s) and falls back to last-known-good data; a dead feed never makes the device wait or fail (§7.5). If render-on-demand ever proves insufficient at scale, a worker queue is the documented upgrade path — but it is explicitly out of scope for v1.0.

---

## 5. Data model

Indicative Postgres tables. Not final DDL.

**users** — `id`, `email` (unique), `password_hash`, `email_verified_at`, `created_at`

**devices**
- `id`, `user_id` (FK), `name`
- `public_uuid` (UUIDv4, unique, indexed) — the device key
- `width_px`, `height_px`
- `button_count` (default 5)
- `default_screen` (int, default 1)
- `created_at`

**screens**
- `id`, `device_id` (FK)
- `ordinal` (int; unique per device) — the `screen` number used in state and button mappings
- `name`, `provider` (enum), `provider_config` (JSONB)
- `refresh_minutes` (int, nullable; `0`/null = no auto-refresh)
- `button_overrides` (JSONB; §8)
- `created_at`, `updated_at`

**device_button_mappings** — `device_id` (FK), `button` (A–E), `action` (JSON; §8)

**slideshow_assets** — `id`, `screen_id` (FK), `storage_key`, `original_filename`, `position` (int), `uploaded_at`

**renders** (cache) — `id`, `screen_id`, `cache_key` (unique, indexed), `image_url`, `sha1`, `state_out` (JSONB), `rendered_at`, `expires_at`

**feed_cache** — `id`, `screen_id`, `source_url`, `payload` (JSONB/blob), `fetched_at`, `expires_at`

---

## 6. Management web app (user-facing)

Authenticated web app.

1. **Auth:** register (email + password), email verification, login, password reset, rate-limited. (Auth is for management only; devices stay unauthenticated.)
2. **Devices:**
   - Add via a **predefined** model (auto-fills resolution + button count) **or** a **custom** device.
   - **Custom device fields:** name, width, height, button count (default 5). *(Reverted to the original brief — palette is no longer needed since the device dithers.)*
   - Show `public_uuid` with copy button + short setup instructions.
   - Regenerate UUID (invalidates the old one) and delete device.
3. **Screens:** per device, CRUD any number; set provider, config, `refresh_minutes`, ordinal, per-screen button overrides; reorder; mark device default.
4. **Button-mapping editor:** a matrix — rows = buttons A–E, columns = "device default" + each screen — assigning an action per cell (§8), with a resolved-transition preview to catch dead-ends.
5. **Provider config UIs:**
   - Slideshow: upload/reorder/delete images; order = `sequential` | `random`; fit = `cover` | `contain`.
   - RSS: feed URL, item count, title/description toggles, source label.
   - Calendar: ical URL, `week` | `month`, week start, timezone.
   - Remote: endpoint URL, optional headers.
6. **Interactive preview ("Preview mode").** Launch any device into an in-browser emulator that exercises the **real device protocol** against the live backend, so a configuration can be fully tested without a physical device and without waiting for a real refresh cycle.
   - Renders the current screen with **A–E buttons** beneath it (only as many as the device's `button_count`).
   - **Decision — it is a software device, not a separate code path.** Preview mode calls the same `GET /:uuid?state&button=X` endpoint the firmware uses, holds the returned `state` client-side exactly as §7.3 describes, and re-requests on each interaction. This guarantees the preview cannot drift from real device behaviour, makes it a de-facto reference implementation of the client lifecycle, and turns it into a live integration test of the protocol.
   - **Button press:** sends the held state plus `button=<X>`; the returned image + state replace the current ones, so screen switches, mode changes and slideshow stepping are all testable by clicking.
   - **Refresh tick:** a "tick refresh" control (plus an optional accelerated auto-advance) replays a timer wake without waiting the real `refresh_minutes`, so periodic screens and sequential slideshows can be stepped through quickly.
   - **Inspector:** shows the live `state` JSON and the returned `refresh` and `sha`, and flags when a `sha` matches the previous one ("unchanged — the device would skip the refresh") so the SHA short-circuit (§7.4) is visible and testable.
   - **Fidelity note:** the preview shows the full-colour image the server sends; the on-device dithered appearance is approximate (true in-browser dithering remains the future nicety in §14).

**Open — frontend framework:** decided at Phase 1; not protocol-relevant.

---

## 7. Device protocol (the contract)

The stable interface the firmware targets. Minimal and additive.

### 7.1 Request

```
GET https://<inkyserver>/<device-uuid>?<state...>&button=<X>
```

- Path is the device `public_uuid`. No auth headers.
- The query string carries the **current state** the client holds. On first boot the client has no state, so it sends **no** state params; the server applies the device default screen.
- **Decision — button transport:** optional `button` (A–E) reports which button woke the device this cycle. It is a **transient event, never stored or echoed as state**. Timer/first-boot wake omits it.
- Reserved state key: `screen` (int). Providers may add keys (e.g. `idx`, `mode`). Keep state small and query-string-safe.

Example sequence:

```
First boot:               GET /<uuid>
Server returns state:     {"screen":1,"idx":0}
Next timer poll:          GET /<uuid>?screen=1&idx=0
User presses button B:    GET /<uuid>?screen=1&idx=0&button=B
```

### 7.2 Response

`200 OK`, `application/json`:

```json
{
  "image":   "https://<store>/renders/ab12cd....jpg",
  "refresh": 30,
  "sha":     "f1d2d2f924e986ac86fdf7b36c94bcdf32beec15",
  "state":   { "screen": 1, "idx": 0 }
}
```

- `image` — public URL of the **full-colour** image at the device's resolution. The device dithers on display.
- `refresh` — **minutes** until the next poll. **Decision:** `0`/omitted = no auto-refresh; re-poll only on button wake. (The brief contradicted minutes vs seconds; minutes is canonical.)
- `sha` — SHA-1 of the **image file bytes** (lower-case hex), for change detection only (not security).
- `state` — the new state the client must persist and send next time. Always includes `screen`. Replaces previous state wholesale.

### 7.3 Client lifecycle (informative, for firmware authors)

1. On wake, set `button=<X>` if a button woke the device; omit for timer/manual.
2. GET with persisted state (+ `button` if applicable).
3. Persist the returned `state` (always, even if the image is unchanged).
4. Compare returned `sha` to the last displayed SHA. **If equal, skip the download and panel refresh** — saving bandwidth and a slow, battery-costly update.
5. If different, download `image`, decode + dither to the panel, update, store the new SHA.
6. Sleep until `refresh` minutes elapse or a button wakes it.

### 7.4 SHA short-circuit semantics

`sha` lets the client decide whether a panel refresh is needed **without downloading the image**. The server computes it over the exact bytes served. Because renders are cache-keyed on inputs (§4.1), unchanged inputs yield a stable SHA across polls, so a static screen never needlessly refreshes.

### 7.5 Errors and edge cases

- **Unknown UUID:** `404` + small JSON body (firmware surfaces a setup hint).
- **Render not possible right now:** return `200` with a generated placeholder image at device resolution + a short `refresh`. **Decision:** always return a displayable image; never leave the panel blank.
- **Provider failure (e.g. dead feed):** serve last-known-good (render or feed data) if available; otherwise a generated error screen at device resolution. Never 5xx if a usable image exists.
- **Invalid/garbage state:** sanitise; fall back to device default screen + clean state. Client state is user-controllable via URL and must never be trusted.
- **Versioning:** server version header; reserve a future `v` param for breaking changes. v1.0 is unversioned-but-additive.

---

## 8. State & button interaction model

### 8.1 State

A small client-held JSON object, round-tripped each request, treated as untrusted input; the server re-derives a clean `state_out`. Reserved key: `screen`. Providers own additional keys.

### 8.2 Button mappings

Resolves `(currentScreen, button) → action`. Defined at **device level** (apply on every screen), overridable **per screen**. Resolution order: screen override → device default → no-op.

**Action types (v1.0):**

| Action | Shape | Effect |
|---|---|---|
| Switch screen | `{ "type": "goto", "screen": N }` | Sets `state.screen = N`, resets provider keys to that screen's defaults |
| Set state key | `{ "type": "set", "key": "mode", "value": "dark" }` | Merges a key into state |
| Cycle state key | `{ "type": "cycle", "key": "mode", "values": ["light","dark"] }` | Advances a key through a list (wraps) |
| Slideshow next/prev | `{ "type": "slideshow", "dir": "next"\|"prev" }` | Advances/rewinds the slideshow index |
| No-op | `{ "type": "none" }` | Button does nothing here |

Covers the brief's examples: "button A on any screen → goto screen 1" (device default `goto`); "button C on screen 2 → change mode" (screen-2 override `set`/`cycle`).

**Decision — pure function:** `apply(mapping, state, button) → state_out` does no I/O. Transitions are deterministic and unit-testable; the resulting render is then a cache lookup or a fast on-demand render.

**Decision — button-count-agnostic:** mappings are keyed by button label (A–E for Inky Frame, A–D for 4-button Impression), so 4-button devices need no protocol change later.

---

## 9. Image providers

### 9.1 Provider interface

```ts
interface ScreenProvider {
  // Inputs that affect output, for cache keying.
  cacheKeyInputs(ctx: RenderContext): unknown;

  // Produce a full-colour image at device resolution.
  // May fetch external data (via the TTL-cached fetch helper).
  render(ctx: RenderContext): Promise<RenderResult>;

  // Optional default/derived state when a screen is entered.
  initialState?(ctx: RenderContext): Record<string, unknown>;
}
```

`RenderContext` includes device `{width, height}`, screen config, and resolved state. Providers output **full colour**; on-device dithering handles the panel. **Decision — output format per provider:** non-progressive **JPEG** for photographic content (slideshow), **PNG** for graphical/text content (rss, calendar) where sharp edges matter and JPEG noise would dither badly. Progressive JPEG is never emitted (the firmware decoder requires baseline).

### 9.2 `slideshow` (default)

- Any number of uploaded images, each scaled to the device resolution (`cover` default, centre crop; `contain` optional).
- Order: `sequential` or `random`.
- **Decision — stateless sequencing:** for `sequential`, the current index lives in state (`idx`); each refresh or slideshow button advances it, returned in `state_out`; a given `idx` renders deterministically and caches. For `random`, the server picks per request (may seed from `idx`/time to avoid immediate repeats).
- Assigned to a new device's first screen by default.

### 9.3 `rss`

- Config: feed URL, item count, show-title, show-description, source label.
- Fetches + parses the feed (TTL-cached), lays out items to fit (truncation + pagination), renders to PNG.
- `refresh_minutes` drives re-fetch cadence; failures fall back to last-known-good.

### 9.4 `calendar`

- Config: ical URL, `week` | `month`, week start, timezone.
- Fetches + parses ical (TTL-cached), renders a week/month grid with events to PNG.
- A `mode` state key toggles week/month (good fit for a `cycle` button action).

### 9.5 `remote`

- Config: endpoint URL, optional headers.
- Fetches the endpoint, expecting `{ "image": "<url>", "state": {...}, "refresh": N }`. InkyServer fetches the referenced image, normalises it to the device resolution/format, computes the SHA, and serves it.
- **Decision — keep, re-host by default:** it overlaps the base contract but lets a user offload all rendering to their own service while keeping InkyServer's device management, state/button model, format normalisation and SHA handling. Re-hosting (copy to our store) gives stable SHAs and format control; an opt-out "trust remote image as-is" flag proxies the URL directly for users who want it.

### 9.6 Build order

`slideshow` ships first (it's the default). `rss`, `calendar`, `remote` are independent, built in that priority order.

---

## 10. Image rendering pipeline

The simplified v1.0 pipeline (no dithering step):

1. Provider produces a full-colour raster (photographic via sharp resize; graphical via SVG → sharp rasterise) at device resolution.
2. Encode to the per-provider format (§9.1): non-progressive JPEG or PNG.
3. Compute SHA-1 of the encoded bytes.
4. Store to Supabase Storage (public); write a `renders` cache row.

**Memory caveat (firmware-side, flagged):** the 4.0"/5.7" boards (Pico W, 520 KB SRAM) are tighter than the 7.3" (Pico 2 W, 8 MB PSRAM). Decoding a full-resolution image must fit. Server format/encoding choices affect this — validate on the smallest target early. (Server-side, this is just an encoding parameter; it is a real constraint for the firmware author.)

---

## 11. Security, privacy & abuse

- **UUIDv4** (unguessable) is the only thing protecting a device's content. State the trade-off plainly in the UI; offer regeneration.
- **Rate limiting** per UUID and per IP on the device endpoint (generous — devices poll rarely).
- **No PII in image URLs or state.** State travels in query strings (logs/proxies); keep it to screen/index/mode. Document for `remote` users too.
- **SSRF protection** on `rss`/`calendar`/`remote` fetches: block private/link-local/loopback ranges; http/https only; cap size + timeout. User-supplied URLs fetched server-side are the main attack surface and must be hardened from day one.
- **Upload validation** for slideshow assets: type/size limits, strip EXIF, re-encode.
- **Auth:** argon2/bcrypt, verification, reset, rate-limited login.

---

## 12. Resolved decisions (locked for v1.0)

1. **Rendering:** synchronous render-on-demand; no worker queue. (§4.1)
2. **Dithering:** client-side; server sends full colour. (§1, §10)
3. **Object store:** **Supabase Storage** (public bucket) for v1.0 — one fewer service, already in the stack; egress is negligible at hobby scale. Backblaze B2 + Cloudflare is the documented upgrade path if polling volume grows. (§10)
4. **Output format:** non-progressive JPEG for photographic, PNG for graphical/text. (§9.1)
5. **`remote` provider:** kept; re-host by default with a trust-as-is proxy opt-out. (§9.5)
6. **Device model:** name + resolution + button count; no palette. (§5, §6)

**Open (later phases):** web-app framework (§6); 4-button Impression presets (§2); worker queue only if render-on-demand proves insufficient (§4.1).

---

## 13. Phased build plan

Each phase produces a discrete Claude Code build prompt.

- **Phase 0 — hello-world spike.** Fastify + Postgres + Supabase Storage. One hard-coded device (UUID, resolution), one hard-coded `slideshow` screen with bundled images. Full device GET contract end-to-end: returns `{image, refresh, sha, state}`, advances `idx`, resizes to resolution, serves a real JPEG, byte-stable SHA via the render cache. Goal: prove the protocol against a real panel.
- **Phase 0.2 — button + state engine.** Pure `apply(mapping, state, button)`, device + per-screen mappings, multiple hard-coded screens, `goto`/`set`/`cycle`/`slideshow` actions. Placeholder, last-known-good, and error-screen behaviour.
- **Phase 0.3 — management web app (core).** Auth, device CRUD (predefined + custom), screen CRUD, button-mapping matrix, slideshow asset upload/order, and interactive **Preview mode** (a software device driving the real GET endpoint, with A–E buttons, a refresh tick, and a live state/SHA inspector). The button + state engine from Phase 0.2 is what makes Preview mode possible.
- **Phase 1 — providers.** `rss`, then `calendar`, then `remote` — each with config UI, the TTL feed-data cache, SSRF hardening, and failure fallback. Polish, docs, clean self-host guide.

---

## 14. Future / out of scope

- 4-button Inky Impression presets (already work as custom).
- Worker queue / pre-warm scheduler (only if render-on-demand proves insufficient).
- True dithered in-browser preview.
- Additional providers (weather, cloud photos, dashboards, now-playing).
- Optional per-device shared secret as a lightweight auth upgrade.
- Theming/templates for text-based providers.
- **Non-e-ink clients** (TV/desktop screensavers, web dashboards). The protocol is device-class-agnostic: any client that can GET the JSON, download the image and display it is supported. A screensaver client driving a `slideshow` screen needs **no server changes** — it simply skips the on-device dither; resolution and refresh come from the device record like any other device.
