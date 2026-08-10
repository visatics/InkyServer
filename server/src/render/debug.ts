/**
 * Throwaway test fixture (delete once Phase 0.3 Preview mode lands): renders
 * the live state and the resolved A–E button legend so the full mapping can be
 * verified on a physical panel before any web UI exists.
 */

import type { DeviceConfig, ScreenConfig } from "../lib/types.js";
import { describeAction, resolveAction } from "../lib/state.js";
import { composeTextImage, type TextLine } from "./pipeline.js";

const BUTTONS = ["A", "B", "C", "D", "E"];

const THEMES: Record<string, { background: string; foreground: string }> = {
  light: { background: "#ffffff", foreground: "#111111" },
  dark: { background: "#141414", foreground: "#eeeeee" },
  blue: { background: "#0b2447", foreground: "#ffffff" },
};

export async function renderDebug(
  cfg: DeviceConfig,
  screen: ScreenConfig,
  renderState: { mode?: string },
  width: number,
  height: number
): Promise<Buffer> {
  const mode = renderState.mode && THEMES[renderState.mode] ? renderState.mode : "light";
  const theme = THEMES[mode];

  const lines: TextLine[] = [
    { text: `Screen ${screen.ordinal} · mode: ${mode}`, size: 36, bold: true },
    { text: "", size: 10 },
    ...BUTTONS.map((b) => ({
      text: `${b}   ${describeAction(resolveAction(cfg, screen.ordinal, b))}`,
      size: 26,
    })),
  ];
  return composeTextImage(width, height, theme.background, theme.foreground, lines);
}
