import path from "node:path";
import { SLIDESHOW_ASSETS } from "../config/device.js";

/** Resolve the effective slideshow index to an absolute asset path. */
export function assetForIndex(effectiveIdx: number): string {
  const rel = SLIDESHOW_ASSETS[effectiveIdx];
  if (!rel) throw new Error(`no slideshow asset at index ${effectiveIdx}`);
  return path.resolve(process.cwd(), rel);
}
