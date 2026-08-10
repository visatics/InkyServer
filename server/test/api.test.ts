/**
 * Acceptance tests for 0.3a criteria 4 (owner scoping) and 7 (route precedence).
 *
 * These run against the real database — there is no mocking layer, and the SQL
 * joins are precisely the thing worth testing. Skipped when DATABASE_URL is
 * absent so the suite still runs on a bare checkout.
 *
 * Identity is carried by an HS256 token signed with SUPABASE_JWT_SECRET. Real
 * Supabase-issued tokens verify through the same path with no code change.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import type { FastifyInstance } from "fastify";

const SECRET = "test-secret-at-least-32-bytes-long-for-hs256!!";
const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

const hasDb = !!process.env.DATABASE_URL;

let app: FastifyInstance;
let sql: import("postgres").Sql;
let tokenA: string;
let tokenB: string;
let deviceA: string;
let screenA: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const sign = (sub: string) =>
  new SignJWT({ sub })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));

describe.skipIf(!hasDb)("management API", () => {
  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const { db } = await import("../src/db/client.js");
    const { buildApp } = await import("../src/app.js");
    sql = db();
    app = await buildApp();

    for (const [id, email] of [
      [USER_A, "a@test.local"],
      [USER_B, "b@test.local"],
    ]) {
      await sql`
        insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
        values (${id}, '00000000-0000-0000-0000-000000000000',
                'authenticated','authenticated', ${email}, now())
        on conflict (id) do nothing`;
    }
    await sql`delete from devices where user_id in (${USER_A}, ${USER_B})`;

    tokenA = await sign(USER_A);
    tokenB = await sign(USER_B);

    const created = await app.inject({
      method: "POST",
      url: "/api/devices",
      headers: auth(tokenA),
      payload: { presetId: "inky-frame-5.7" },
    });
    deviceA = created.json().id;

    const screen = await app.inject({
      method: "POST",
      url: `/api/devices/${deviceA}/screens`,
      headers: auth(tokenA),
      payload: { name: "S1", provider: "slideshow", refreshMinutes: 5 },
    });
    screenA = screen.json().id;
  });

  afterAll(async () => {
    if (!hasDb) return;
    await sql`delete from devices where user_id in (${USER_A}, ${USER_B})`;
    await app?.close();
    await sql?.end();
  });

  describe("authentication", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await app.inject({ method: "GET", url: "/api/devices" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("device creation", () => {
    it("creates from a preset with the preset's resolution", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/devices/${deviceA}`,
        headers: auth(tokenA),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ width_px: 600, height_px: 448, button_count: 5 });
      expect(res.json().public_uuid).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("creates a custom device", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/devices",
        headers: auth(tokenA),
        payload: { name: "Custom", width: 800, height: 480, buttonCount: 4 },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ width_px: 800, height_px: 480, button_count: 4 });
    });

    it("rejects an unknown preset", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/devices",
        headers: auth(tokenA),
        payload: { presetId: "not-a-real-preset" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects an out-of-range resolution", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/devices",
        headers: auth(tokenA),
        payload: { name: "Huge", width: 99999, height: 480, buttonCount: 5 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("owner scoping (criterion 4)", () => {
    it("does not list another user's devices", async () => {
      const res = await app.inject({ method: "GET", url: "/api/devices", headers: auth(tokenB) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("404s reading another user's device", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/devices/${deviceA}`,
        headers: auth(tokenB),
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s patching another user's device, and leaves it intact", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/devices/${deviceA}`,
        headers: auth(tokenB),
        payload: { name: "hijacked" },
      });
      expect(res.statusCode).toBe(404);
      const check = await app.inject({
        method: "GET",
        url: `/api/devices/${deviceA}`,
        headers: auth(tokenA),
      });
      expect(check.json().name).not.toBe("hijacked");
    });

    it("404s deleting another user's device, and leaves it intact", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/devices/${deviceA}`,
        headers: auth(tokenB),
      });
      expect(res.statusCode).toBe(404);
      const check = await app.inject({
        method: "GET",
        url: `/api/devices/${deviceA}`,
        headers: auth(tokenA),
      });
      expect(check.statusCode).toBe(200);
    });

    it("404s regenerating another user's UUID", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/devices/${deviceA}/regenerate-uuid`,
        headers: auth(tokenB),
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s reading another user's screens", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/devices/${deviceA}/screens`,
        headers: auth(tokenB),
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s patching another user's screen", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/screens/${screenA}`,
        headers: auth(tokenB),
        payload: { name: "hijacked" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s writing a mapping on another user's device", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/devices/${deviceA}/mappings/A`,
        headers: auth(tokenB),
        payload: { type: "goto", screen: 1 },
      });
      expect(res.statusCode).toBe(404);
    });

    it("404s listing another user's assets", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/screens/${screenA}/assets`,
        headers: auth(tokenB),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("button mappings round-trip as engine JSON (criterion 11 groundwork)", () => {
    it("stores and returns the exact ButtonAction shape", async () => {
      const actions = {
        A: { type: "goto", screen: 1 },
        D: { type: "slideshow", dir: "next" },
        E: { type: "cycle", key: "mode", values: ["light", "dark", "blue"] },
      };
      for (const [button, action] of Object.entries(actions)) {
        const put = await app.inject({
          method: "PUT",
          url: `/api/devices/${deviceA}/mappings/${button}`,
          headers: auth(tokenA),
          payload: action,
        });
        expect(put.statusCode).toBe(200);
      }
      const res = await app.inject({
        method: "GET",
        url: `/api/devices/${deviceA}/mappings`,
        headers: auth(tokenA),
      });
      // Must be objects, not JSON strings — postgres.js double-encodes if a
      // handler stringifies before binding, which silently breaks the engine.
      expect(res.json()).toMatchObject(actions);
    });

    it("rejects a malformed action", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/devices/${deviceA}/mappings/A`,
        headers: auth(tokenA),
        payload: { type: "teleport", screen: 1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects an invalid button label", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/devices/${deviceA}/mappings/Z`,
        headers: auth(tokenA),
        payload: { type: "none" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("screen overrides round-trip", () => {
    it("stores button_overrides as an object the engine can read", async () => {
      const overrides = { E: { type: "cycle", key: "mode", values: ["light", "dark"] } };
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/screens/${screenA}`,
        headers: auth(tokenA),
        payload: { buttonOverrides: overrides },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().button_overrides).toEqual(overrides);
    });
  });

  describe("route precedence (criterion 7)", () => {
    it("resolves /api without matching the device route", async () => {
      const res = await app.inject({ method: "GET", url: "/api/devices" });
      expect(res.statusCode).toBe(401); // auth rejected it — not a 404 device lookup
    });

    it("404s a non-UUID root path", async () => {
      const res = await app.inject({ method: "GET", url: "/favicon.ico" });
      expect(res.statusCode).toBe(404);
    });

    it("404s an unknown but well-formed device UUID", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "unknown device" });
    });

    it("redirects / to /app", async () => {
      const res = await app.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/app");
    });
  });
});
