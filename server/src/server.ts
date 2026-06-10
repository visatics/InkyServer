import "dotenv/config";
import Fastify from "fastify";

const REQUIRED_ENV = ["DEVICE_UUID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

// Imported dynamically so dotenv populates process.env before config modules read it.
const { deviceRoutes } = await import("./routes/device.js");
const { DEVICE } = await import("./config/device.js");
const { renderPlaceholder } = await import("./render/pipeline.js");

const app = Fastify({ logger: true });

// Locally-served fallback image: the render error path must not depend on Supabase.
app.get("/placeholder.jpg", async (_req, reply) => {
  const jpeg = await renderPlaceholder(DEVICE.width, DEVICE.height);
  return reply.type("image/jpeg").send(jpeg);
});

await app.register(deviceRoutes);

const port = parseInt(process.env.PORT ?? "8080", 10);
await app.listen({ port, host: "0.0.0.0" });
