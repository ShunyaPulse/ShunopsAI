/**
 * ShunopsAI Command Server entrypoint.
 *
 * The application itself is assembled by `src/server/app.ts` from focused
 * middleware and route modules; this file only binds it to a port.
 */
import * as dotenv from "dotenv";
import { createApp, loadAppConfig } from "./src/server/app.js";

dotenv.config();

const config = loadAppConfig();
const PORT = Number(process.env.PORT) || 4000;

const app = createApp(config);

// Start Server
app.listen(PORT, config.host, () => {
  console.log(`\n\x1b[32m\x1b[1m========================================================\x1b[0m`);
  console.log(`\x1b[32m\x1b[1m🚀 Multi-Agent Autonomous API Server Live on port ${PORT}\x1b[0m`);
  const authConfigured = Boolean(config.apiToken);
  console.log(`\x1b[36m👉 Bind:\x1b[0m     ${config.host}:${PORT}  (auth: ${authConfigured ? "enabled" : "disabled"})`);
  console.log(`\x1b[36m👉 Base URL:\x1b[0m http://localhost:${PORT}`);
  console.log(`\x1b[36m👉 Health:\x1b[0m   http://localhost:${PORT}/health`);
  console.log(`\x1b[36m👉 Run Task:\x1b[0m POST http://localhost:${PORT}/api/task`);
  console.log(`\x1b[36m👉 Widget:\x1b[0m   http://localhost:${PORT}/widget.js`);
  console.log(`\x1b[32m\x1b[1m========================================================\x1b[0m\n`);
});
