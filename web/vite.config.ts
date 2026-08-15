import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { DEVICE_PATH_PATTERN } from "./src/lib/devicePath";

/**
 * The Supabase URL and anon key are read from ../server/.env rather than a
 * second copy here. Both are public by design (the anon key ships to the
 * browser), and a single source stops the two drifting apart.
 */
const env = loadEnv({ path: path.resolve(__dirname, "../server/.env") }).parsed ?? {};

export default defineConfig({
  plugins: [react()],
  // Fastify serves the built assets under /app/, so they must be requested there.
  base: "/app/",
  build: { outDir: "dist", emptyOutDir: true },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.SUPABASE_URL ?? ""),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(env.SUPABASE_ANON_KEY ?? ""),
  },
  server: {
    port: 5173,
    /**
     * In dev the SPA runs on Vite and everything else stays on Fastify.
     *
     * The device endpoint entry is essential, not cosmetic: Preview mode is a
     * software device calling `GET /<uuid>?state&button=X` at the site root, so
     * without this Vite answers that request itself and 404s, and Preview is
     * broken in dev while working in production (where Fastify serves both from
     * one origin). It has to be a precise UUID pattern — a bare prefix would
     * also swallow /app, /src, /assets and Vite's own /@vite endpoints.
     */
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/placeholder.jpg": { target: "http://localhost:8080", changeOrigin: true },
      [DEVICE_PATH_PATTERN]: { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
