/**
 * Seeds the Phase 0.2 fixture device into Postgres + Storage.
 *
 * Purpose: test/protocol.sh is a 33-assertion regression suite written against
 * the old hard-coded config. Recreating that exact device as data is what lets
 * it keep proving the DB-driven path behaves identically.
 *
 * The bundled assets are uploaded VERBATIM rather than re-encoded. The render
 * pipeline is deterministic, so rendering the original bytes reproduces the
 * Phase 0.2 SHAs exactly; re-encoding first would double-compress and break the
 * byte-exact assertions. (The /api upload path *does* re-encode — that is for
 * untrusted user input, which this is not.)
 *
 * Idempotent: re-running resets the fixture to a known state.
 *
 * Usage: node --env-file=.env scripts/seed-fixture.mjs
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const DEVICE_UUID = process.env.DEVICE_UUID;
const FIXTURE_USER = "00000000-0000-4000-8000-0000000000f1";
const FIXTURE_EMAIL = "fixture@inkyserver.local";

if (!DEVICE_UUID) throw new Error("DEVICE_UUID must be set");

const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SCREENS = [
  {
    ordinal: 1,
    name: "Slideshow A",
    provider: "slideshow",
    config: { order: "sequential", fit: "cover" },
    refresh: 1,
    overrides: {},
    assets: ["assets/slideshow-a/01.jpg", "assets/slideshow-a/02.jpg", "assets/slideshow-a/03.jpg"],
  },
  {
    ordinal: 2,
    name: "Slideshow B",
    provider: "slideshow",
    config: { order: "random", fit: "cover" },
    refresh: 1,
    overrides: {},
    assets: ["assets/slideshow-b/01.jpg", "assets/slideshow-b/02.jpg"],
  },
  {
    ordinal: 3,
    name: "Debug",
    provider: "debug",
    config: {},
    refresh: 5,
    overrides: {
      D: { type: "set", key: "mode", value: "light" },
      E: { type: "cycle", key: "mode", values: ["light", "dark", "blue"] },
    },
    assets: [],
  },
];

const DEVICE_BUTTONS = {
  A: { type: "goto", screen: 1 },
  B: { type: "goto", screen: 2 },
  C: { type: "goto", screen: 3 },
  D: { type: "slideshow", dir: "next" },
  E: { type: "none" },
};

async function main() {
  await sql`
    insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
    values (${FIXTURE_USER}, '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', ${FIXTURE_EMAIL}, now())
    on conflict (id) do nothing`;

  // Rebuild the device from scratch so re-runs are deterministic.
  await sql`delete from devices where public_uuid = ${DEVICE_UUID}`;
  const [device] = await sql`
    insert into devices (user_id, name, public_uuid, width_px, height_px, button_count, default_screen)
    values (${FIXTURE_USER}, 'Spike Inky Frame 5.7', ${DEVICE_UUID}, 600, 448, 5, 1)
    returning id`;

  for (const [button, action] of Object.entries(DEVICE_BUTTONS)) {
    await sql`
      insert into device_button_mappings (device_id, button, action)
      values (${device.id}, ${button}, ${sql.json(action)})`;
  }

  for (const s of SCREENS) {
    const [screen] = await sql`
      insert into screens (device_id, ordinal, name, provider, provider_config,
                           refresh_minutes, button_overrides)
      values (${device.id}, ${s.ordinal}, ${s.name}, ${s.provider},
              ${sql.json(s.config)}, ${s.refresh},
              ${sql.json(s.overrides)})
      returning id`;

    for (const [position, assetPath] of s.assets.entries()) {
      const bytes = await readFile(path.resolve(assetPath));
      const [row] = await sql`
        insert into slideshow_assets (screen_id, storage_key, original_filename, position)
        values (${screen.id}, 'pending', ${path.basename(assetPath)}, ${position})
        returning id`;
      const key = `${FIXTURE_USER}/${screen.id}/${row.id}.jpg`;
      const { error } = await supabase.storage
        .from("uploads")
        .upload(key, bytes, { upsert: true, contentType: "image/jpeg" });
      if (error) throw new Error(`upload failed for ${assetPath}: ${error.message}`);
      await sql`update slideshow_assets set storage_key = ${key} where id = ${row.id}`;
      console.log(`  uploaded ${assetPath} -> ${key}`);
    }
  }

  console.log(`seeded device ${DEVICE_UUID} (${SCREENS.length} screens)`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
