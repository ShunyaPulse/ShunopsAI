import { geminiGenerate } from "./video.js";

export interface TrendingItem {
  title: string;
  approx_traffic: string;
  news_title: string;
  news_snippet?: string;
  news_url?: string;
}

export interface CuratedTopicResult {
  selected_trend: string;
  documentary_topic: string;
  category: string;
  value_hook: string;
  language: string;
  target_duration_minutes: number;
}

/**
 * Fetches real-time active search trends from Google Trends India RSS.
 */
export async function fetchGoogleTrendsIndia(): Promise<TrendingItem[]> {
  const url = "https://trends.google.com/trending/rss?geo=IN";
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Google Trends India RSS: HTTP ${res.status}`);
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
      });
    }
  }

  return items;
}

/**
 * Uses Gemini to evaluate the top trending items and pick the single best
 * documentary topic that provides genuine value addition to the viewer.
 */
export async function curateBestTrendTopic(items: TrendingItem[]): Promise<CuratedTopicResult> {
  if (!items.length) {
    throw new Error("No trending items provided for curation.");
  }

  const topItems = items.slice(0, 20);
  const itemsListFormatted = topItems
    .map((item, idx) => `${idx + 1}. [Trend: "${item.title}"] (Traffic: ${item.approx_traffic}) - News: "${item.news_title}"`)
    .join("\n");

  const prompt = `You are an elite editorial director for a high-retention educational and curiosity documentary channel.
Below is the live list of currently active Google Trends in India:

${itemsListFormatted}

YOUR MISSION:
Select the SINGLE best topic from this list that delivers the HIGHEST KNOWLEDGE VALUE and INTELLECTUAL CURIOSITY to the viewer.

CRITICAL EDITORIAL RULES:
1. STRICTLY REJECT Frivolous / Zero-Value Topics:
   - NO beauty, makeup, fashion, or celebrity outfit trends.
   - NO celebrity gossip, dating rumors, or Bollywood scandal drama.
   - NO esports streamer drama or gaming leaks.
   - NO ephemeral internet memes or silly viral clickbait.
   - NO toxic partisan political mudslinging or unverified outrage.

2. STRONGLY PRIORITIZE Genuine Value-Addition & Curiosity:
   - Science, Space, Nature, Astronomy, and Deep Ocean phenomena.
   - Geopolitics, Global Strategy, Defense tech, and National infrastructure milestones.
   - Emerging technology, AI breakthroughs, and Energy/Engineering marvels.
   - Historical mysteries, archaeological discoveries, and unexplored historical events.
   - Inspiring Sports Breakthroughs (e.g. World Records, Historic sporting milestones, incredible underdog victories).

3. OUTPUT FORMAT (OPTION A - HYBRID RULES):
Return ONLY valid JSON matching this exact structure:
{
  "selected_trend": "<exact trend keyword from the list>",
  "documentary_topic": "<High-CTR topic strictly in English (Roman) alphabet. Hybrid format: [English Topic Keyword] : [Hinglish Curiosity Hook], NEVER Devanagari script>",
  "category": "<Science | Space | Geopolitics | Technology | Nature | History | Sports Milestone>",
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
    console.log("[Trends] Fetching Google Trends India RSS...");
    const items = await fetchGoogleTrendsIndia();
    console.log(`[Trends] Fetched ${items.length} active Indian trends.`);
    console.log("[Trends] Curating best value-addition topic with Gemini...");
    const best = await curateBestTrendTopic(items);
    console.log("[Trends] Curated Topic Result:\n", JSON.stringify(best, null, 2));
  })().catch(console.error);
}
