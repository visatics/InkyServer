/**
 * Shared config + state types (PRD §5, §8).
 *
 * These describe the shape the pure engine in `state.ts` consumes. In Phase 0.2
 * the same shape lived as hard-coded constants in `config/device.ts`; from
 * Phase 0.3 it is assembled from Postgres rows by `db/loadDeviceConfig.ts`.
 * The engine does not care which — that is the point.
 */

export type ButtonAction =
  | { type: "goto"; screen: number }
  | { type: "set"; key: string; value: string | number }
  | { type: "cycle"; key: string; values: (string | number)[] }
  | { type: "slideshow"; dir: "next" | "prev" }
  | { type: "none" };

export type Provider = "slideshow" | "debug";

export interface ScreenConfig {
  id: string;
  ordinal: number;
  provider: Provider;
  /** null/0 = no auto-refresh (PRD §7.2). */
  refreshMinutes: number | null;
  config: { order?: "sequential" | "random"; fit?: "cover" | "contain" };
  /** Storage keys in the private `uploads` bucket, in position order. */
  assets: string[];
  buttonOverrides: Partial<Record<string, ButtonAction>>;
  /** ISO timestamp; part of the render cache key. */
  updatedAt: string;
}

export interface DeviceConfig {
  publicUuid: string;
  width: number;
  height: number;
  buttonCount: number;
  defaultScreen: number;
  /** ISO timestamp; part of the render cache key. */
  updatedAt: string;
  screens: ScreenConfig[];
  /** Device-level button defaults, overridden per screen. */
  buttons: Record<string, ButtonAction>;
}

/** Client-held state: always `screen`, plus the current screen's provider keys. */
export type State = { screen: number; idx?: number; mode?: string };
