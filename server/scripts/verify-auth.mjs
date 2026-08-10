/**
 * Closes 0.3a acceptance criterion 5: proves a genuine Supabase-issued access
 * token verifies through the backend's requireUser, and that the resulting
 * identity is correctly scoped.
 *
 * Creates a throwaway user, signs in, calls /api with the real token, then
 * deletes the user. Usage: node --env-file=.env scripts/verify-auth.mjs
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { decodeProtectedHeader } from "jose";
import { buildApp } from "../src/app.js";

const EMAIL = `verify-${Date.now()}@example.com`;
const PASSWORD = "correct-horse-battery-staple-42";

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const ok = (label, pass, detail = "") =>
  console.log(`  ${pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? "  " + detail : ""}`);

let userId = null;
let failures = 0;
const check = (label, pass, detail) => {
  ok(label, pass, detail);
  if (!pass) failures++;
};

try {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (createErr) throw new Error(`createUser: ${createErr.message}`);
  userId = created.user.id;
  check("admin createUser (register + verify)", !!userId, userId);

  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`);
  const token = session.session.access_token;
  check("signInWithPassword returns an access token", !!token);

  const header = decodeProtectedHeader(token);
  console.log(`  → token alg=${header.alg} kid=${header.kid ?? "(none)"}`);

  const app = await buildApp();

  const unauth = await app.inject({ method: "GET", url: "/api/devices" });
  check("no token -> 401", unauth.statusCode === 401, String(unauth.statusCode));

  const res = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: { authorization: `Bearer ${token}` },
  });
  check("real Supabase token -> 200", res.statusCode === 200, String(res.statusCode));
  check("new user owns no devices", res.statusCode === 200 && res.json().length === 0);

  const createdDevice = await app.inject({
    method: "POST",
    url: "/api/devices",
    headers: { authorization: `Bearer ${token}` },
    payload: { presetId: "inky-frame-7.3" },
  });
  check("can create a device with a real token", createdDevice.statusCode === 201);

  // Informational, not a gate. Supabase's built-in mailer refuses throwaway
  // domains, so this exercises its validation rather than anything of ours.
  // Configure custom SMTP (PRD §4 suggests Resend) to test delivery for real.
  const reset = await anon.auth.resetPasswordForEmail(EMAIL);
  console.log(
    reset.error
      ? `  \x1b[33mSKIP\x1b[0m password reset delivery (Supabase mailer: ${reset.error.message})`
      : "  \x1b[32mPASS\x1b[0m password reset request accepted"
  );

  await app.close();
} catch (err) {
  console.error("\n  ERROR:", err.message);
  failures++;
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
    console.log(`  cleaned up ${EMAIL}`);
  }
  const { closeDb } = await import("../src/db/client.js");
  await closeDb();
}

console.log(failures === 0 ? "\n  all auth checks passed" : `\n  ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
