import path from "node:path";
import type { SlideshowScreen } from "../config/device.js";
import { renderImage } from "./pipeline.js";

/**
 * Pure render: state in, image out. Advancement is a state-transition concern
 * and lives in lib/state.ts — never here.
 */
export async function renderSlideshow(
  screen: SlideshowScreen,
  renderState: { idx?: number },
  width: number,
  height: number
): Promise<Buffer> {
  const n = screen.assets.length;
  const idx = (((renderState.idx ?? 0) % n) + n) % n;
  const assetPath = path.resolve(process.cwd(), screen.assets[idx]);
  return renderImage(assetPath, width, height, screen.config.fit);
}
