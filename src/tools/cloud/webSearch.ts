export interface WebSearchOptions {
  provider?: "tavily" | "brave" | undefined;
  apiKey?: string | undefined;
  maxResults?: number | undefined;
}

const AGENT_UA = "ShunopsAI-Agent/1.0";

function searchHeaders(extra: Record<string, string>): Record<string, string> {
  return { Accept: "application/json", "User-Agent": AGENT_UA, ...extra };
}

function formatTavily(data: any, cleanQuery: string): string {
  const items = (data?.results || []).map(
    (r: any, idx: number) =>
      `${idx + 1}. [${r.title || "Result"}](${r.url || ""})\n   ${String(r.content || "").slice(0, 300)}`
  );
  return [
    data?.answer ? `Direct Answer: ${data.answer}\n` : "",
    `Tavily Search Results for "${cleanQuery}":`,
    items.join("\n\n") || "No results found.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBrave(data: any, cleanQuery: string): string {
  const results = data?.web?.results || [];
  const items = results.map(
    (r: any, idx: number) =>
      `${idx + 1}. [${r.title || "Result"}](${r.url || ""})\n   ${String(r.description || "").slice(0, 300)}`
  );
  return `Brave Search Results for "${cleanQuery}":\n${items.join("\n\n") || "No results found."}`;
}

async function searchTavily(cleanQuery: string, count: number, key: string): Promise<string> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query: cleanQuery,
        max_results: count,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      return `Tavily Search Error (${res.status}): ${res.statusText}`;
    }
    return formatTavily(await res.json(), cleanQuery);
  } catch (err: any) {
    return `Tavily Search Error: ${err.message}`;
  }
}

async function searchBrave(cleanQuery: string, count: number, key: string): Promise<string> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(cleanQuery)}&count=${count}`;
    const res = await fetch(url, {
      method: "GET",
      redirect: "error",
      headers: searchHeaders({ "X-Subscription-Token": key }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      return `Brave Search Error (${res.status}): ${res.statusText}`;
    }
    return formatBrave(await res.json(), cleanQuery);
  } catch (err: any) {
    return `Brave Search Error: ${err.message}`;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/** Google News RSS items, newest first in feed order. */
function collectGoogleNews(rawXml: string, count: number): string[] {
  const out: string[] = [];
  const itemMatches = (rawXml.match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, Math.min(count, 5));
  for (const item of itemMatches) {
    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);
    const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    if (!titleMatch?.[1]) continue;
    let cleanTitle = titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    cleanTitle = decodeEntities(cleanTitle);
    const link = (linkMatch?.[1] || "").trim();
    const pubDate = (pubDateMatch?.[1] || "").trim();
    const src = (sourceMatch?.[1] || "").trim();
    out.push(
      `• [News: ${cleanTitle}](${link || "https://news.google.com"})${src ? ` (Source: ${src})` : ""}${pubDate ? ` [${pubDate}]` : ""}`
    );
  }
  return out;
}

/** DuckDuckGo instant answer plus related topics. */
function collectDuckDuckGo(ddg: any, cleanQuery: string): string[] {
  const out: string[] = [];
  if (ddg.AbstractText) {
    out.push(`• [DuckDuckGo Instant Answer: ${ddg.Heading || cleanQuery}](${ddg.AbstractURL || "https://duckduckgo.com"})
  ${ddg.AbstractText}`);
  }
  if (Array.isArray(ddg.RelatedTopics)) {
    for (const topic of ddg.RelatedTopics.slice(0, 4)) {
      if (topic && topic.Text && topic.FirstURL) {
        out.push(`• [${topic.Text.slice(0, 90)}](${topic.FirstURL})
  ${topic.Text}`);
      }
    }
  }
  return out;
}

/** Wikipedia search snippets with tags stripped. */
function collectWikipedia(wikiVal: any): string[] {
  const out: string[] = [];
  const wikiItems: any[] = wikiVal?.query?.search || [];
  for (const item of wikiItems.slice(0, 4)) {
    let cleanSnippet = String(item.snippet || "");
    let prev = "";
    while (cleanSnippet !== prev) {
      prev = cleanSnippet;
      cleanSnippet = cleanSnippet.replace(/<[^>]*>/g, "");
    }
    cleanSnippet = decodeEntities(cleanSnippet.replace(/[<>]/g, ""));
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title || "").replace(/\s+/g, "_"))}`;
    out.push(`• [Wikipedia: ${item.title}](${url})
  ${cleanSnippet}`);
  }
  return out;
}

