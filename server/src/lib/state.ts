/**
 * The state engine (PRD §8): pure parsing + state-transition functions.
 *
 * No I/O here. Providers render state; they never mutate it — all mutation
 * happens in this module via one of three paths the route picks between:
 * first boot (initialState), button press (applyButton), timer (applyRefresh).
 *
 * Phase 0.3: config arrives as a `DeviceConfig` parameter rather than imported
 * constants, so the same engine serves hard-coded fixtures and Postgres rows
 * alike. The transition logic itself is unchanged from Phase 0.2.
 */

import type { ButtonAction, DeviceConfig, ScreenConfig, State } from "./types.js";

export type { State } from "./types.js";

export interface ParsedQuery {
  /** null when the client sent no usable screen (first boot or unknown ordinal) — reset. */
  inbound: State | null;
  button?: string;
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/**
 * Slideshow screens are user-editable from Phase 0.3, so an empty asset list is
 * reachable (a screen created before any upload). Clamping to 1 keeps every
 * modulo finite — a NaN index would otherwise poison both the state and the
 * render cache key. The render path throws on a genuinely empty screen and the
 * route falls back to the placeholder, per PRD §7.5.
 */
const assetCount = (screen: ScreenConfig): number => Math.max(1, screen.assets.length);

/** Strictly parse an integer from untrusted query input; undefined on anything else. */
function parseIntParam(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return undefined;
}

export function getScreen(cfg: DeviceConfig, ordinal: number): ScreenConfig {
  return (
    cfg.screens.find((s) => s.ordinal === ordinal) ??
    cfg.screens.find((s) => s.ordinal === cfg.defaultScreen)!
  );
}

/**
 * Parse untrusted query state (PRD §7.5). Unknown screens collapse to
 * `inbound: null` so the route resets to the default screen's initial state.
 * Provider keys are normalised here so outbound state is always canonical.
 */
export function parseState(cfg: DeviceConfig, query: Record<string, unknown>): ParsedQuery {
  const button =
    typeof query.button === "string" && query.button.trim() !== ""
      ? query.button.trim()
      : undefined;

  const ordinal = parseIntParam(query.screen);
  const screen =
    ordinal !== undefined ? cfg.screens.find((s) => s.ordinal === ordinal) : undefined;
  if (!screen) return { inbound: null, button };

  const inbound: State = { screen: screen.ordinal };
  if (screen.provider === "slideshow") {
    const idx = parseIntParam(query.idx);
    inbound.idx = idx === undefined ? 0 : mod(idx, assetCount(screen));
  } else if (screen.provider === "debug") {
    if (typeof query.mode === "string") inbound.mode = query.mode;
  }
  return { inbound, button };
}

/** Entering a screen (boot or goto) starts from its defaults — provider keys reset. */
export function initialState(cfg: DeviceConfig, screenOrdinal: number): State {
  const screen = getScreen(cfg, screenOrdinal);
  if (screen.provider === "slideshow") return { screen: screen.ordinal, idx: 0 };
  if (screen.provider === "debug") return { screen: screen.ordinal, mode: "light" };
  return { screen: screen.ordinal };
}

/** Screen override wins, then device default, then no-op (covers unknown buttons). */
export function resolveAction(
  cfg: DeviceConfig,
  screenOrdinal: number,
  button: string
): ButtonAction {
  const overrides = cfg.screens.find((s) => s.ordinal === screenOrdinal)?.buttonOverrides;
  return overrides?.[button] ?? cfg.buttons[button] ?? { type: "none" };
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
export function advanceIdx(cfg: DeviceConfig, state: State, dir: "next" | "prev"): State {
  const screen = getScreen(cfg, state.screen);
  if (screen.provider !== "slideshow") return state;
  const n = assetCount(screen);
  const idx = mod(state.idx ?? 0, n);
  return { ...state, idx: dir === "next" ? mod(idx + 1, n) : mod(idx - 1, n) };
}

function randomIdxAvoiding(current: number | undefined, n: number, random: () => number): number {
  let idx = mod(Math.floor(random() * n), n);
  if (n > 1 && idx === current) idx = mod(idx + 1, n);
  return idx;
}

export function applyButton(cfg: DeviceConfig, state: State, button: string): State {
  const action = resolveAction(cfg, state.screen, button);
  switch (action.type) {
    case "goto":
      return initialState(cfg, action.screen);
    case "set":
      return { ...state, [action.key]: action.value };
    case "cycle":
      return { ...state, [action.key]: cycleValue(state[action.key as keyof State], action.values) };
    case "slideshow":
      return advanceIdx(cfg, state, action.dir);
    case "none":
      return state;
  }
}

/** Timer/manual wake with no button: provider-specific behaviour. */
export function applyRefresh(
  cfg: DeviceConfig,
  state: State,
  random: () => number = Math.random
): State {
  const screen = getScreen(cfg, state.screen);
  if (screen.provider === "slideshow") {
    return screen.config.order === "random"
      ? { ...state, idx: randomIdxAvoiding(state.idx, assetCount(screen), random) }
      : advanceIdx(cfg, state, "next");
  }
  return state; // debug and others: re-render the same state (SHA matches -> device skips)
}

/**
 * The provider-relevant subset of state that affects the rendered image —
 * this (not the full state) feeds the render cache key.
 */
export function renderStateFor(
  screen: ScreenConfig,
  state: State
): Record<string, string | number> {
  if (screen.provider === "slideshow") {
    return { idx: mod(state.idx ?? 0, assetCount(screen)) };
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
