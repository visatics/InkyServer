/**
 * Matches the device endpoint's own path shape (`/<uuid>`, optionally carrying
 * client state as a query string).
 *
 * Preview mode is a software device: it calls `GET /:uuid?state&button=X` at the
 * site root, exactly as firmware does. In production Fastify serves both the SPA
 * and that endpoint from one origin, so it just works. Under `npm run dev` the
 * SPA is on Vite :5173 and the endpoint is on Fastify :8080, so Vite must proxy
 * it — and the rule has to be this narrow, because a bare prefix would also
 * capture /app, /src, /assets and Vite's own /@vite endpoints.
 *
 * Kept in step with UUID_RE in server/src/routes/device.ts. Both accept any
 * RFC-4122 version so a hand-seeded UUID is not silently rejected.
 */
export const DEVICE_PATH_PATTERN =
  "^/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}(?:\\?.*)?$";

const DEVICE_PATH_RE = new RegExp(DEVICE_PATH_PATTERN);

export function isDevicePath(url: string): boolean {
  return DEVICE_PATH_RE.test(url);
}
