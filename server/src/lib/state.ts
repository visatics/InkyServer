/**
 * Pure client-state parsing + slideshow advancement (PRD §7, §13).
 * No I/O here — this is the seed of the Phase 0.2 state engine.
 */

export type Order = "sequential" | "random";

export interface StateQuery {
  screen?: unknown;
  idx?: unknown;
  button?: unknown; // parsed and ignored in Phase 0
}

export interface StateContext {
  assetCount: number;
  order: Order;
  defaultScreen: number;
  /** Injectable RNG (0 <= n < 1) so random ordering is testable. */
  random?: () => number;
}

export interface ResolvedState {
  screen: number;
  /** Index of the image shown in THIS response. */
  effectiveIdx: number;
  /** The state the client persists and echoes back next poll. */
  stateOut: { screen: number; idx: number };
}

/** Strictly parse an integer from untrusted query input; undefined on anything else. */
function parseIntParam(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return undefined;
}

export function resolveState(query: StateQuery, ctx: StateContext): ResolvedState {
  const n = ctx.assetCount;
  if (n < 1) throw new Error("slideshow has no assets");

  // Phase 0 has a single screen: anything other than 1 falls back to the default.
  const screenParam = parseIntParam(query.screen);
  const screen = screenParam === 1 ? 1 : ctx.defaultScreen;

  // idx is only meaningful when it refers to a real asset; otherwise treat as unset.
  const idxParam = parseIntParam(query.idx);
  const idx = idxParam !== undefined && idxParam >= 0 && idxParam < n ? idxParam : undefined;

  let effectiveIdx: number;
  if (ctx.order === "random") {
    const random = ctx.random ?? Math.random;
    effectiveIdx = Math.floor(random() * n) % n;
    // Avoid showing the same image twice in a row (when we have a choice).
    if (n > 1 && effectiveIdx === idx) {
      effectiveIdx = (effectiveIdx + 1) % n;
    }
  } else {
    // Sequential: first boot shows image 0; each subsequent poll advances by one.
    effectiveIdx = idx === undefined ? 0 : (idx + 1) % n;
  }

  return {
    screen,
    effectiveIdx,
    stateOut: { screen, idx: effectiveIdx },
  };
}
