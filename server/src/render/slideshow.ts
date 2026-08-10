import type { ScreenConfig } from "../lib/types.js";
import { downloadUpload } from "../storage/supabase.js";
import { renderImage } from "./pipeline.js";

/**
 * Pure render: state in, image out. Advancement is a state-transition concern
 * and lives in lib/state.ts — never here.
 *
 * From Phase 0.3 the source bytes come from the private `uploads` bucket rather
 * than a bundled path. A screen with no assets throws, and the route falls back
 * to last-known-good or the placeholder (PRD §7.5).
 */
export async function renderSlideshow(
  screen: ScreenConfig,
  renderState: { idx?: number },
  width: number,
  height: number
): Promise<Buffer> {
  const n = screen.assets.length;
  if (n === 0) throw new Error(`screen ${screen.ordinal} has no slideshow assets`);
  const idx = (((renderState.idx ?? 0) % n) + n) % n;
  const bytes = await downloadUpload(screen.assets[idx]);
  return renderImage(bytes, width, height, screen.config.fit ?? "cover");
}
