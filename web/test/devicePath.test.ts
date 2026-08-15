/**
 * Regression test for the dev-server proxy gap.
 *
 * Preview mode calls the device endpoint at the site root (`/<uuid>`), but in
 * dev the SPA is served by Vite on :5173 while the device endpoint lives on
 * Fastify :8080. Without a proxy rule Vite answers the request itself and 404s,
 * so Preview is broken under `npm run dev` — while working fine in production,
 * where Fastify serves both from one origin.
 *
 * The rule has to be narrow: a bare prefix would also swallow /app, /src,
 * /assets and Vite's own /@vite endpoints.
 */

import { describe, expect, it } from "vitest";
import { DEVICE_PATH_PATTERN, isDevicePath } from "../src/lib/devicePath";

describe("device endpoint proxy matching", () => {
  const uuid = "acaba2f9-13f8-485f-a06e-4f5d054312fc";

  it("matches a bare device path", () => {
    expect(isDevicePath(`/${uuid}`)).toBe(true);
  });

  it("matches a device path carrying client state", () => {
    expect(isDevicePath(`/${uuid}?screen=1&idx=0`)).toBe(true);
    expect(isDevicePath(`/${uuid}?screen=3&mode=dark&button=E`)).toBe(true);
  });

  it("matches regardless of case", () => {
    expect(isDevicePath(`/${uuid.toUpperCase()}`)).toBe(true);
  });

  it("does not match the SPA or its routes", () => {
    expect(isDevicePath("/app")).toBe(false);
    expect(isDevicePath("/app/")).toBe(false);
    expect(isDevicePath(`/app/devices/${uuid}/preview`)).toBe(false);
  });

  it("does not match Vite's own dev endpoints", () => {
    expect(isDevicePath("/@vite/client")).toBe(false);
    expect(isDevicePath("/src/main.tsx")).toBe(false);
    expect(isDevicePath("/assets/index-abc123.js")).toBe(false);
    expect(isDevicePath("/node_modules/.vite/deps/react.js")).toBe(false);
  });

  it("does not match the API or other server routes", () => {
    expect(isDevicePath("/api/devices")).toBe(false);
    expect(isDevicePath("/placeholder.jpg")).toBe(false);
    expect(isDevicePath("/")).toBe(false);
    expect(isDevicePath("/favicon.ico")).toBe(false);
  });

  it("does not match a malformed UUID", () => {
    expect(isDevicePath("/not-a-uuid")).toBe(false);
    expect(isDevicePath(`/${uuid}extra`)).toBe(false);
    expect(isDevicePath(`/${uuid}/nested`)).toBe(false);
  });

  /**
   * Vite compiles a proxy key beginning with "^" via `new RegExp(key)`, with no
   * flags — so the pattern must carry its own case handling and stay a valid
   * standalone source string.
   */
  it("exposes a pattern Vite can compile as a proxy key", () => {
    expect(DEVICE_PATH_PATTERN.startsWith("^")).toBe(true);
    const compiled = new RegExp(DEVICE_PATH_PATTERN);
    expect(compiled.test(`/${uuid}?screen=1`)).toBe(true);
    expect(compiled.test("/app/devices")).toBe(false);
  });
});
