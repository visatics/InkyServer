/**
 * Render cache key (PRD §4.1): a deterministic hash of every input that can
 * change the rendered bytes. Byte-stable output for identical inputs is what
 * makes the client's SHA short-circuit (§7.4) work.
 *
 * Two properties are load-bearing:
 *
 * 1. **Screen identity.** Two screens can share a provider (e.g. two slideshows
 *    over different albums) and would otherwise collide and serve each other's
 *    images — the bug fixed in 3a5423d.
 * 2. **updated_at timestamps.** These move whenever config changes (maintained
 *    by triggers in migration 002), so an edit busts exactly the affected
 *    renders while an untouched screen keeps a stable SHA. This replaces the
 *    hand-maintained CONFIG_VERSION constant of Phase 0.2.
 */

import { createHash } from "node:crypto";
import type { DeviceConfig, ScreenConfig } from "./types.js";

export function cacheKeyFor(
  cfg: DeviceConfig,
  screen: ScreenConfig,
  renderState: Record<string, string | number>
): string {
  return createHash("sha256")
    .update(
      [
        cfg.publicUuid,
        cfg.width,
        cfg.height,
        screen.id,
        screen.provider,
        cfg.updatedAt,
        screen.updatedAt,
        JSON.stringify(renderState),
      ].join("|")
    )
    .digest("hex");
}
