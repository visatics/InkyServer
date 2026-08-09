/**
 * Render cache key (PRD §4.1): a deterministic hash of every input that can
 * change the rendered bytes. Byte-stable output for identical inputs is what
 * makes the client's SHA short-circuit (§7.4) work.
 *
 * The key must carry *screen identity*, not just the provider name — two
 * screens can share a provider (e.g. two slideshows over different albums) and
 * would otherwise collide and serve each other's images.
 */

import { CONFIG_VERSION, DEVICE, type Screen } from "../config/device.js";
import { sha256Hex } from "../render/pipeline.js";

/**
 * PRD §4.1's `providerConfigVersion`, derived from the screen itself rather
 * than a hand-maintained constant: editing a screen's config or assets changes
 * the fingerprint and so busts the cache on its own.
 */
function configFingerprint(screen: Screen): string {
  return JSON.stringify({
    ordinal: screen.ordinal,
    config: screen.config,
    assets: screen.provider === "slideshow" ? screen.assets : null,
  });
}

export function cacheKeyFor(
  screen: Screen,
  renderState: Record<string, string | number>
): string {
  return sha256Hex(
    [
      DEVICE.uuid,
      DEVICE.width,
      DEVICE.height,
      screen.provider,
      CONFIG_VERSION,
      configFingerprint(screen),
      JSON.stringify(renderState),
    ].join("|")
  );
}
