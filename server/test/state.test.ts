import { describe, expect, it } from "vitest";
import {
  advanceIdx,
  applyButton,
  applyRefresh,
  cycleValue,
  describeAction,
  getScreen,
  initialState,
  parseState,
  renderStateFor,
} from "../src/lib/state.js";

// Screen 1: sequential slideshow, N=3. Screen 2: random slideshow, N=2. Screen 3: debug.

const rnd = (...values: number[]): (() => number) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("resolveAction precedence (via applyButton/describeAction)", () => {
  it("uses the device default when no override exists", () => {
    // A is goto 1 everywhere
    expect(applyButton({ screen: 2, idx: 1 }, "A")).toEqual({ screen: 1, idx: 0 });
  });

  it("screen override beats the device default", () => {
    // Device default for D is slideshow-next; screen 3 overrides it to set mode=light
    expect(applyButton({ screen: 3, mode: "dark" }, "D")).toEqual({ screen: 3, mode: "light" });
  });

  it("unknown buttons resolve to none (state unchanged)", () => {
    const state = { screen: 1, idx: 2 };
    expect(applyButton(state, "Z")).toEqual(state);
  });

  it("E is a no-op on slideshow screens (device default none)", () => {
    const state = { screen: 1, idx: 2 };
    expect(applyButton(state, "E")).toEqual(state);
  });
});

describe("goto resets provider keys", () => {
  it("drops idx when leaving a slideshow for the debug screen", () => {
    const out = applyButton({ screen: 1, idx: 2 }, "C");
    expect(out).toEqual({ screen: 3, mode: "light" });
    expect(out).not.toHaveProperty("idx");
  });

  it("drops mode when leaving debug for a slideshow", () => {
    const out = applyButton({ screen: 3, mode: "blue" }, "B");
    expect(out).toEqual({ screen: 2, idx: 0 });
    expect(out).not.toHaveProperty("mode");
  });

  it("goto the current screen still resets to initial state", () => {
    expect(applyButton({ screen: 1, idx: 2 }, "A")).toEqual({ screen: 1, idx: 0 });
  });
});

describe("cycleValue", () => {
  const values = ["light", "dark", "blue"];

  it("cycles forward and wraps", () => {
    expect(cycleValue("light", values)).toBe("dark");
    expect(cycleValue("dark", values)).toBe("blue");
    expect(cycleValue("blue", values)).toBe("light");
  });

  it("starts at values[0] when current is absent or invalid", () => {
    expect(cycleValue(undefined, values)).toBe("light");
    expect(cycleValue("purple", values)).toBe("light");
  });

  it("cycle via button E on the debug screen", () => {
    expect(applyButton({ screen: 3, mode: "light" }, "E")).toEqual({ screen: 3, mode: "dark" });
    expect(applyButton({ screen: 3, mode: "blue" }, "E")).toEqual({ screen: 3, mode: "light" });
  });
});

describe("advanceIdx", () => {
  it("wraps forward using screen 1's N=3", () => {
    expect(advanceIdx({ screen: 1, idx: 2 }, "next").idx).toBe(0);
    expect(advanceIdx({ screen: 1, idx: 0 }, "next").idx).toBe(1);
  });

  it("wraps backward using screen 1's N=3", () => {
    expect(advanceIdx({ screen: 1, idx: 0 }, "prev").idx).toBe(2);
  });

  it("uses screen 2's smaller N=2", () => {
    expect(advanceIdx({ screen: 2, idx: 1 }, "next").idx).toBe(0);
    expect(advanceIdx({ screen: 2, idx: 0 }, "prev").idx).toBe(1);
  });

  it("is identity on non-slideshow screens", () => {
    const state = { screen: 3, mode: "dark" };
    expect(advanceIdx(state, "next")).toEqual(state);
  });

  it("normalises an out-of-range idx via modulo", () => {
    expect(advanceIdx({ screen: 1, idx: 7 }, "next").idx).toBe(2); // 7 mod 3 = 1 -> 2
  });
});

