/**
 * Assembles the DeviceConfig the state engine consumes from Postgres rows.
 *
 * This is the seam that replaced Phase 0.2's hard-coded constants: the engine's
 * shape is unchanged, only its source moved. Everything the render cache key
 * depends on — resolution, screen identity, both updated_at timestamps — is
 * loaded here, so a stale read would silently break cache invalidation.
 */

import { db } from "./client.js";
import type { ButtonAction, DeviceConfig, Provider, ScreenConfig } from "../lib/types.js";

export async function loadDeviceConfig(publicUuid: string): Promise<DeviceConfig | null> {
  const sql = db();

  const [device] = await sql`
    select id, public_uuid, width_px, height_px, button_count, default_screen, updated_at
      from devices
     where public_uuid = ${publicUuid}`;
  if (!device) return null;

  const [screens, mappings, assets] = await Promise.all([
    sql`select id, ordinal, provider, provider_config, refresh_minutes,
               button_overrides, updated_at
          from screens
         where device_id = ${device.id}
         order by ordinal`,
    sql`select button, action
          from device_button_mappings
         where device_id = ${device.id}`,
    sql`select a.screen_id, a.storage_key
          from slideshow_assets a
          join screens s on s.id = a.screen_id
         where s.device_id = ${device.id}
         order by a.screen_id, a.position, a.uploaded_at`,
  ]);

  const assetsByScreen = new Map<string, string[]>();
  for (const a of assets) {
    const list = assetsByScreen.get(a.screen_id) ?? [];
    list.push(a.storage_key);
    assetsByScreen.set(a.screen_id, list);
  }

  return {
    publicUuid: device.public_uuid,
    width: device.width_px,
    height: device.height_px,
    buttonCount: device.button_count,
    defaultScreen: device.default_screen,
    updatedAt: new Date(device.updated_at).toISOString(),
    screens: screens.map(
      (s): ScreenConfig => ({
        id: s.id,
        ordinal: s.ordinal,
        provider: s.provider as Provider,
        refreshMinutes: s.refresh_minutes,
        config: s.provider_config ?? {},
        assets: assetsByScreen.get(s.id) ?? [],
        buttonOverrides: (s.button_overrides ?? {}) as Partial<Record<string, ButtonAction>>,
        updatedAt: new Date(s.updated_at).toISOString(),
      })
    ),
    buttons: Object.fromEntries(mappings.map((m) => [m.button, m.action])) as Record<
      string,
      ButtonAction
    >,
  };
}
