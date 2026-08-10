import type { DeviceConfig, ScreenConfig } from "../src/lib/types.js";

const screen = (over: Partial<ScreenConfig> & { ordinal: number }): ScreenConfig => ({
  id: `screen-${over.ordinal}`,
  provider: "slideshow",
  refreshMinutes: 1,
  config: { order: "sequential", fit: "cover" },
  assets: [],
  buttonOverrides: {},
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/**
 * The Phase 0.2 hard-coded device, expressed as data.
 *
 * Screen 1: sequential slideshow, N=3. Screen 2: random slideshow, N=2.
 * Screen 3: debug, with D/E overridden. Device defaults A/B/C -> goto 1/2/3,
 * D -> slideshow next, E -> none. Keeping this identical to the deleted
 * constants is what lets the Phase 0.2 test suite keep its meaning.
 */
export const testConfig = (): DeviceConfig => ({
  publicUuid: "2cd55b67-7d6d-4e93-9a39-c164e96cd5bc",
  width: 600,
  height: 448,
  buttonCount: 5,
  defaultScreen: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  screens: [
    screen({ ordinal: 1, assets: ["a/01.jpg", "a/02.jpg", "a/03.jpg"] }),
    screen({
      ordinal: 2,
      config: { order: "random", fit: "cover" },
      assets: ["b/01.jpg", "b/02.jpg"],
    }),
    screen({
      ordinal: 3,
      provider: "debug",
      refreshMinutes: 5,
      config: {},
      buttonOverrides: {
        D: { type: "set", key: "mode", value: "light" },
        E: { type: "cycle", key: "mode", values: ["light", "dark", "blue"] },
      },
    }),
  ],
  buttons: {
    A: { type: "goto", screen: 1 },
    B: { type: "goto", screen: 2 },
    C: { type: "goto", screen: 3 },
    D: { type: "slideshow", dir: "next" },
    E: { type: "none" },
  },
});
