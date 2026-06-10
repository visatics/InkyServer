import type { FastifyInstance } from "fastify";
import { CONFIG_VERSION, DEVICE, type Screen } from "../config/device.js";
import {
  applyButton,
  applyRefresh,
  getScreen,
  initialState,
  parseState,
  renderStateFor,
  type State,
} from "../lib/state.js";
import { getLastGood, setLastGood } from "../lib/lastGood.js";
import { renderSlideshow } from "../render/slideshow.js";
import { renderDebug } from "../render/debug.js";
import { renderPlaceholder, sha1Hex, sha256Hex } from "../render/pipeline.js";
import { getCachedRender, insertRender, uploadRender } from "../storage/supabase.js";

interface DeviceParams {
  uuid: string;
}

async function renderProvider(
  screen: Screen,
  renderState: Record<string, string | number>
): Promise<Buffer> {
  if (screen.provider === "slideshow") {
    return renderSlideshow(screen, renderState, DEVICE.width, DEVICE.height);
  }
  return renderDebug(screen, renderState, DEVICE.width, DEVICE.height);
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: DeviceParams; Querystring: Record<string, unknown> }>(
    "/:uuid",
    async (req, reply) => {
      if (req.params.uuid !== DEVICE.uuid) {
        return reply.code(404).send({ error: "unknown device" });
      }

      // Exactly one of the three transition paths per request (PRD §8):
      // boot/reset -> initial state; button -> applyButton; timer -> applyRefresh.
      const { inbound, button } = parseState(req.query);
      let stateOut: State;
      if (inbound === null) {
        stateOut = initialState(DEVICE.defaultScreen);
      } else if (button !== undefined) {
        stateOut = applyButton(inbound, button);
      } else {
        stateOut = applyRefresh(inbound);
      }

      const screen = getScreen(stateOut.screen);
      const renderState = renderStateFor(screen, stateOut);
      const cacheKey = sha256Hex(
        [
          DEVICE.uuid,
          DEVICE.width,
          DEVICE.height,
          screen.provider,
          CONFIG_VERSION,
          JSON.stringify(renderState),
        ].join("|")
      );

      try {
        // Treat a cache-read failure as a miss rather than failing the request.
        const cached = await getCachedRender(cacheKey).catch((err) => {
          req.log.warn({ err }, "render cache lookup failed; rendering fresh");
          return null;
        });
        if (cached) {
          setLastGood(screen.ordinal, cached); // a cache hit is itself a good render
          return {
            image: cached.image_url,
            refresh: screen.refreshMinutes,
            sha: cached.sha1,
            state: stateOut,
          };
        }

        const jpeg = await renderProvider(screen, renderState);
        const sha = sha1Hex(jpeg);
        const imageUrl = await uploadRender(`${DEVICE.uuid}/${cacheKey}.jpg`, jpeg);

        // A failed cache write only costs a re-render next time; don't fail the response.
        await insertRender({
          cache_key: cacheKey,
          image_url: imageUrl,
          sha1: sha,
          state_out: stateOut,
        }).catch((err) => req.log.warn({ err }, "render cache insert failed"));

        setLastGood(screen.ordinal, { image_url: imageUrl, sha1: sha, state_out: stateOut });
        return { image: imageUrl, refresh: screen.refreshMinutes, sha, state: stateOut };
      } catch (err) {
        req.log.error({ err }, "render failed; falling back");

        // PRD §7.5: prefer the last good image for this screen, then the
        // placeholder. Never 5xx if a displayable image exists.
        const lastGood = getLastGood(screen.ordinal);
        if (lastGood) {
          return {
            image: lastGood.image_url,
            refresh: screen.refreshMinutes,
            sha: lastGood.sha1,
            state: stateOut,
          };
        }

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
    }
  );
}
