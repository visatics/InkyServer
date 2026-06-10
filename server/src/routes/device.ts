import type { FastifyInstance } from "fastify";
import { DEVICE, SCREEN, SLIDESHOW_ASSETS } from "../config/device.js";
import { resolveState, type StateQuery } from "../lib/state.js";
import { assetForIndex } from "../render/slideshow.js";
import { renderImage, renderPlaceholder, sha1Hex, sha256Hex } from "../render/pipeline.js";
import { getCachedRender, insertRender, uploadRender } from "../storage/supabase.js";

interface DeviceParams {
  uuid: string;
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: DeviceParams; Querystring: StateQuery }>("/:uuid", async (req, reply) => {
    if (req.params.uuid !== DEVICE.uuid) {
      return reply.code(404).send({ error: "unknown device" });
    }

    const { effectiveIdx, stateOut } = resolveState(req.query, {
      assetCount: SLIDESHOW_ASSETS.length,
      order: SCREEN.config.order,
      defaultScreen: DEVICE.defaultScreen,
    });
    // req.query.button is parsed and deliberately ignored — state engine is Phase 0.2.

    const cacheKey = sha256Hex(
      [DEVICE.uuid, DEVICE.width, DEVICE.height, SCREEN.provider, SCREEN.configVersion, effectiveIdx].join("|")
    );

    try {
      // Treat a cache-read failure as a miss rather than failing the request.
      const cached = await getCachedRender(cacheKey).catch((err) => {
        req.log.warn({ err }, "render cache lookup failed; rendering fresh");
        return null;
      });
      if (cached) {
        return {
          image: cached.image_url,
          refresh: SCREEN.refreshMinutes,
          sha: cached.sha1,
          state: cached.state_out,
        };
      }

      const jpeg = await renderImage(
        assetForIndex(effectiveIdx),
        DEVICE.width,
        DEVICE.height,
        SCREEN.config.fit
      );
      const sha = sha1Hex(jpeg);
      const imageUrl = await uploadRender(`${DEVICE.uuid}/${cacheKey}.jpg`, jpeg);

      // A failed cache write only costs a re-render next time; don't fail the response.
      await insertRender({
        cache_key: cacheKey,
        image_url: imageUrl,
        sha1: sha,
        state_out: stateOut,
      }).catch((err) => req.log.warn({ err }, "render cache insert failed"));

      return { image: imageUrl, refresh: SCREEN.refreshMinutes, sha, state: stateOut };
    } catch (err) {
      // PRD §7.5: never 5xx if a displayable image can be produced. The placeholder
      // is served from this server so the error path has no Supabase dependency.
      req.log.error({ err }, "render failed; serving placeholder");
      const base = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;
      // Encoding is deterministic, so this sha matches the bytes /placeholder.jpg serves.
      const placeholder = await renderPlaceholder(DEVICE.width, DEVICE.height);
      return {
        image: `${base}/placeholder.jpg`,
        refresh: 1,
        sha: sha1Hex(placeholder),
        state: stateOut,
      };
    }
  });
}
