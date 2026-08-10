import { describe, expect, it, beforeAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { requireUser } from "../src/auth/verifyJwt.js";

const SECRET = "test-secret-at-least-32-bytes-long-for-hs256!!";

function app(): FastifyInstance {
  const f = Fastify();
  f.get("/api/whoami", { preHandler: requireUser }, async (req) => ({ userId: req.userId }));
  return f;
}

const sign = (payload: Record<string, unknown>, secret = SECRET) =>
  new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));

describe("requireUser", () => {
  beforeAll(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });

  it("401s with no Authorization header", async () => {
    const res = await app().inject({ method: "GET", url: "/api/whoami" });
    expect(res.statusCode).toBe(401);
  });

  it("401s on a malformed bearer token", async () => {
    const res = await app().inject({
      method: "GET",
      url: "/api/whoami",
      headers: { authorization: "Bearer not.a.jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("401s on a token signed with the wrong secret", async () => {
    const token = await sign({ sub: "user-1" }, "a-completely-different-secret-of-length-32!");
    const res = await app().inject({
      method: "GET",
      url: "/api/whoami",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("401s on an expired token", async () => {
    const token = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET));
    const res = await app().inject({
      method: "GET",
      url: "/api/whoami",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("401s when the token carries no subject", async () => {
    const token = await sign({ email: "nobody@example.com" });
    const res = await app().inject({
      method: "GET",
      url: "/api/whoami",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a valid token and exposes the subject as userId", async () => {
    const token = await sign({ sub: "user-42" });
    const res = await app().inject({
      method: "GET",
      url: "/api/whoami",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: "user-42" });
  });
});
