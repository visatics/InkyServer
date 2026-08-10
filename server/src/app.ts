/**
 * Builds the Fastify instance without listening, so tests can drive it through
 * `inject()`. `server.ts` is the thin entrypoint that binds a port.
 *
 * Route precedence matters here (PRD §"Routing"): `/api` and `/app` are static
 * segments and must be registered before the `/:uuid` device parameter, which
 * would otherwise swallow them.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { apiRoutes } from "./routes/api/index.js";
import { deviceRoutes } from "./routes/device.js";
import { renderPlaceholder } from "./render/pipeline.js";

export interface BuildOptions {
  logger?: boolean;
  /** Defaults to web/dist; Phase 0.3b builds the SPA there. */
  spaRoot?: string;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  /**
   * Locally-served fallback image: the render error path must not depend on
   * Supabase. Size comes from the query so it can match any device resolution.
   */
  app.get<{ Querystring: { w?: string; h?: string } }>("/placeholder.jpg", async (req, reply) => {
    const width = Math.min(4096, Math.max(1, parseInt(req.query.w ?? "600", 10) || 600));
    const height = Math.min(4096, Math.max(1, parseInt(req.query.h ?? "448", 10) || 448));
    const jpeg = await renderPlaceholder(width, height);
    return reply.type("image/jpeg").send(jpeg);
  });

  await app.register(import("@fastify/multipart"), {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  await app.register(apiRoutes, { prefix: "/api" });

  const spaRoot = path.resolve(opts.spaRoot ?? "web/dist");
  const hasSpa = existsSync(path.join(spaRoot, "index.html"));
  if (hasSpa) {
    await app.register(import("@fastify/static"), { root: spaRoot, prefix: "/app/" });
  }

  /**
   * Client-side SPA routes fall back to index.html — scoped to /app so the
   * fallback can never swallow a device request or an unknown /api path.
   */
  app.setNotFoundHandler((req, reply) => {
    if (hasSpa && req.url.startsWith("/app")) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "not found" });
  });

  app.get("/", async (_req, reply) => reply.redirect("/app"));

  // Registered last: the /:uuid parameter must never shadow /api or /app.
  await app.register(deviceRoutes);

  return app;
}
