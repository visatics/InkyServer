import postgres from "postgres";

let client: postgres.Sql | null = null;

/**
 * Lazy Postgres singleton. `prepare: false` is required: Supabase's pooler is
 * pgBouncer in transaction mode, which rejects prepared statements.
 */
export function db(): postgres.Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL must be set");
    client = postgres(url, { max: 5, prepare: false });
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
}
