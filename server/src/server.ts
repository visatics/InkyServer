import "dotenv/config";
import Fastify from "fastify";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

// Imported dynamically so dotenv populates process.env before modules read it.
const { deviceRoutes } = await import("./routes/device.js");
const { renderPlaceholder } = await import("./render/pipeline.js");

const app = Fastify({ logger: true });

/**
 * Locally-served fallback image: the render error path must not depend on
 * Supabase. Size comes from the query so it can match any device resolution.
 */
app.get<{ Querystring: { w?: string; h?: string } }>("/placeholder.jpg", async (req, reply) => {
  const width = Math.min(4096, Math.max(1, parseInt(req.query.w ?? "600", 10) || 600));
  const height = Math.min(4096, Math.max(1, parseInt(req.query.h ?? "448", 10) || 448));
  const jpeg = await renderPlaceholder(width, height);
  return reply.type("image/jpeg").send(jpeg);
});

app.get("/", async (_req, reply) => reply.redirect("/app"));

// Registered last: the /:uuid parameter must never shadow /api or /app.
await app.register(deviceRoutes);

const port = parseInt(process.env.PORT ?? "8080", 10);
await app.listen({ port, host: "0.0.0.0" });
