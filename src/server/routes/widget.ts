import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { WIDGET_JS_CONTENT } from "../../widget-script.js";

/**
 * Unified Embeddable Website Chat Widget Delivery - Fastify Plugin.
 * Serves canonical widget script with Proof-of-Work Bot-Shield & Turnstile support.
 * Optimized with ETag & 304 Not Modified caching for zero redundant bandwidth.
 */
export async function widgetRoutes(app: FastifyInstance): Promise<void> {
  const widgetFilePath = path.resolve(process.cwd(), "public", "widget.js");
  let cachedWidgetScript: string | null = null;
  let widgetEtag = "";

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
      widgetEtag = `"${crypto.createHash("sha256").update(cachedWidgetScript).digest("hex").slice(0, 16)}"`;
    }

    if (req.headers["if-none-match"] === widgetEtag) {
      return reply.code(304).send();
    }

    reply.header("ETag", widgetEtag);
    return reply.type("application/javascript; charset=utf-8").send(cachedWidgetScript);
  });
}
