/**
 * Supabase JWT verification for the management API (PRD §6).
 *
 * Devices stay unauthenticated — this guards `/api` only. The backend never
 * handles raw passwords: Supabase Auth owns registration, verification, reset
 * and session issuance, and we verify the resulting token.
 *
 * Supabase projects issue either legacy HS256 tokens signed with a shared
 * secret, or newer asymmetric tokens published via JWKS. Both are supported:
 * set SUPABASE_JWT_SECRET for the former, otherwise the project's JWKS
 * endpoint is used.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function verify(token: string): Promise<JWTPayload> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return payload;
  }
  if (!jwks) {
    const url = process.env.SUPABASE_URL;
    if (!url) throw new Error("SUPABASE_URL must be set to verify tokens via JWKS");
    jwks = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
  }
  const { payload } = await jwtVerify(token, jwks);
  return payload;
}

/**
 * Fastify preHandler. Sets `req.userId` from the token subject, or replies 401.
 * Every /api handler scopes its queries by this id — ownership is enforced here
 * and in the repositories, because the service-role key bypasses RLS.
 */
export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) {
    return void reply.code(401).send({ error: "missing bearer token" });
  }
  try {
    const payload = await verify(token);
    if (typeof payload.sub !== "string" || payload.sub === "") {
      return void reply.code(401).send({ error: "token has no subject" });
    }
    req.userId = payload.sub;
  } catch {
    return void reply.code(401).send({ error: "invalid token" });
  }
}
