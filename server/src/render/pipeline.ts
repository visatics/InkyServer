import { createHash } from "node:crypto";
import sharp from "sharp";

export type Fit = "cover" | "contain";

const JPEG_OPTIONS = {
  quality: 90,
  progressive: false, // baseline JPEG — the Inky Frame decoder requires non-progressive
  mozjpeg: false, // keep encoder output deterministic
} as const;

/**
 * Resize a source image to the device resolution and encode as baseline JPEG.
 *
 * Accepts a path or the raw bytes — sharp treats them identically, and the
 * encode options must stay exactly as they are: any drift changes every SHA in
 * the render cache and would force a needless refresh on every panel.
 */
export async function renderImage(
  source: string | Buffer,
  width: number,
  height: number,
  fit: Fit
): Promise<Buffer> {
  return sharp(source)
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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface TextLine {
  text: string;
  size?: number;
  bold?: boolean;
}

/**
 * Compose a full-resolution baseline JPEG of text lines on a solid background.
 * Shared by the debug provider and the placeholder generator.
 */
export async function composeTextImage(
  width: number,
  height: number,
  background: string,
  foreground: string,
  lines: TextLine[]
): Promise<Buffer> {
  const lineGap = 14;
  const totalHeight = lines.reduce((sum, l) => sum + (l.size ?? 24) + lineGap, -lineGap);
  let y = Math.round((height - totalHeight) / 2);
  const texts = lines
    .map((line) => {
      const size = line.size ?? 24;
      y += size;
      const el = `<text x="50%" y="${y - size / 4}" fill="${foreground}" font-family="sans-serif" font-size="${size}" ${line.bold ? 'font-weight="bold"' : ""} text-anchor="middle">${escapeXml(line.text)}</text>`;
      y += lineGap;
      return el;
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${background}"/>
    ${texts}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg(JPEG_OPTIONS).toBuffer();
}

/** Generated fallback image so the device always has something displayable (PRD §7.5). */
export async function renderPlaceholder(
  width: number,
  height: number,
  message = "InkyServer: render error"
): Promise<Buffer> {
  return composeTextImage(width, height, "#1a1a2e", "#ffffff", [{ text: message }]);
}
