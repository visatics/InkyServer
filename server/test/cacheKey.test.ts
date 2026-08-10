import { describe, expect, it } from "vitest";
import { cacheKeyFor } from "../src/lib/cacheKey.js";
import { testConfig } from "./fixtures.js";

const cfg = testConfig();
const [s1, s2, s3] = cfg.screens;

describe("cache key isolates screens (regression from 3a5423d)", () => {
  it("gives two slideshow screens different keys for the same idx", () => {
    // The bug: screen 2 served screen 1's photo because both hashed to the
    // same key — same provider, same resolved state, no screen identity.
    expect(cacheKeyFor(cfg, s1, { idx: 0 })).not.toBe(cacheKeyFor(cfg, s2, { idx: 0 }));
  });

  it("keeps them distinct at every shared index", () => {
    for (const idx of [0, 1]) {
      expect(cacheKeyFor(cfg, s1, { idx })).not.toBe(cacheKeyFor(cfg, s2, { idx }));
    }
  });
});

describe("cache key is stable when nothing changed", () => {
  it("repeats for identical inputs", () => {
    expect(cacheKeyFor(cfg, s1, { idx: 1 })).toBe(cacheKeyFor(cfg, s1, { idx: 1 }));
  });

  it("is a 64-char lowercase hex sha256", () => {
    expect(cacheKeyFor(cfg, s1, { idx: 0 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("cache key busts when config changes", () => {
  it("differs when the screen's updated_at moves (edit or asset change)", () => {
    const edited = { ...s1, updatedAt: "2026-02-02T00:00:00.000Z" };
    expect(cacheKeyFor(cfg, edited, { idx: 0 })).not.toBe(cacheKeyFor(cfg, s1, { idx: 0 }));
  });

  it("differs when the device's updated_at moves (mapping change)", () => {
    const edited = { ...cfg, updatedAt: "2026-02-02T00:00:00.000Z" };
    expect(cacheKeyFor(edited, s1, { idx: 0 })).not.toBe(cacheKeyFor(cfg, s1, { idx: 0 }));
  });

  it("differs by render state", () => {
    expect(cacheKeyFor(cfg, s1, { idx: 0 })).not.toBe(cacheKeyFor(cfg, s1, { idx: 1 }));
    expect(cacheKeyFor(cfg, s3, { mode: "light" })).not.toBe(
      cacheKeyFor(cfg, s3, { mode: "dark" })
    );
  });

  it("differs by device resolution", () => {
    expect(cacheKeyFor({ ...cfg, width: 800 }, s1, { idx: 0 })).not.toBe(
      cacheKeyFor(cfg, s1, { idx: 0 })
    );
  });
});
