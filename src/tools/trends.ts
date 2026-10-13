import { geminiGenerate } from "./video.js";

export interface TrendingItem {
  title: string;
  approx_traffic: string;
  news_title: string;
  news_snippet?: string | undefined;
  news_url?: string | undefined;
  category_codes?: number[] | undefined;
  categories?: string[] | undefined;
  source?: "web_ui" | "rss" | undefined;
}

export interface CuratedTopicResult {
  selected_trend: string;
  trend_reason: string;
  documentary_topic: string;
  category: string;
  value_hook: string;
  language: string;
  target_duration_minutes: number;
}

export const GOOGLE_TRENDS_CATEGORY_MAP: Record<number, string> = {
  1: "Automotive & Mobility",
  3: "Business & Finance",
  4: "Entertainment",
  6: "Gaming & Pop Culture",
  7: "Local & Regional",
  8: "Viral & Social Media",
  9: "Education & Exams",
  10: "Law & Governance",
  11: "Sports & Leagues",
  14: "Civic & Government",
  15: "Science & Astronomy",
  16: "Retail & Commerce",
  17: "Sports Milestone",
  18: "Technology & AI",
  20: "Climate & Earth Science",
};

/**
 * Fetches real-time active search trends directly from the Google Trends Web UI.
 * Extracts client hydration data (AF_initDataCallback with ds:0) containing ~300+ live trends.
 */
