export const DEVICE = {
  uuid: process.env.DEVICE_UUID!, // the public key the client uses
  name: "Spike Inky Frame 5.7",
  width: 600, // Inky Frame 5.7" (PRD §2)
  height: 448,
  buttonCount: 5,
  defaultScreen: 1,
};

// Two committed asset sets for the slideshow screens (different counts, to prove per-screen N).
const SET_A = [
  "assets/slideshow-a/01.jpg",
  "assets/slideshow-a/02.jpg",
  "assets/slideshow-a/03.jpg",
];
const SET_B = ["assets/slideshow-b/01.jpg", "assets/slideshow-b/02.jpg"];

export type SlideshowScreen = {
  ordinal: number;
  provider: "slideshow";
  refreshMinutes: number;
  config: { order: "sequential" | "random"; fit: "cover" | "contain" };
  assets: string[];
};

export type DebugScreen = {
  ordinal: number;
  provider: "debug";
  refreshMinutes: number;
  config: Record<string, never>;
};

export type Screen = SlideshowScreen | DebugScreen;

export const SCREENS: Screen[] = [
  { ordinal: 1, provider: "slideshow", refreshMinutes: 1, config: { order: "sequential", fit: "cover" }, assets: SET_A },
  { ordinal: 2, provider: "slideshow", refreshMinutes: 1, config: { order: "random", fit: "cover" }, assets: SET_B },
  { ordinal: 3, provider: "debug", refreshMinutes: 5, config: {} },
];

export const CONFIG_VERSION = 1; // bump to bust the render cache when config/mappings change

export type ButtonAction =
  | { type: "goto"; screen: number }
  | { type: "set"; key: string; value: string | number }
  | { type: "cycle"; key: string; values: (string | number)[] }
  | { type: "slideshow"; dir: "next" | "prev" }
  | { type: "none" };

// Device-level defaults: apply on every screen unless a screen overrides the button.
export const DEVICE_BUTTONS: Record<string, ButtonAction> = {
  A: { type: "goto", screen: 1 },
  B: { type: "goto", screen: 2 },
  C: { type: "goto", screen: 3 },
  D: { type: "slideshow", dir: "next" },
  E: { type: "none" },
};

// Per-screen overrides: screen ordinal -> (button -> action).
export const SCREEN_BUTTON_OVERRIDES: Record<number, Partial<Record<string, ButtonAction>>> = {
  3: {
    D: { type: "set", key: "mode", value: "light" },
    E: { type: "cycle", key: "mode", values: ["light", "dark", "blue"] },
  },
};
