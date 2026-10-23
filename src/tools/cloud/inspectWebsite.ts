import { isPrivateHost } from "./net.js";

const MAX_REDIRECTS = 3;
const PREVIEW_CHARS = 6000;

type SafeTarget = { url: URL } | { error: string };

/**
 * Validate a URL and reconstruct it from verified components, which eliminates
 * request-forgery sinks (CodeQL js/request-forgery).
 */
function buildSafeTarget(currentUrl: string): SafeTarget {
  let parsed: URL;
  try {
    parsed = new URL(currentUrl);
  } catch {
    return { error: `Website Inspection Failed: the provided URL is not valid.` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `Website Inspection blocked: only http(s) URLs are permitted.` };
  }
  if (!parsed.hostname || isPrivateHost(parsed.hostname) || !/^[a-zA-Z0-9_.-]+$/.test(parsed.hostname)) {
    return {
      error: `Website Inspection blocked: requests to internal or cloud metadata endpoints are not permitted.`,
    };
  }

  const safeProtocol = parsed.protocol === "http:" ? "http:" : "https:";
  const hostMatch = parsed.hostname.match(/^[a-zA-Z0-9_.-]+$/);
  if (!hostMatch) {
    return { error: `Website Inspection blocked: invalid target hostname characters.` };
  }
  const safeHost = hostMatch[0];
  const safePort = parsed.port ? `:${Number(parsed.port)}` : "";
  const safeOrigin = `${safeProtocol}//${safeHost}${safePort}`;
  const safePath = parsed.pathname.startsWith("/") ? parsed.pathname : `/${parsed.pathname}`;
  const safeSearch = parsed.search;
  const safeHref = `${safeOrigin}${safePath}${safeSearch}`;
  return { url: new URL(safeHref) };
}

function extractPageMeta(html: string): {
  title: string;
  metaDescription: string;
  headings: string[];
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  const descMatch = html.match(/<meta[^>]+name=["\x27]description["\x27][^>]+content=["\x27]([^"\x27]+)["\x27]/i);
  const metaDescription = descMatch && descMatch[1] ? descMatch[1].trim() : "";

  const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((m) => (m && m[1] ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean)
    .slice(0, 15);

  return { title, metaDescription, headings };
}

/** Strip markup and unescape entities into readable text. */
function toReadableText(html: string): string {
  // Strip script, style, svg, noscript tags thoroughly (handling arbitrary whitespace and attributes)
  let cleanedHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\b[^>]*>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\b[^>]*>/gi, " ");

  // Repeated tag stripping to prevent nested tag injection vulnerabilities (CWE-116)
  let prevHtml = "";
  while (cleanedHtml !== prevHtml) {
    prevHtml = cleanedHtml;
    cleanedHtml = cleanedHtml.replace(/<[^>]*>/g, " ");
  }

  // Unescape entities specific-first, ampersand last (anti double-escaping)
  return cleanedHtml
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PREVIEW_CHARS);
}

/** Paragraphs from readable text that mention any focus term (max 6). */
function findFocusExcerpts(readableText: string, focusQuery?: string): string[] {
  if (!focusQuery || typeof focusQuery !== "string" || !focusQuery.trim()) return [];
  const terms = focusQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const blocks = readableText.split(/\n\n+/).map((b) => b.trim()).filter((b) => b.length > 30);
  const excerpts: string[] = [];
  for (const block of blocks) {
    const bLow = block.toLowerCase();
    if (terms.some((t) => bLow.includes(t))) {
      excerpts.push(block.slice(0, 450));
      if (excerpts.length >= 6) break;
    }
  }
  return excerpts;
}

function jsonPreview(
  url: string,
  res: Response,
  latency: number,
  contentType: string,
  bodyText: string
): string {
  return JSON.stringify(
    {
      url,
      status: res.status,
      statusText: res.statusText,
      contentType,
      latencyMs: latency,
      contentLength: bodyText.length,
      jsonContent: bodyText.slice(0, PREVIEW_CHARS),
    },
    null,
    2
  );
}

/**
 * Fetch any public URL or API and report title, description, headings, latency
 * and readable text. Redirects are followed manually so every hop is validated.
 */
export async function inspectWebsite(url: string, focusQuery?: string): Promise<string> {
  let currentUrl = url.startsWith("http") ? url : `https://${url}`;
  const start = Date.now();

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = buildSafeTarget(currentUrl);
      if ("error" in target) return target.error;
      const safeUrl = target.url;

      const res = await fetch(safeUrl, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "AutonomousAgent/1.0 (HealthCheck)" },
        signal: AbortSignal.timeout(15000),
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return JSON.stringify(
            {
              url: safeUrl.href,
              status: res.status,
              statusText: res.statusText,
              latencyMs: Date.now() - start,
              contentLength: 0,
              htmlPreview: "(Redirect response without Location header)",
            },
            null,
            2
          );
        }
        if (hop === MAX_REDIRECTS) {
          return `Website Inspection blocked: exceeded maximum redirect hops (${MAX_REDIRECTS}).`;
        }
        const safeOrigin = `${safeUrl.protocol}//${safeUrl.host}`;
        currentUrl = new URL(location, safeOrigin).toString();
        continue;
      }

      const latency = Date.now() - start;
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const bodyText = await res.text();

      if (contentType.includes("application/json")) {
        return jsonPreview(safeUrl.href, res, latency, contentType, bodyText);
      }

      const { title, metaDescription, headings } = extractPageMeta(bodyText);
      const readableText = toReadableText(bodyText);
      const focusedExcerpts = findFocusExcerpts(readableText, focusQuery);

      return JSON.stringify(
        {
          url: currentUrl,
          status: res.status,
          statusText: res.statusText,
          latencyMs: latency,
          contentLength: bodyText.length,
          title,
          metaDescription,
          headings,
          ...(focusedExcerpts.length > 0 ? { focusedExcerpts } : {}),
          readableText,
          htmlPreview: bodyText.slice(0, 400).replace(/\s+/g, " "),
        },
        null,
        2
      );
    }
    return `Website Inspection blocked: redirect loop detected.`;
  } catch (err: any) {
    const safeMsg = (err.message || "Unknown error").replace(/[\n\r]/g, " ").slice(0, 200);
    return `Website Inspection Failed: ${safeMsg}`;
  }
}
