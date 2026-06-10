import { createHash } from "node:crypto";
import sharp from "sharp";

export type Fit = "cover" | "contain";

const JPEG_OPTIONS = {
  quality: 90,
  progressive: false, // baseline JPEG — the Inky Frame decoder requires non-progressive
  mozjpeg: false, // keep encoder output deterministic
} as const;

/** Resize a source image to the device resolution and encode as baseline JPEG. */
export async function renderImage(
  assetPath: string,
  width: number,
  height: number,
  fit: Fit
): Promise<Buffer> {
  return sharp(assetPath)
    .resize(width, height, {
      fit,
      position: "centre",
      background: { r: 255, g: 255, b: 255 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg(JPEG_OPTIONS)
    .toBuffer();
}

export function sha1Hex(buffer: Buffer): string {
  return createHash("sha1").update(buffer).digest("hex");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Generated fallback image so the device always has something displayable (PRD §7.5). */
export async function renderPlaceholder(
  width: number,
  height: number,
  message = "InkyServer: render error"
): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#1a1a2e"/>
    <text x="50%" y="50%" fill="#ffffff" font-family="sans-serif" font-size="24"
          text-anchor="middle" dominant-baseline="middle">${message}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg(JPEG_OPTIONS).toBuffer();
}