export async function fetchGoogleTrendsWebUI(geo: string = "IN"): Promise<TrendingItem[]> {
  const url = `https://trends.google.com/trending?geo=${encodeURIComponent(geo)}&hours=24`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(`Google Trends Web UI request failed: HTTP ${res.status}`);
  }

  const html = await res.text();
  const match = html.match(/AF_initDataCallback\s*\(\s*\{key:\s*'ds:0'[\s\S]*?data:([\s\S]*?),\s*sideChannel:/);
  if (!match || !match[1]) {
    throw new Error("Could not locate ds:0 hydration data in Google Trends Web UI HTML");
  }

  const parsed = JSON.parse(match[1]);
  const trendList: any[] = Array.isArray(parsed) && Array.isArray(parsed[1]) ? parsed[1] : [];

  const items: TrendingItem[] = [];
  for (const item of trendList) {
    if (!Array.isArray(item)) continue;

    const title = String(item[0] || "").trim();
    if (!title) continue;

    const rawTraffic = typeof item[6] === "number" ? item[6] : 0;
    const approxTraffic = rawTraffic > 0 ? `${rawTraffic.toLocaleString("en-IN")}+` : "10,000+";

    const queries: string[] = Array.isArray(item[9]) ? item[9].filter((q) => typeof q === "string") : [];
    const catCodes: number[] = Array.isArray(item[10]) ? item[10].filter((c) => typeof c === "number") : [];
    const catNames: string[] = catCodes.map((c) => GOOGLE_TRENDS_CATEGORY_MAP[c] || "General");

    const newsTitle = queries[1] || queries[0] || title;
    const newsSnippet = queries.slice(0, 5).join(" | ");

    items.push({
      title,
      approx_traffic: approxTraffic,
      news_title: newsTitle,
      news_snippet: newsSnippet || undefined,
      news_url: `https://trends.google.com/trending?geo=${encodeURIComponent(geo)}`,
      category_codes: catCodes,
      categories: catNames,
      source: "web_ui",
    });
  }

  return items;
}

/**
 * Fetches search trends from Google Trends India RSS (legacy fallback).
 */
export async function fetchGoogleTrendsRss(geo: string = "IN"): Promise<TrendingItem[]> {
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Google Trends RSS: HTTP ${res.status}`);
  }

  const xml = await res.text();
  const items: TrendingItem[] = [];

  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    if (!block) continue;

    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
    const trafficMatch = block.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/);
    const newsTitleMatch = block.match(/<ht:news_item_title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/ht:news_item_title>/);
    const newsSnippetMatch = block.match(/<ht:news_item_snippet>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/ht:news_item_snippet>/);
    const newsUrlMatch = block.match(/<ht:news_item_url>(.*?)<\/ht:news_item_url>/);

    const title = titleMatch ? titleMatch[1]?.trim() ?? "" : "";
    const traffic = trafficMatch ? trafficMatch[1]?.trim() ?? "" : "";
    const newsTitle = newsTitleMatch ? newsTitleMatch[1]?.trim() ?? "" : "";
    const newsSnippet = newsSnippetMatch ? newsSnippetMatch[1]?.trim() ?? "" : "";
    const newsUrl = newsUrlMatch ? newsUrlMatch[1]?.trim() ?? "" : "";

    if (title) {
      items.push({
        title,
        approx_traffic: traffic,
        news_title: newsTitle,
        news_snippet: newsSnippet,
        news_url: newsUrl,
        source: "rss",
      });
    }
  }

  return items;
}

/**
 * Primary trend fetcher: Queries Google Trends Web UI live trends with RSS fallback.
 */
export async function fetchGoogleTrendsIndia(): Promise<TrendingItem[]> {
  try {
    const webItems = await fetchGoogleTrendsWebUI("IN");
    if (webItems.length > 0) {
      return webItems;
    }
  } catch (err: any) {
    console.warn(`[Trends] Google Trends Web UI fetch encountered error (${err?.message || err}), falling back to RSS...`);
  }
  return fetchGoogleTrendsRss("IN");
}

/**
 * Filters out controversial, negative, or sensationalist trends (scandals, arrests, crimes, political mudslinging).
 */
export function isBannedControversialTrend(item: TrendingItem): boolean {
  const combined = `${item.title} ${item.news_title} ${item.news_snippet || ""}`.toLowerCase();
  const bannedKeywords = [
    "arrest", "arrested", "cbi", "ed raid", "custody", "scam", "bribe", "corruption",
    "murder", "rape", "assault", "suicide", "crime", "violence", "riot", "clash",
    "scandal", "expose", "controversy", "allegation", "fir filed", "court case",
    "resignation", "defamation", "protest", "strike", "dharna", "hate speech",
    "blame", "slams", "hits out", "attacks", "row over", "dispute", "boycott",
    "jail", "chargesheet", "extortion", "fraud", "interrogation",
  ];
  return bannedKeywords.some((kw) => combined.includes(kw));
}

/**
 * Uses Gemini to evaluate the top trending items and pick the single best
 * documentary topic that provides genuine value addition to the viewer.
 */
export async function curateBestTrendTopic(items: TrendingItem[]): Promise<CuratedTopicResult> {
  if (!items.length) {
    throw new Error("No trending items provided for curation.");
  }

  // 1. Filter out banned sensationalist & negative controversial items
  const cleanItems = items.filter((item) => !isBannedControversialTrend(item));
  const candidatePool = cleanItems.length >= 3 ? cleanItems : items;

  // 2. High-value knowledge domains (Science: 15, Tech: 18, Climate/Earth: 20, Auto: 1, Sports Milestone: 17)
  const knowledgeCatCodes = [15, 18, 20, 1, 17];
  const knowledgeItems = candidatePool.filter((item) =>
    item.category_codes?.some((c) => knowledgeCatCodes.includes(c))
  );

  // Balance top knowledge items with top overall trends (up to 25 items total)
  const combinedCandidates: TrendingItem[] = [];
  const seenTitles = new Set<string>();

  for (const it of knowledgeItems) {
    if (!seenTitles.has(it.title.toLowerCase()) && combinedCandidates.length < 12) {
      combinedCandidates.push(it);
      seenTitles.add(it.title.toLowerCase());
    }
  }

  for (const it of candidatePool) {
    if (!seenTitles.has(it.title.toLowerCase()) && combinedCandidates.length < 25) {
      combinedCandidates.push(it);
      seenTitles.add(it.title.toLowerCase());
    }
  }

  const topItems = combinedCandidates.length > 0 ? combinedCandidates : candidatePool.slice(0, 20);
  const itemsListFormatted = topItems
    .map(
      (item, idx) =>
        `${idx + 1}. [Trend: "${item.title}"] (Traffic: ${item.approx_traffic}, Domain: ${item.categories?.join(", ") || "General"})\n` +
        `   Event Headline: "${item.news_title}"\n` +
        `   Event Context: "${item.news_snippet || "N/A"}"`
    )
    .join("\n\n");

  const prompt = `You are an elite editorial director and investigative journalist for a high-retention documentary channel.
Below is the live list of currently active Google Trends in India with their breaking news events:

${itemsListFormatted}

YOUR MISSION:
Select the SINGLE best topic from this list that delivers the HIGHEST KNOWLEDGE VALUE, TIMELINESS, and INTELLECTUAL CURIOSITY.

CRITICAL EDITORIAL RULES:
1. STRICT NON-PARTISAN & CONSTRUCTIVE POLICY (ZERO CONTROVERSIAL / AGGRESSIVE POLITICS):
   - ABSOLUTELY NO aggressive, controversial, or polarizing political fights, party rivalry, or election mudslinging.
   - STRICTLY ZERO condemnation ("ninda"), criticism, finger-pointing, highlighting flaws ("kamiyan"), scams, or failures of any politician, leader, party, or government.
   - NO crime, violence, arrests, court disputes, communal conflict, or scandal drama.
   - NO beauty, makeup, fashion, celebrity gossip, dating rumors, or frivolous viral memes.

2. CONSTRUCTIVE GOVERNANCE & GENUINE GOOD WORK IS ENCOURAGED:
   - If a politician, ministry, party, or government has achieved something genuinely positive, constructive, or beneficial for people/country (e.g., mega infrastructure projects, high-speed rail, expressways, public welfare schemes, healthcare access, clean water initiatives, green energy transitions, semiconductor fabs, space missions), that CAN be chosen and covered.
   - When covering good work: Focus 100% on the positive achievement, engineering marvel, scale of execution, and tangible public benefit—NEVER attack political rivals, critics, or opposition. Maintain a completely objective, uplifting, documentary style.

3. STRONGLY PRIORITIZE High-Value Knowledge & Inspiring Progress:
   - Science, Space, Nature, Astronomy, and Deep Ocean phenomena.
   - Emerging technology, AI breakthroughs, Energy & Engineering marvels.
   - Inspiring Sports Breakthroughs (historic victories, world records, athlete comeback stories).
   - Historical mysteries, archaeological discoveries, and cultural heritage.

4. MANDATORY RULE - COVER THE EXACT REASON WHY IT IS TRENDING:
   - The video MUST directly address the EXACT EVENT, match, breakthrough, policy, or incident that caused this trend today.
   - DO NOT make an abstract or disconnected theoretical lecture.
   - The video must explain:
     a) What exactly happened today that triggered this massive search spike?
     b) The deep background, mechanics, science, or strategy behind this specific event.
     c) What is the larger takeaway or impact for the viewer?

