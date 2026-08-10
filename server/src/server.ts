import "dotenv/config";

const REQUIRED_ENV = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

// Imported dynamically so dotenv populates process.env before modules read it.
const { buildApp } = await import("./app.js");

const app = await buildApp({ logger: true });
const port = parseInt(process.env.PORT ?? "8080", 10);
await app.listen({ port, host: "0.0.0.0" });
