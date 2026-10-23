module.exports = {
  apps: [
    {
      name: "shunopsai-server",
      script: "server.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
      },
    },
    {
      name: "sentinel-cron",
      script: "src/cron/sentinel-cron.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      instances: 1,
      autorestart: false,
      watch: false,
      // Governance Invariant #7: Cadence is strictly 12 hours (0 */12 * * *)
      cron_restart: "0 */12 * * *",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "daily-autopilot",
      script: "src/cron/daily-autopilot.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      instances: 1,
      autorestart: false,
      watch: false,
      cron_restart: "0 6 * * *",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