5. OUTPUT FORMAT (OPTION A - HYBRID RULES):
Return ONLY valid JSON matching this exact structure:
{
  "selected_trend": "<exact trend keyword from the list>",
  "trend_reason": "<1-2 clear sentences explaining the EXACT event/news that caused this trend today>",
  "documentary_topic": "<High-CTR topic strictly in English (Roman) alphabet. Hybrid format: [English Topic Keyword] : [Hinglish Curiosity Hook about this specific event], NEVER Devanagari script>",
  "category": "<Science | Space | Infrastructure & Development | Technology | Nature | History | Sports Milestone>",
  "value_hook": "<1-2 sentences explaining educational/curiosity value in pure English>",
  "language": "Hindi",
  "target_duration_minutes": 3
}`;

  const { text } = await geminiGenerate(prompt);
  if (!text) throw new Error("Gemini returned empty response for trend curation.");

  let result: CuratedTopicResult;
  try {
    result = JSON.parse(text) as CuratedTopicResult;
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) {
      result = JSON.parse(match[1]) as CuratedTopicResult;
    } else {
      throw new Error(`Failed to parse Gemini trend curation response: ${text.slice(0, 200)}`);
    }
  }

  return result;
}

// CLI test runner
if (process.argv.includes("--test")) {
  (async () => {
    console.log("[Trends] Fetching Google Trends India (Live Web UI with RSS fallback)...");
    const items = await fetchGoogleTrendsIndia();
    console.log(`[Trends] Fetched ${items.length} active Indian trends.`);
    console.log("[Trends] Curating best value-addition topic with Gemini...");
    const best = await curateBestTrendTopic(items);
    console.log("[Trends] Curated Topic Result:\n", JSON.stringify(best, null, 2));
  })().catch(console.error);
}
