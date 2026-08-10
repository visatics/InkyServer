/**
 * Slideshow asset management.
 *
 * Uploads are the only path by which user-supplied bytes enter the system, so
 * per PRD §11 they are validated, EXIF-stripped and re-encoded server-side —
 * never stored as received. `.rotate()` bakes in EXIF orientation before the
 * metadata is dropped, so images stay the right way up.
 */

import { randomUUID } from "node:crypto";
import "@fastify/multipart"; // brings req.file() into the FastifyRequest type
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { createAsset, deleteAsset, getScreenOwned, listAssets, reorderAssets } from "../../db/screens.js";
import { removeSource, uploadSource } from "../../storage/supabase.js";
import { reorderBody } from "./schemas.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const NOT_FOUND = { error: "not found" };

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/screens/:id/assets", async (req, reply) => {
    if (!(await getScreenOwned(req.userId!, req.params.id))) {
      return reply.code(404).send(NOT_FOUND);
    }
    return listAssets(req.userId!, req.params.id);
  });

  app.post<{ Params: { id: string } }>("/screens/:id/assets", async (req, reply) => {
    const screen = await getScreenOwned(req.userId!, req.params.id);
    if (!screen) return reply.code(404).send(NOT_FOUND);
    if (screen.provider !== "slideshow") {
      return reply.code(400).send({ error: "screen is not a slideshow" });
    }

    const file = await req.file({ limits: { fileSize: MAX_BYTES } });
    if (!file) return reply.code(400).send({ error: "no file uploaded" });
    if (!file.mimetype.startsWith("image/")) {
      return reply.code(400).send({ error: `unsupported type: ${file.mimetype}` });
    }

    const raw = await file.toBuffer().catch(() => null);
    if (!raw) return reply.code(413).send({ error: "file too large" });
    if (file.file.truncated) return reply.code(413).send({ error: "file too large" });

    let clean: Buffer;
    try {
      const meta = await sharp(raw).metadata();
      if ((meta.width ?? 0) > MAX_DIMENSION || (meta.height ?? 0) > MAX_DIMENSION) {
        return reply.code(400).send({ error: `image exceeds ${MAX_DIMENSION}px` });
      }
      // Re-encoding drops all metadata (including EXIF GPS) by default.
      clean = await sharp(raw)
        .rotate()
        .jpeg({ quality: 90, progressive: false, mozjpeg: false })
        .toBuffer();
    } catch {
      return reply.code(400).send({ error: "not a decodable image" });
    }

    // Mint the id first so the storage key is known before either write; the
    // object goes up first, so a failure leaves an orphaned object (harmless)
    // rather than a row pointing at nothing (breaks the render).
    const id = randomUUID();
    const key = `${req.userId!}/${screen.id}/${id}.jpg`;
    await uploadSource(key, clean);
    const asset = await createAsset(id, screen.id, key, file.filename ?? null);

    return reply.code(201).send(asset);
  });

  app.post<{ Params: { id: string } }>("/screens/:id/assets/reorder", async (req, reply) => {
    const parsed = reorderBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request" });
    const ok = await reorderAssets(req.userId!, req.params.id, parsed.data.orderedIds);
    return ok ? reply.code(204).send() : reply.code(404).send(NOT_FOUND);
  });

  app.delete<{ Params: { id: string } }>("/assets/:id", async (req, reply) => {
    const key = await deleteAsset(req.userId!, req.params.id);
    if (!key) return reply.code(404).send(NOT_FOUND);
    // The row is gone either way; a stranded object is harmless, a stranded row is not.
    await removeSource(key).catch((err) => req.log.warn({ err }, "orphaned upload object"));
    return reply.code(204).send();
  });
}
