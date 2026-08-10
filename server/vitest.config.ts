import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Loads .env so DB-backed tests can reach Postgres and Storage. Tests that
    // need a database self-skip when DATABASE_URL is absent, so a bare checkout
    // still runs the pure unit suite.
    setupFiles: ["dotenv/config"],
    // The API tests share one database; running files in parallel would let
    // them race on the same fixture rows.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