/** HackerNews Algolia hits. */
function collectHackerNews(hnVal: any): string[] {
  const out: string[] = [];
  const hits: any[] = hnVal?.hits || [];
  for (const hit of hits.slice(0, 4)) {
    if (hit && hit.title) {
      const url = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      out.push(`• [HackerNews: ${hit.title}](${url}) (points: ${hit.points || 0}, comments: ${hit.num_comments || 0})`);
    }
  }
  return out;
}

/**
 * Zero-Key Multi-Source Live Web Search Engine: Google News RSS + Wikipedia +
 * DuckDuckGo Instant Answer + HackerNews Algolia, queried in parallel.
 */
async function searchZeroKeySources(cleanQuery: string, count: number): Promise<string[]> {
  const [newsRes, ddgRes, wikiRes, hnRes] = await Promise.allSettled([
    fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(cleanQuery)}&hl=en-IN&gl=IN&ceid=IN:en`, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/xml, text/xml", "User-Agent": AGENT_UA },
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.text() : null)),

    fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=1`, {
      method: "GET",
      redirect: "error",
      headers: searchHeaders({}),
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.json() : null)),

    fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&utf8=&format=json&srlimit=${Math.min(count, 5)}`, {
      method: "GET",
      redirect: "error",
      headers: searchHeaders({}),
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.json() : null)),

    fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(cleanQuery)}&hitsPerPage=${Math.min(count, 5)}`, {
      method: "GET",
      redirect: "error",
      headers: searchHeaders({}),
      signal: AbortSignal.timeout(8000),
    }).then((r) => (r.ok ? r.json() : null)),
  ]);

  const results: string[] = [];
  if (newsRes.status === "fulfilled" && newsRes.value) {
    results.push(...collectGoogleNews(String(newsRes.value), count));
  }
  if (ddgRes.status === "fulfilled" && ddgRes.value) {
    results.push(...collectDuckDuckGo(ddgRes.value, cleanQuery));
  }
  if (wikiRes.status === "fulfilled" && wikiRes.value) {
    results.push(...collectWikipedia(wikiRes.value));
  }
  if (hnRes.status === "fulfilled" && hnRes.value) {
    results.push(...collectHackerNews(hnRes.value));
  }
  return results;
}

/**
 * Live web search using Tavily, Brave, or the keyless multi-source engine.
 */
export async function executeWebSearch(
  query: string,
  opts: WebSearchOptions = {}
): Promise<string> {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return "Error: Search query cannot be empty.";

  const count = Math.min(Math.max(Number(opts.maxResults) || 5, 1), 10);
  const tavilyKey =
    opts.provider === "tavily" ? opts.apiKey : (!opts.provider ? process.env.TAVILY_API_KEY : undefined);
  const braveKey =
    opts.provider === "brave" ? opts.apiKey : (!opts.provider ? process.env.BRAVE_API_KEY : undefined);

  if (tavilyKey) {
    return searchTavily(cleanQuery, count, tavilyKey);
  }
  if (braveKey) {
    return searchBrave(cleanQuery, count, braveKey);
  }

  const resultsOut = await searchZeroKeySources(cleanQuery, count);
  if (resultsOut.length > 0) {
    return `Live Web Search Results for "${cleanQuery}" (Zero-Key Multi-Source Engine):\n\n${resultsOut.slice(0, count + 3).join("\n\n")}`;
  }

  return `No live web search results found for "${cleanQuery}". Try refining your search keywords or use inspect_website with a direct URL.`;
}
