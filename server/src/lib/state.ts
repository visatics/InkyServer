/**
 * The state engine (PRD §8): pure parsing + state-transition functions.
 * No I/O here. Providers render state; they never mutate it — all mutation
 * happens in this module via one of three paths the route picks between:
 * first boot (initialState), button press (applyButton), timer (applyRefresh).
 */

import {
  type ButtonAction,
  type Screen,
  DEVICE,
  DEVICE_BUTTONS,
  SCREENS,
  SCREEN_BUTTON_OVERRIDES,
} from "../config/device.js";

/** Client-held state: always `screen`, plus the current screen's provider keys. */
export type State = { screen: number; idx?: number; mode?: string };

export interface ParsedQuery {
  /** null when the client sent no usable screen (first boot or unknown ordinal) — reset. */
  inbound: State | null;
  button?: string;
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** Strictly parse an integer from untrusted query input; undefined on anything else. */
function parseIntParam(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return undefined;
}

export function getScreen(ordinal: number): Screen {
  return (
    SCREENS.find((s) => s.ordinal === ordinal) ??
    SCREENS.find((s) => s.ordinal === DEVICE.defaultScreen)!
  );
}

/**
 * Parse untrusted query state (PRD §7.5). Unknown screens collapse to
 * `inbound: null` so the route resets to the default screen's initial state.
 * Provider keys are normalised here so outbound state is always canonical.
 */
export function parseState(query: Record<string, unknown>): ParsedQuery {
  const button =
    typeof query.button === "string" && query.button.trim() !== ""
      ? query.button.trim()
      : undefined;

  const ordinal = parseIntParam(query.screen);
  const screen = ordinal !== undefined ? SCREENS.find((s) => s.ordinal === ordinal) : undefined;
  if (!screen) return { inbound: null, button };

  const inbound: State = { screen: screen.ordinal };
  if (screen.provider === "slideshow") {
    const idx = parseIntParam(query.idx);
    inbound.idx = idx === undefined ? 0 : mod(idx, screen.assets.length);
  } else if (screen.provider === "debug") {
    if (typeof query.mode === "string") inbound.mode = query.mode;
  }
  return { inbound, button };
}

/** Entering a screen (boot or goto) starts from its defaults — provider keys reset. */
export function initialState(screenOrdinal: number): State {
  const screen = getScreen(screenOrdinal);
  if (screen.provider === "slideshow") return { screen: screen.ordinal, idx: 0 };
  if (screen.provider === "debug") return { screen: screen.ordinal, mode: "light" };
  return { screen: (screen as Screen).ordinal };
}

/** Screen override wins, then device default, then no-op (covers unknown buttons). */
export function resolveAction(screenOrdinal: number, button: string): ButtonAction {
  return (
    SCREEN_BUTTON_OVERRIDES[screenOrdinal]?.[button] ??
    DEVICE_BUTTONS[button] ?? { type: "none" }
  );
}

/** Next value in the cycle; an absent/invalid current starts at values[0]. */
export function cycleValue(
  current: string | number | undefined,
  values: (string | number)[]
): string | number {
  const i = values.indexOf(current as string | number);
  return i === -1 ? values[0] : values[(i + 1) % values.length];
}

/** Step a slideshow by one, wrapping with the owning screen's asset count. */
export function advanceIdx(state: State, dir: "next" | "prev"): State {
  const screen = getScreen(state.screen);
  if (screen.provider !== "slideshow") return state;
  const n = screen.assets.length;
  const idx = mod(state.idx ?? 0, n);
  return { ...state, idx: dir === "next" ? mod(idx + 1, n) : mod(idx - 1, n) };
}

function randomIdxAvoiding(current: number | undefined, n: number, random: () => number): number {
  let idx = mod(Math.floor(random() * n), n);
  if (n > 1 && idx === current) idx = mod(idx + 1, n);
  return idx;
}

export function applyButton(state: State, button: string): State {
  const action = resolveAction(state.screen, button);
  switch (action.type) {
    case "goto":
      return initialState(action.screen);
    case "set":
      return { ...state, [action.key]: action.value };
    case "cycle":
      return { ...state, [action.key]: cycleValue(state[action.key as keyof State], action.values) };
    case "slideshow":
      return advanceIdx(state, action.dir);
    case "none":
      return state;
  }
}

/** Timer/manual wake with no button: provider-specific behaviour. */
export function applyRefresh(state: State, random: () => number = Math.random): State {
  const screen = getScreen(state.screen);
  if (screen.provider === "slideshow") {
    return screen.config.order === "random"
      ? { ...state, idx: randomIdxAvoiding(state.idx, screen.assets.length, random) }
      : advanceIdx(state, "next");
  }
  return state; // debug and others: re-render the same state (SHA matches -> device skips)
}

/**
 * The provider-relevant subset of state that affects the rendered image —
 * this (not the full state) feeds the render cache key.
 */
export function renderStateFor(screen: Screen, state: State): Record<string, string | number> {
  if (screen.provider === "slideshow") {
    return { idx: mod(state.idx ?? 0, screen.assets.length) };
  }
  return { mode: state.mode ?? "light" };
}

/** Short human label for the debug screen's button legend. */
export function describeAction(action: ButtonAction): string {
  switch (action.type) {
    case "goto":
      return `→ Screen ${action.screen}`;
    case "set":
      return `set ${action.key}=${action.value}`;
    case "cycle":
      return `cycle ${action.key}`;
    case "slideshow":
      return action.dir === "next" ? "next photo" : "prev photo";
    case "none":
      return "—";
  }
}
