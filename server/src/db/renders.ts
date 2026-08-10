/**
 * Render cache access (PRD §4.1). Replaces the Supabase-client version from
 * Phase 0, adding screen linkage so last-known-good can be scoped per screen
 * and — unlike the Phase 0.2 in-memory map — survive a process restart.
 */

import { db } from "./client.js";
import type { State } from "../lib/types.js";

export interface RenderRow {
  cache_key: string;
  image_url: string;
  sha1: string;
  state_out: State;
  screen_id: string | null;
}

export async function getCachedRender(cacheKey: string): Promise<RenderRow | null> {
  const [row] = await db()`
    select cache_key, image_url, sha1, state_out, screen_id
      from renders
     where cache_key = ${cacheKey}`;
  return (row as RenderRow | undefined) ?? null;
}

export async function insertRender(row: RenderRow): Promise<void> {
  await db()`
    insert into renders (cache_key, image_url, sha1, state_out, screen_id)
    values (${row.cache_key}, ${row.image_url}, ${row.sha1},
            ${JSON.stringify(row.state_out)}::jsonb, ${row.screen_id})
    on conflict (cache_key) do update
      set image_url = excluded.image_url,
          sha1      = excluded.sha1,
          state_out = excluded.state_out,
          screen_id = excluded.screen_id`;
}

/**
 * The most recent successful render for a screen (PRD §7.5). Serving this on a
 * render failure keeps a panel showing something real rather than a placeholder.
 */
export async function getLastGoodForScreen(screenId: string): Promise<RenderRow | null> {
  const [row] = await db()`
    select cache_key, image_url, sha1, state_out, screen_id
      from renders
     where screen_id = ${screenId}
     order by rendered_at desc
     limit 1`;
  return (row as RenderRow | undefined) ?? null;
}
