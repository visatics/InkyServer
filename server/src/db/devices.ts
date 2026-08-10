/**
 * Device-level config: the devices themselves and their button defaults.
 *
 * Every function takes userId first and filters on it, so ownership is
 * structural rather than a forgettable check in the handler. The service-role
 * key bypasses RLS, which makes this the only thing standing between users.
 */

import { db } from "./client.js";
import type { ButtonAction } from "../lib/types.js";

export interface DeviceRow {
  id: string;
  name: string;
  public_uuid: string;
  width_px: number;
  height_px: number;
  button_count: number;
  default_screen: number;
  updated_at: string;
  created_at: string;
}

export async function listDevices(userId: string): Promise<DeviceRow[]> {
  return (await db()`
    select id, name, public_uuid, width_px, height_px, button_count,
           default_screen, updated_at, created_at
      from devices
     where user_id = ${userId}
     order by created_at`) as unknown as DeviceRow[];
}

export async function getDevice(userId: string, id: string): Promise<DeviceRow | null> {
  const [row] = await db()`
    select id, name, public_uuid, width_px, height_px, button_count,
           default_screen, updated_at, created_at
      from devices
     where id = ${id} and user_id = ${userId}`;
  return (row as DeviceRow | undefined) ?? null;
}

export async function createDevice(
  userId: string,
  d: { name: string; width: number; height: number; buttonCount: number }
): Promise<DeviceRow> {
  const [row] = await db()`
    insert into devices (user_id, name, width_px, height_px, button_count)
    values (${userId}, ${d.name}, ${d.width}, ${d.height}, ${d.buttonCount})
    returning id, name, public_uuid, width_px, height_px, button_count,
              default_screen, updated_at, created_at`;
  return row as DeviceRow;
}

export async function updateDevice(
  userId: string,
  id: string,
  patch: {
    name?: string;
    defaultScreen?: number;
    width?: number;
    height?: number;
    buttonCount?: number;
  }
): Promise<DeviceRow | null> {
  const [row] = await db()`
    update devices set
      name           = coalesce(${patch.name ?? null}, name),
      default_screen = coalesce(${patch.defaultScreen ?? null}, default_screen),
      width_px       = coalesce(${patch.width ?? null}, width_px),
      height_px      = coalesce(${patch.height ?? null}, height_px),
      button_count   = coalesce(${patch.buttonCount ?? null}, button_count)
    where id = ${id} and user_id = ${userId}
    returning id, name, public_uuid, width_px, height_px, button_count,
              default_screen, updated_at, created_at`;
  return (row as DeviceRow | undefined) ?? null;
}

/** Invalidates the old UUID immediately — the device must be reconfigured. */
export async function regenerateUuid(userId: string, id: string): Promise<DeviceRow | null> {
  const [row] = await db()`
    update devices set public_uuid = gen_random_uuid()
     where id = ${id} and user_id = ${userId}
    returning id, name, public_uuid, width_px, height_px, button_count,
              default_screen, updated_at, created_at`;
  return (row as DeviceRow | undefined) ?? null;
}

export async function deleteDevice(userId: string, id: string): Promise<boolean> {
  const rows = await db()`delete from devices where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

// -- device-level button defaults -------------------------------------------

export async function getMappings(
  userId: string,
  deviceId: string
): Promise<Record<string, ButtonAction>> {
  const rows = await db()`
    select m.button, m.action
      from device_button_mappings m
      join devices d on d.id = m.device_id
     where m.device_id = ${deviceId} and d.user_id = ${userId}`;
  return Object.fromEntries(rows.map((r) => [r.button, r.action])) as Record<string, ButtonAction>;
}

/** Returns false when the device is not the caller's, so the route can 404. */
export async function setMapping(
  userId: string,
  deviceId: string,
  button: string,
  action: ButtonAction
): Promise<boolean> {
  const sql = db();
  const owned = await sql`select 1 from devices where id = ${deviceId} and user_id = ${userId}`;
  if (owned.length === 0) return false;
  await sql`
    insert into device_button_mappings (device_id, button, action)
    values (${deviceId}, ${button}, ${sql.json(action as never)})
    on conflict (device_id, button) do update set action = excluded.action`;
  return true;
}

export async function deleteMapping(
  userId: string,
  deviceId: string,
  button: string
): Promise<boolean> {
  const rows = await db()`
    delete from device_button_mappings m
     using devices d
     where m.device_id = d.id
       and m.device_id = ${deviceId}
       and m.button = ${button}
       and d.user_id = ${userId}
    returning m.button`;
  return rows.length > 0;
}
