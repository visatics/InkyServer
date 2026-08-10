/**
 * Screen-level config: screens and their slideshow assets.
 *
 * Ownership reaches these through devices.user_id, so every query joins back to
 * devices rather than trusting the caller to have checked.
 */

import { db } from "./client.js";
import type { ButtonAction, Provider } from "../lib/types.js";

export interface ScreenRow {
  id: string;
  device_id: string;
  ordinal: number;
  name: string;
  provider: Provider;
  provider_config: Record<string, unknown>;
  refresh_minutes: number | null;
  button_overrides: Record<string, ButtonAction>;
  updated_at: string;
}

export interface AssetRow {
  id: string;
  screen_id: string;
  storage_key: string;
  original_filename: string | null;
  position: number;
}

export async function listScreens(userId: string, deviceId: string): Promise<ScreenRow[]> {
  return (await db()`
    select s.id, s.device_id, s.ordinal, s.name, s.provider, s.provider_config,
           s.refresh_minutes, s.button_overrides, s.updated_at
      from screens s
      join devices d on d.id = s.device_id
     where s.device_id = ${deviceId} and d.user_id = ${userId}
     order by s.ordinal`) as unknown as ScreenRow[];
}

export async function getScreenOwned(userId: string, screenId: string): Promise<ScreenRow | null> {
  const [row] = await db()`
    select s.id, s.device_id, s.ordinal, s.name, s.provider, s.provider_config,
           s.refresh_minutes, s.button_overrides, s.updated_at
      from screens s
      join devices d on d.id = s.device_id
     where s.id = ${screenId} and d.user_id = ${userId}`;
  return (row as ScreenRow | undefined) ?? null;
}

export async function createScreen(
  userId: string,
  deviceId: string,
  s: {
    name: string;
    provider: Provider;
    providerConfig?: Record<string, unknown>;
    refreshMinutes?: number | null;
  }
): Promise<ScreenRow | null> {
  const sql = db();
  const owned = await sql`select 1 from devices where id = ${deviceId} and user_id = ${userId}`;
  if (owned.length === 0) return null;

  const [{ next }] = await sql`
    select coalesce(max(ordinal), 0) + 1 as next from screens where device_id = ${deviceId}`;
  const [row] = await sql`
    insert into screens (device_id, ordinal, name, provider, provider_config, refresh_minutes)
    values (${deviceId}, ${next}, ${s.name}, ${s.provider},
            ${sql.json((s.providerConfig ?? {}) as never)}, ${s.refreshMinutes ?? null})
    returning id, device_id, ordinal, name, provider, provider_config,
              refresh_minutes, button_overrides, updated_at`;
  return row as ScreenRow;
}

export async function updateScreen(
  userId: string,
  screenId: string,
  patch: {
    name?: string;
    providerConfig?: Record<string, unknown>;
    refreshMinutes?: number | null;
    buttonOverrides?: Record<string, ButtonAction>;
  }
): Promise<ScreenRow | null> {
  const sql = db();
  if (!(await getScreenOwned(userId, screenId))) return null;
  const [row] = await sql`
    update screens set
      name             = coalesce(${patch.name ?? null}, name),
      provider_config  = coalesce(${
        patch.providerConfig === undefined ? null : sql.json(patch.providerConfig as never)
      }, provider_config),
      refresh_minutes  = ${patch.refreshMinutes === undefined ? sql`refresh_minutes` : patch.refreshMinutes},
      button_overrides = coalesce(${
        patch.buttonOverrides === undefined ? null : sql.json(patch.buttonOverrides as never)
      }, button_overrides)
    where id = ${screenId}
    returning id, device_id, ordinal, name, provider, provider_config,
              refresh_minutes, button_overrides, updated_at`;
  return (row as ScreenRow | undefined) ?? null;
}

/**
 * Rewrites ordinals to match the given order. Uses a negative-offset two-pass
 * update because (device_id, ordinal) is unique — assigning final values
 * directly would collide mid-way.
 */
export async function reorderScreens(
  userId: string,
  deviceId: string,
  orderedIds: string[]
): Promise<boolean> {
  const sql = db();
  const owned = await sql`select 1 from devices where id = ${deviceId} and user_id = ${userId}`;
  if (owned.length === 0) return false;

  const existing = await sql`select id from screens where device_id = ${deviceId}`;
  const ids = new Set(existing.map((r) => r.id));
  if (ids.size !== orderedIds.length || !orderedIds.every((id) => ids.has(id))) return false;

  await sql.begin(async (tx) => {
    for (const [i, id] of orderedIds.entries()) {
      await tx`update screens set ordinal = ${-(i + 1)} where id = ${id}`;
    }
    for (const [i, id] of orderedIds.entries()) {
      await tx`update screens set ordinal = ${i + 1} where id = ${id}`;
    }
  });
  return true;
}

export async function deleteScreen(userId: string, screenId: string): Promise<boolean> {
  const rows = await db()`
    delete from screens s
     using devices d
     where s.device_id = d.id and s.id = ${screenId} and d.user_id = ${userId}
    returning s.id`;
  return rows.length > 0;
}

// -- slideshow assets --------------------------------------------------------

export async function listAssets(userId: string, screenId: string): Promise<AssetRow[]> {
  return (await db()`
    select a.id, a.screen_id, a.storage_key, a.original_filename, a.position
      from slideshow_assets a
      join screens s  on s.id = a.screen_id
      join devices d  on d.id = s.device_id
     where a.screen_id = ${screenId} and d.user_id = ${userId}
     order by a.position, a.uploaded_at`) as unknown as AssetRow[];
}

/**
 * The caller supplies the id so it can derive the storage key before the object
 * is uploaded, keeping the row and the object consistent in one insert.
 */
export async function createAsset(
  id: string,
  screenId: string,
  storageKey: string,
  originalFilename: string | null
): Promise<AssetRow> {
  const sql = db();
  const [{ next }] = await sql`
    select coalesce(max(position), -1) + 1 as next
      from slideshow_assets where screen_id = ${screenId}`;
  const [row] = await sql`
    insert into slideshow_assets (id, screen_id, storage_key, original_filename, position)
    values (${id}, ${screenId}, ${storageKey}, ${originalFilename}, ${next})
    returning id, screen_id, storage_key, original_filename, position`;
  return row as AssetRow;
}

export async function reorderAssets(
  userId: string,
  screenId: string,
  orderedIds: string[]
): Promise<boolean> {
  const sql = db();
  if (!(await getScreenOwned(userId, screenId))) return false;
  const existing = await sql`select id from slideshow_assets where screen_id = ${screenId}`;
  const ids = new Set(existing.map((r) => r.id));
  if (ids.size !== orderedIds.length || !orderedIds.every((id) => ids.has(id))) return false;

  await sql.begin(async (tx) => {
    for (const [i, id] of orderedIds.entries()) {
      await tx`update slideshow_assets set position = ${i} where id = ${id}`;
    }
  });
  return true;
}

/** Returns the storage key so the caller can delete the object too. */
export async function deleteAsset(userId: string, assetId: string): Promise<string | null> {
  const rows = await db()`
    delete from slideshow_assets a
     using screens s, devices d
     where a.screen_id = s.id and s.device_id = d.id
       and a.id = ${assetId} and d.user_id = ${userId}
    returning a.storage_key`;
  return rows.length > 0 ? (rows[0].storage_key as string) : null;
}