describe("applyRefresh", () => {
  it("advances a sequential slideshow", () => {
    expect(applyRefresh({ screen: 1, idx: 0 }).idx).toBe(1);
    expect(applyRefresh({ screen: 1, idx: 2 }).idx).toBe(0);
  });

  it("picks a non-repeating index for a random slideshow (N>1)", () => {
    // Screen 2 is random with N=2; RNG insists on the current index 0
    expect(applyRefresh({ screen: 2, idx: 0 }, rnd(0.1)).idx).toBe(1);
    expect(applyRefresh({ screen: 2, idx: 1 }, rnd(0.9)).idx).toBe(0);
  });

  it("is identity for debug", () => {
    const state = { screen: 3, mode: "blue" };
    expect(applyRefresh(state)).toEqual(state);
  });
});

describe("initialState / first boot", () => {
  it("slideshow screens start at idx 0", () => {
    expect(initialState(1)).toEqual({ screen: 1, idx: 0 });
    expect(initialState(2)).toEqual({ screen: 2, idx: 0 });
  });

  it("the debug screen starts in light mode", () => {
    expect(initialState(3)).toEqual({ screen: 3, mode: "light" });
  });

  it("unknown ordinals fall back to the default screen", () => {
    expect(initialState(99)).toEqual({ screen: 1, idx: 0 });
  });

  it("first boot does NOT advance: no screen param -> inbound null", () => {
    expect(parseState({}).inbound).toBeNull();
    expect(parseState({ idx: "2" }).inbound).toBeNull(); // idx without screen is still a boot
  });
});

describe("parseState sanitisation", () => {
  it("unknown screen ordinals collapse to a reset (inbound null)", () => {
    expect(parseState({ screen: "99", idx: "1" }).inbound).toBeNull();
  });

  it("non-numeric idx falls back to 0", () => {
    expect(parseState({ screen: "1", idx: "abc" }).inbound).toEqual({ screen: 1, idx: 0 });
  });

  it("out-of-range idx is normalised via modulo", () => {
    expect(parseState({ screen: "1", idx: "7" }).inbound).toEqual({ screen: 1, idx: 1 });
    expect(parseState({ screen: "1", idx: "-1" }).inbound).toEqual({ screen: 1, idx: 2 });
  });

  it("passes the button through, including unknown ones", () => {
    expect(parseState({ screen: "1", idx: "0", button: "Z" }).button).toBe("Z");
    expect(parseState({ screen: "1", idx: "0" }).button).toBeUndefined();
  });

  it("keeps mode on the debug screen and drops idx", () => {
    const { inbound } = parseState({ screen: "3", mode: "dark", idx: "1" });
    expect(inbound).toEqual({ screen: 3, mode: "dark" });
  });

  it("an invalid mode survives parsing but cycles from values[0]", () => {
    const { inbound } = parseState({ screen: "3", mode: "purple" });
    expect(applyButton(inbound!, "E")).toEqual({ screen: 3, mode: "light" });
  });

  it("the kitchen sink (screen=99, idx=abc, mode=purple, button=Z) never throws", () => {
    const parsed = parseState({ screen: "99", idx: "abc", mode: "purple", button: "Z" });
    expect(parsed.inbound).toBeNull();
    expect(parsed.button).toBe("Z");
    // Route would reset; even applying the unknown button to a fresh state is safe:
    expect(applyButton(initialState(1), "Z")).toEqual({ screen: 1, idx: 0 });
  });
});

describe("renderStateFor (cache-key subset)", () => {
  it("slideshow keys on idx only, clamped", () => {
    expect(renderStateFor(getScreen(1), { screen: 1, idx: 7 })).toEqual({ idx: 1 });
    expect(renderStateFor(getScreen(1), { screen: 1 })).toEqual({ idx: 0 });
  });

  it("debug keys on mode only, defaulting to light", () => {
    expect(renderStateFor(getScreen(3), { screen: 3, mode: "dark" })).toEqual({ mode: "dark" });
    expect(renderStateFor(getScreen(3), { screen: 3 })).toEqual({ mode: "light" });
  });
});

describe("describeAction", () => {
  it("labels every action type", () => {
    expect(describeAction({ type: "goto", screen: 2 })).toBe("→ Screen 2");
    expect(describeAction({ type: "set", key: "mode", value: "light" })).toBe("set mode=light");
    expect(describeAction({ type: "cycle", key: "mode", values: ["a"] })).toBe("cycle mode");
    expect(describeAction({ type: "slideshow", dir: "next" })).toBe("next photo");
    expect(describeAction({ type: "slideshow", dir: "prev" })).toBe("prev photo");
    expect(describeAction({ type: "none" })).toBe("—");
  });
});
