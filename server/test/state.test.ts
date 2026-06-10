import { describe, expect, it } from "vitest";
import { resolveState, type StateContext } from "../src/lib/state.js";

const seq: StateContext = { assetCount: 3, order: "sequential", defaultScreen: 1 };

describe("sequential advancement", () => {
  it("first boot (no params) shows image 0", () => {
    const r = resolveState({}, seq);
    expect(r).toEqual({ screen: 1, effectiveIdx: 0, stateOut: { screen: 1, idx: 0 } });
  });

  it("advances by one from the echoed idx", () => {
    const r = resolveState({ screen: "1", idx: "0" }, seq);
    expect(r.effectiveIdx).toBe(1);
    expect(r.stateOut).toEqual({ screen: 1, idx: 1 });
  });

  it("wraps from the last image back to 0", () => {
    const r = resolveState({ screen: "1", idx: "2" }, seq);
    expect(r.effectiveIdx).toBe(0);
  });

  it("walks 0 -> 1 -> 2 -> 0 across repeated polls", () => {
    let idx: number | undefined;
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = resolveState(idx === undefined ? {} : { screen: "1", idx: String(idx) }, seq);
      seen.push(r.effectiveIdx);
      expect(r.stateOut.idx).toBe(r.effectiveIdx); // state always matches the visible image
      idx = r.stateOut.idx;
    }
    expect(seen).toEqual([0, 1, 2, 0]);
  });

  it("handles a single-asset slideshow without dividing by zero", () => {
    const one: StateContext = { ...seq, assetCount: 1 };
    expect(resolveState({}, one).effectiveIdx).toBe(0);
    expect(resolveState({ idx: "0" }, one).effectiveIdx).toBe(0);
  });

  it("throws when there are no assets", () => {
    expect(() => resolveState({}, { ...seq, assetCount: 0 })).toThrow();
  });
});

describe("sanitisation", () => {
  it("treats non-numeric idx as unset (first boot)", () => {
    expect(resolveState({ idx: "abc" }, seq).effectiveIdx).toBe(0);
  });

  it("treats out-of-range idx as unset", () => {
    expect(resolveState({ idx: "999" }, seq).effectiveIdx).toBe(0);
    expect(resolveState({ idx: "-1" }, seq).effectiveIdx).toBe(0);
  });

  it("falls back to the default screen for unknown screens", () => {
    const r = resolveState({ screen: "99", idx: "0" }, seq);
    expect(r.screen).toBe(1);
    expect(r.stateOut.screen).toBe(1);
  });

  it("falls back to the default screen for garbage screens", () => {
    expect(resolveState({ screen: "lounge" }, seq).screen).toBe(1);
  });

  it("ignores the button param", () => {
    const r = resolveState({ idx: "0", button: "A" }, seq);
    expect(r.effectiveIdx).toBe(1); // same as without the button
  });

  it("survives combined garbage params (?idx=abc&screen=99)", () => {
    const r = resolveState({ idx: "abc", screen: "99" }, seq);
    expect(r).toEqual({ screen: 1, effectiveIdx: 0, stateOut: { screen: 1, idx: 0 } });
  });
});

describe("random ordering", () => {
  const rnd = (...values: number[]): (() => number) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it("picks an in-range index", () => {
    const ctx: StateContext = { ...seq, order: "random", random: rnd(0.99) };
    expect(resolveState({}, ctx).effectiveIdx).toBe(2);
  });

  it("never repeats the incoming idx when N > 1", () => {
    // RNG insists on index 1; incoming idx is 1, so it must move on.
    const ctx: StateContext = { ...seq, order: "random", random: rnd(0.5) };
    const r = resolveState({ idx: "1" }, ctx);
    expect(r.effectiveIdx).toBe(2);
  });

  it("allows a repeat when N = 1 (no other choice)", () => {
    const ctx: StateContext = { ...seq, assetCount: 1, order: "random", random: rnd(0.5) };
    expect(resolveState({ idx: "0" }, ctx).effectiveIdx).toBe(0);
  });

  it("consecutive polls never return the same index twice in a row", () => {
    const ctx: StateContext = { ...seq, order: "random" }; // real Math.random
    let idx: number | undefined;
    for (let i = 0; i < 200; i++) {
      const r = resolveState(idx === undefined ? {} : { idx: String(idx) }, ctx);
      if (idx !== undefined) expect(r.effectiveIdx).not.toBe(idx);
      idx = r.stateOut.idx;
    }
  });
});
