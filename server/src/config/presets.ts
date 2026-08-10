/**
 * Predefined Inky Frame models (PRD §2). All have 5 buttons (A–E).
 *
 * Palette is deliberately absent: the device dithers on its own, so the server
 * only needs resolution and button count.
 *
 * Inky Impression boards (4 buttons) are not presets — they already work as
 * custom devices, and the button model is button-count-agnostic.
 */
export const DEVICE_PRESETS = [
  { id: "inky-frame-4.0", name: 'Inky Frame 4.0"', width: 640, height: 400, buttonCount: 5 },
  { id: "inky-frame-5.7", name: 'Inky Frame 5.7"', width: 600, height: 448, buttonCount: 5 },
  { id: "inky-frame-7.3", name: 'Inky Frame 7.3"', width: 800, height: 480, buttonCount: 5 },
] as const;

export type DevicePreset = (typeof DEVICE_PRESETS)[number];

export function findPreset(id: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find((p) => p.id === id);
}
