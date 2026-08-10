/**
 * Management API (PRD §6). Every route is owner-scoped: `requireUser` resolves
 * the caller from a Supabase JWT, and the repositories filter on that id.
 *
 * Cross-user access returns 404 rather than 403 — a 403 would confirm that a
 * resource exists, which is a small information leak on public-ish ids.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../../auth/verifyJwt.js";
import { DEVICE_PRESETS, findPreset } from "../../config/presets.js";
import {
  createDevice,
  deleteDevice,
  deleteMapping,
  getDevice,
  getMappings,
  listDevices,
  regenerateUuid,
  setMapping,
  updateDevice,
} from "../../db/devices.js";
import {
  createScreen,
  deleteScreen,
  getScreenOwned,
  listScreens,
  reorderScreens,
  updateScreen,
} from "../../db/screens.js";
import { assetRoutes } from "./assets.js";
import {
  buttonAction,
  buttonParam,
  createDeviceBody,
  createScreenBody,
  reorderBody,
  updateDeviceBody,
  updateScreenBody,
} from "./schemas.js";

const NOT_FOUND = { error: "not found" };

/** Turns a zod failure into a 400 with the offending paths named. */
function parseOr400<T>(schema: z.ZodType<T>, value: unknown, reply: { code: (n: number) => any }) {
  const result = schema.safeParse(value);
  if (!result.success) {
    reply.code(400).send({
      error: "invalid request",
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return null;
  }
  return result.data;
}

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  app.get("/presets", async () => DEVICE_PRESETS);

  // -- devices ---------------------------------------------------------------

  app.get("/devices", async (req) => listDevices(req.userId!));

  app.post("/devices", async (req, reply) => {
    const body = parseOr400(createDeviceBody, req.body, reply);
    if (!body) return;

    let spec: { name: string; width: number; height: number; buttonCount: number };
    if ("presetId" in body) {
      const preset = findPreset(body.presetId);
      if (!preset) return reply.code(400).send({ error: `unknown preset: ${body.presetId}` });
      spec = {
        name: preset.name,
        width: preset.width,
        height: preset.height,
        buttonCount: preset.buttonCount,
      };
    } else {
      spec = body;
    }
    return reply.code(201).send(await createDevice(req.userId!, spec));
  });

  app.get<{ Params: { id: string } }>("/devices/:id", async (req, reply) => {
    const device = await getDevice(req.userId!, req.params.id);
    return device ?? reply.code(404).send(NOT_FOUND);
  });

  app.patch<{ Params: { id: string } }>("/devices/:id", async (req, reply) => {
    const body = parseOr400(updateDeviceBody, req.body, reply);
    if (!body) return;
    const device = await updateDevice(req.userId!, req.params.id, body);
    return device ?? reply.code(404).send(NOT_FOUND);
  });

  app.post<{ Params: { id: string } }>("/devices/:id/regenerate-uuid", async (req, reply) => {
    const device = await regenerateUuid(req.userId!, req.params.id);
    return device ?? reply.code(404).send(NOT_FOUND);
  });

  app.delete<{ Params: { id: string } }>("/devices/:id", async (req, reply) => {
    const ok = await deleteDevice(req.userId!, req.params.id);
    return ok ? reply.code(204).send() : reply.code(404).send(NOT_FOUND);
  });

  // -- screens ---------------------------------------------------------------

  app.get<{ Params: { id: string } }>("/devices/:id/screens", async (req, reply) => {
    if (!(await getDevice(req.userId!, req.params.id))) return reply.code(404).send(NOT_FOUND);
    return listScreens(req.userId!, req.params.id);
  });

  app.post<{ Params: { id: string } }>("/devices/:id/screens", async (req, reply) => {
    const body = parseOr400(createScreenBody, req.body, reply);
    if (!body) return;
    const screen = await createScreen(req.userId!, req.params.id, body);
    return screen ? reply.code(201).send(screen) : reply.code(404).send(NOT_FOUND);
  });

  app.patch<{ Params: { id: string } }>("/screens/:id", async (req, reply) => {
    const body = parseOr400(updateScreenBody, req.body, reply);
    if (!body) return;
    const screen = await updateScreen(req.userId!, req.params.id, body);
    return screen ?? reply.code(404).send(NOT_FOUND);
  });

  app.post<{ Params: { id: string } }>("/devices/:id/screens/reorder", async (req, reply) => {
    const body = parseOr400(reorderBody, req.body, reply);
    if (!body) return;
    const ok = await reorderScreens(req.userId!, req.params.id, body.orderedIds);
    return ok ? reply.code(204).send() : reply.code(404).send(NOT_FOUND);
  });

  app.delete<{ Params: { id: string } }>("/screens/:id", async (req, reply) => {
    const ok = await deleteScreen(req.userId!, req.params.id);
    return ok ? reply.code(204).send() : reply.code(404).send(NOT_FOUND);
  });

  // -- device-level button mappings -----------------------------------------

  app.get<{ Params: { id: string } }>("/devices/:id/mappings", async (req, reply) => {
    if (!(await getDevice(req.userId!, req.params.id))) return reply.code(404).send(NOT_FOUND);
    return getMappings(req.userId!, req.params.id);
  });

  app.put<{ Params: { id: string; button: string } }>(
    "/devices/:id/mappings/:button",
    async (req, reply) => {
      const button = parseOr400(buttonParam, req.params.button, reply);
      if (!button) return;
      const action = parseOr400(buttonAction, req.body, reply);
      if (!action) return;
      const ok = await setMapping(req.userId!, req.params.id, button, action);
      return ok ? { button, action } : reply.code(404).send(NOT_FOUND);
    }
  );

  app.delete<{ Params: { id: string; button: string } }>(
    "/devices/:id/mappings/:button",
    async (req, reply) => {
      const button = parseOr400(buttonParam, req.params.button, reply);
      if (!button) return;
      const ok = await deleteMapping(req.userId!, req.params.id, button);
      return ok ? reply.code(204).send() : reply.code(404).send(NOT_FOUND);
    }
  );

  // -- slideshow assets ------------------------------------------------------

  await app.register(assetRoutes);

  // Exposed so the SPA can confirm a screen belongs to the caller before
  // rendering an editor for it.
  app.get<{ Params: { id: string } }>("/screens/:id", async (req, reply) => {
    const screen = await getScreenOwned(req.userId!, req.params.id);
    return screen ?? reply.code(404).send(NOT_FOUND);
  });
}
