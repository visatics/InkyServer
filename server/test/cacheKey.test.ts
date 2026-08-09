import { describe, expect, it } from "vitest";
import { cacheKeyFor } from "../src/lib/cacheKey.js";
import { SCREENS, type SlideshowScreen } from "../src/config/device.js";

// Screen 1: sequential slideshow over assets/slideshow-a (N=3).
// Screen 2: random slideshow over assets/slideshow-b (N=2).
// Both are provider="slideshow", so they collide unless the key carries screen identity.
const screen1 = SCREENS.find((s) => s.ordinal === 1) as SlideshowScreen;
const screen2 = SCREENS.find((s) => s.ordinal === 2) as SlideshowScreen;
const screen3 = SCREENS.find((s) => s.ordinal === 3)!;

describe("cache key isolates screens (regression: cross-screen image bleed)", () => {
  it("gives two slideshow screens different keys for the same idx", () => {
    // The bug: screen 2 served screen 1's photo because both hashed to the
    // same key — same provider, same resolved state, no screen identity.
    expect(cacheKeyFor(screen1, { idx: 0 })).not.toBe(cacheKeyFor(screen2, { idx: 0 }));
  });

  it("keeps them distinct at every shared index", () => {
    for (const idx of [0, 1]) {
      expect(cacheKeyFor(screen1, { idx })).not.toBe(cacheKeyFor(screen2, { idx }));
    }
  });
});

describe("cache key still hits for genuinely identical inputs", () => {
  it("is stable across calls for the same screen and state", () => {
    expect(cacheKeyFor(screen1, { idx: 1 })).toBe(cacheKeyFor(screen1, { idx: 1 }));
  });

  it("is a 64-char lowercase hex sha256", () => {
    expect(cacheKeyFor(screen1, { idx: 0 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("cache key varies with everything that changes the image", () => {
  it("differs by slideshow index", () => {
    expect(cacheKeyFor(screen1, { idx: 0 })).not.toBe(cacheKeyFor(screen1, { idx: 1 }));
  });

  it("differs by debug mode", () => {
    expect(cacheKeyFor(screen3, { mode: "light" })).not.toBe(
      cacheKeyFor(screen3, { mode: "dark" })
    );
  });

  it("busts when a screen's asset list changes", () => {
    // Editing assets in the Phase 0.3 UI must invalidate the cache without a
    // manual CONFIG_VERSION bump.
    const edited: SlideshowScreen = { ...screen1, assets: [...screen1.assets, "assets/new.jpg"] };
    expect(cacheKeyFor(edited, { idx: 0 })).not.toBe(cacheKeyFor(screen1, { idx: 0 }));
  });

  it("busts when a screen's fit changes", () => {
    const edited: SlideshowScreen = {
      ...screen1,
      config: { ...screen1.config, fit: "contain" },
    };
    expect(cacheKeyFor(edited, { idx: 0 })).not.toBe(cacheKeyFor(screen1, { idx: 0 }));
  });
});
