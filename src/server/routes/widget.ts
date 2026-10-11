import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WIDGET_JS_CONTENT } from "../../widget-script.js";

/**
 * Unified Embeddable Website Chat Widget Delivery - Fastify Plugin.
 * Serves canonical widget script with Proof-of-Work Bot-Shield & Turnstile support.
 * Synchronized with Cloudflare edge worker endpoint to eliminate architectural drift.
 */
export async function widgetRoutes(app: FastifyInstance): Promise<void> {
  const widgetFilePath = path.resolve(process.cwd(), "public", "widget.js");
  let cachedWidgetScript: string | null = null;

  app.get("/widget.js", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    reply.header("Access-Control-Allow-Origin", "*");

    if (!cachedWidgetScript) {
      try {
        cachedWidgetScript = await fs.readFile(widgetFilePath, "utf-8");
      } catch {
        cachedWidgetScript = WIDGET_JS_CONTENT;
      }
    }

    return reply.type("application/javascript; charset=utf-8").send(cachedWidgetScript);
  });
}
