/**
 * ShunopsAI Command Server entrypoint (Powered by Fastify v5 & TypeBox).
 *
 * The application itself is assembled by `src/server/app.ts` from focused
 * plugins and route modules; this file binds it to a host and port.
 */
import * as dotenv from "dotenv";
import { createApp, loadAppConfig } from "./src/server/app.js";

dotenv.config();

const config = loadAppConfig();
const PORT = Number(process.env.PORT) || 4000;

async function bootstrap() {
  const app = await createApp(config);

  try {
    await app.listen({ port: PORT, host: config.host });
    console.log(`\n\x1b[32m\x1b[1m========================================================\x1b[0m`);
    console.log(`\x1b[32m\x1b[1m🚀 ShunopsAI Fastify Autonomous Engine Live on port ${PORT}\x1b[0m`);
    const authConfigured = Boolean(config.apiToken);
    console.log(`\x1b[36m👉 Bind:\x1b[0m         ${config.host}:${PORT}  (auth: ${authConfigured ? "enabled" : "disabled"})`);
    console.log(`\x1b[36m👉 Base URL:\x1b[0m     http://localhost:${PORT}`);
    console.log(`\x1b[36m👉 Health:\x1b[0m       http://localhost:${PORT}/health`);
    console.log(`\x1b[36m👉 Run Task:\x1b[0m     POST http://localhost:${PORT}/api/task (Hybrid Sync/Async)`);
    console.log(`\x1b[36m👉 Cloud Alert:\x1b[0m  POST http://localhost:${PORT}/api/webhook/cloud-alert`);
    console.log(`\x1b[36m👉 Widget:\x1b[0m       http://localhost:${PORT}/widget.js`);
    console.log(`\x1b[32m\x1b[1m========================================================\x1b[0m\n`);
  } catch (err: any) {
    console.error("Failed to start ShunopsAI Fastify Server:", err);
    process.exit(1);
  }
}

bootstrap();
