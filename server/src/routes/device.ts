import type { FastifyInstance } from "fastify";
import { loadDeviceConfig } from "../db/loadDeviceConfig.js";
import { getCachedRender, getLastGoodForScreen, insertRender } from "../db/renders.js";
import { cacheKeyFor } from "../lib/cacheKey.js";
import {
  applyButton,
  applyRefresh,
  getScreen,
  initialState,
  parseState,
  renderStateFor,
} from "../lib/state.js";
import type { DeviceConfig, ScreenConfig, State } from "../lib/types.js";
import { renderDebug } from "../render/debug.js";
import { renderPlaceholder, sha1Hex } from "../render/pipeline.js";
import { renderSlideshow } from "../render/slideshow.js";
import { uploadRender } from "../storage/supabase.js";

interface DeviceParams {
  uuid: string;
}

/**
 * Only UUIDs reach the device lookup, so stray root paths (/favicon.ico, and
 * anything the SPA router misses) 404 without touching the database.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function renderProvider(
  cfg: DeviceConfig,
  screen: ScreenConfig,
  renderState: Record<string, string | number>
): Promise<Buffer> {
  if (screen.provider === "slideshow") {
    return renderSlideshow(screen, renderState, cfg.width, cfg.height);
  }
  return renderDebug(cfg, screen, renderState, cfg.width, cfg.height);
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: DeviceParams; Querystring: Record<string, unknown> }>(
    "/:uuid",
    async (req, reply) => {
      if (!UUID_RE.test(req.params.uuid)) {
        return reply.code(404).send({ error: "not found" });
      }

      const cfg = await loadDeviceConfig(req.params.uuid);
      if (!cfg || cfg.screens.length === 0) {
        return reply.code(404).send({ error: "unknown device" });
      }

      // Exactly one of the three transition paths per request (PRD §8):
      // boot/reset -> initial state; button -> applyButton; timer -> applyRefresh.
      const { inbound, button } = parseState(cfg, req.query);
      let stateOut: State;
      if (inbound === null) {
        stateOut = initialState(cfg, cfg.defaultScreen);
      } else if (button !== undefined) {
        stateOut = applyButton(cfg, inbound, button);
      } else {
        stateOut = applyRefresh(cfg, inbound);
      }

      const screen = getScreen(cfg, stateOut.screen);
      const renderState = renderStateFor(screen, stateOut);
      const cacheKey = cacheKeyFor(cfg, screen, renderState);
      const refresh = screen.refreshMinutes ?? 0;

      try {
        // Treat a cache-read failure as a miss rather than failing the request.
        const cached = await getCachedRender(cacheKey).catch((err) => {
          req.log.warn({ err }, "render cache lookup failed; rendering fresh");
          return null;
        });
        if (cached) {
          return { image: cached.image_url, refresh, sha: cached.sha1, state: stateOut };
        }

        const jpeg = await renderProvider(cfg, screen, renderState);
        const sha = sha1Hex(jpeg);
        const imageUrl = await uploadRender(`${cfg.publicUuid}/${cacheKey}.jpg`, jpeg);

        // A failed cache write only costs a re-render next time; don't fail the response.
        await insertRender({
          cache_key: cacheKey,
          image_url: imageUrl,
          sha1: sha,
          state_out: stateOut,
          screen_id: screen.id,
        }).catch((err) => req.log.warn({ err }, "render cache insert failed"));

        return { image: imageUrl, refresh, sha, state: stateOut };
      } catch (err) {
        req.log.error({ err }, "render failed; falling back");

        // PRD §7.5: prefer the last good image for this screen, then the
        // placeholder. Never 5xx if a displayable image exists.
        const lastGood = await getLastGoodForScreen(screen.id).catch(() => null);
        if (lastGood) {
          return { image: lastGood.image_url, refresh, sha: lastGood.sha1, state: stateOut };
        }

        const base = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;
        // Encoding is deterministic, so this sha matches the bytes /placeholder.jpg serves.
        const placeholder = await renderPlaceholder(cfg.width, cfg.height);
        return {
          image: `${base}/placeholder.jpg`,
          refresh: 1,
          sha: sha1Hex(placeholder),
          state: stateOut,
        };
      }
    }
  );
}
