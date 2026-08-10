/**
 * Supabase Storage access.
 *
 * Two buckets with different trust levels:
 * - `uploads`  (private) — user-supplied source images. Read server-side with
 *   the service role to render; never exposed to the device or the browser.
 * - `renders`  (public)  — finished images the device downloads unauthenticated.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const UPLOADS = "uploads";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

function rendersBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "renders";
}

/** Upload a finished render at a deterministic key and return its public URL. */
export async function uploadRender(key: string, jpeg: Buffer): Promise<string> {
  const storage = getClient().storage.from(rendersBucket());
  const { error } = await storage.upload(key, jpeg, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return storage.getPublicUrl(key).data.publicUrl;
}

/** Read a user-supplied source image from the private bucket. */
export async function downloadUpload(key: string): Promise<Buffer> {
  const { data, error } = await getClient().storage.from(UPLOADS).download(key);
  if (error) throw new Error(`uploads download failed (${key}): ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Store a validated, re-encoded source image in the private bucket. */
export async function uploadSource(key: string, jpeg: Buffer): Promise<void> {
  const { error } = await getClient()
    .storage.from(UPLOADS)
    .upload(key, jpeg, { upsert: true, contentType: "image/jpeg" });
  if (error) throw new Error(`uploads upload failed: ${error.message}`);
}

export async function removeSource(key: string): Promise<void> {
  const { error } = await getClient().storage.from(UPLOADS).remove([key]);
  if (error) throw new Error(`uploads remove failed: ${error.message}`);
}
