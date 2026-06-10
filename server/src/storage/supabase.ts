import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { State } from "../lib/state.js";

export interface RenderRow {
  cache_key: string;
  image_url: string;
  sha1: string;
  state_out: State;
}

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

function bucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "renders";
}

/** Look up a finished render by cache key; null on miss. */
export async function getCachedRender(cacheKey: string): Promise<RenderRow | null> {
  const { data, error } = await getClient()
    .from("renders")
    .select("cache_key, image_url, sha1, state_out")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error) throw new Error(`renders lookup failed: ${error.message}`);
  return (data as RenderRow | null) ?? null;
}

export async function insertRender(row: RenderRow): Promise<void> {
  const { error } = await getClient().from("renders").upsert(row);
  if (error) throw new Error(`renders insert failed: ${error.message}`);
}

/** Upload a JPEG at a deterministic key and return its public URL. */
export async function uploadRender(key: string, jpeg: Buffer): Promise<string> {
  const storage = getClient().storage.from(bucket());
  const { error } = await storage.upload(key, jpeg, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return storage.getPublicUrl(key).data.publicUrl;
}
