import { z } from "zod";

/**
 * Mirrors ButtonAction in lib/types.ts exactly. The API stores what the engine
 * consumes with no translation, so a mapping saved through the UI is literally
 * the JSON the state engine reads (PRD §8.2).
 */
export const buttonAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), screen: z.number().int().positive() }),
  z.object({
    type: z.literal("set"),
    key: z.string().min(1).max(40),
    value: z.union([z.string().max(200), z.number()]),
  }),
  z.object({
    type: z.literal("cycle"),
    key: z.string().min(1).max(40),
    values: z.array(z.union([z.string().max(200), z.number()])).min(1).max(20),
  }),
  z.object({ type: z.literal("slideshow"), dir: z.enum(["next", "prev"]) }),
  z.object({ type: z.literal("none") }),
]);

export const providerConfig = z.object({
  order: z.enum(["sequential", "random"]).optional(),
  fit: z.enum(["cover", "contain"]).optional(),
});

export const createDeviceBody = z.union([
  z.object({ presetId: z.string().min(1) }),
  z.object({
    name: z.string().min(1).max(80),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    buttonCount: z.number().int().min(0).max(5).default(5),
  }),
]);

export const updateDeviceBody = z.object({
  name: z.string().min(1).max(80).optional(),
  defaultScreen: z.number().int().positive().optional(),
  width: z.number().int().min(1).max(4096).optional(),
  height: z.number().int().min(1).max(4096).optional(),
  buttonCount: z.number().int().min(0).max(5).optional(),
});

export const createScreenBody = z.object({
  name: z.string().min(1).max(80),
  provider: z.enum(["slideshow", "debug"]),
  providerConfig: providerConfig.optional(),
  refreshMinutes: z.number().int().min(0).max(10080).nullable().optional(),
});

/**
 * Overrides are partial by design — a screen overrides only the buttons it
 * cares about, and the rest fall through to the device defaults (PRD §8.2).
 * Spelled out as optional keys rather than z.record(z.enum(...)), because
 * zod v4 treats an enum-keyed record as exhaustive and would reject a partial map.
 */
export const buttonOverrides = z.object({
  A: buttonAction.optional(),
  B: buttonAction.optional(),
  C: buttonAction.optional(),
  D: buttonAction.optional(),
  E: buttonAction.optional(),
});

export const updateScreenBody = z.object({
  name: z.string().min(1).max(80).optional(),
  providerConfig: providerConfig.optional(),
  refreshMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  buttonOverrides: buttonOverrides.optional(),
});

export const reorderBody = z.object({ orderedIds: z.array(z.string().uuid()).min(1).max(200) });

export const buttonParam = z.enum(["A", "B", "C", "D", "E"]);
