/**
 * In-memory last-known-good render per screen (PRD §7.5). On a render failure
 * the device gets the previous good image rather than the placeholder. Resets
 * on restart — acceptable for the spike.
 */

import type { State } from "./state.js";

export interface LastGoodEntry {
  image_url: string;
  sha1: string;
  state_out: State;
}

const lastGood = new Map<number, LastGoodEntry>();

export function getLastGood(screenOrdinal: number): LastGoodEntry | undefined {
  return lastGood.get(screenOrdinal);
}

export function setLastGood(screenOrdinal: number, entry: LastGoodEntry): void {
  lastGood.set(screenOrdinal, entry);
}

export function clearLastGood(): void {
  lastGood.clear();
}
