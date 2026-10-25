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
  is_evergreen?: boolean | undefined;
}

export const MIN_TREND_TRAFFIC_THRESHOLD = 20_000;

/**
 * Parses numeric search traffic from string formats like "1,00,000+", "20,000+", "5,000+".
 */
export function parseApproxTrafficNumber(trafficStr: string): number {
  if (!trafficStr) return 0;
  const digitsOnly = trafficStr.replace(/[^0-9]/g, "");
  const val = parseInt(digitsOnly, 10);
  return isNaN(val) ? 0 : val;
}

/**
 * Combinatorial Matrix: 3 orthogonal axes guaranteeing infinite unique,
 * non-repetitive knowledge seeds across science, space, nature, and engineering.
 */
export const COMBINATORIAL_MATRIX = {
  domains: [
    "Deep Cosmos & Relativistic Astrophysics",
    "Abyssal Ocean & Extreme Earth Geophysics",
    "Quantum Computing & Next-Gen Clean Energy",
    "Mega-Scale Civil Engineering & Extreme Infrastructure",
    "Ancient Engineering Marvels & Archaeology",
    "Planetary Exploration & Extreme Climates",
  ],
  mechanisms: [
    "The Unexplained Gravitational or Physical Anomaly",
    "Extreme Physical Pressure & Deep Environmental Survival",
    "The Engineering Feat Ahead of Its Historical Era",
    "The Surprising Chain Reaction That Contradicted Expectations",
    "The 1% Design Choice That Prevented Catastrophic Failure",
    "The Natural Force That Scientists Are Still Decoding",
  ],
  hooks: [
    "What if conventional assumptions missed the real physical cause?",
    "The exact mathematical precision that modern engineers analyze today",
    "Why this phenomenon continues to puzzle researchers in peer-reviewed science",
    "The hidden mechanics operating far beneath the visible surface",
    "How ancient master-builders or pioneer scientists solved this without computers",
  ],
};

export function sampleCombinatorialMatrix(): { domain: string; mechanism: string; hook: string } {
  const dIdx = Math.floor(Math.random() * COMBINATORIAL_MATRIX.domains.length);
  const mIdx = Math.floor(Math.random() * COMBINATORIAL_MATRIX.mechanisms.length);
  const hIdx = Math.floor(Math.random() * COMBINATORIAL_MATRIX.hooks.length);
  return {
    domain: COMBINATORIAL_MATRIX.domains[dIdx] ?? "Deep Cosmos & Relativistic Astrophysics",
    mechanism: COMBINATORIAL_MATRIX.mechanisms[mIdx] ?? "The Unexplained Gravitational or Physical Anomaly",
    hook: COMBINATORIAL_MATRIX.hooks[hIdx] ?? "What if conventional assumptions missed the real physical cause?",
  };
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
/**
 * Invariant: Sports matches that are currently LIVE or IN PROGRESS must NEVER have videos made on them.
 * A sports match video is only allowed once the match is 100% completed and the final result is locked.
 */
export function isLiveOngoingMatch(item: TrendingItem): boolean {
  const combined = `${item.title} ${item.news_title} ${item.news_snippet || ""}`.toLowerCase();

  // Explicit completion indicators override live keywords (e.g. "won by", "beat", "post match", "highlights")
  const isFinished = /\b(won by|defeated|beat|beats|won the match|won trophy|champions|lift trophy|match highlights|post-match|full match summary|all out for)\b/i.test(combined);
  if (isFinished) return false;

  // Live match search indicators: search spikes happening during the live broadcast
  const isLive = /\b(live score|live match|live cricket|live streaming|live stream|live telecast|live commentary|scorecard live|toss update|playing 11|playing xi|toss won by|in progress|ongoing match|currently batting|currently bowling|stumps day|innings break)\b/i.test(combined);
  return isLive;
}

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
 * Synthesizes an ultra-compelling Evergreen Concept Video topic using
 * Combinatorial Matrix Sampling + Evol-Instruct (Mutation).
 * Enforces STRICT FACT-GROUNDING & ZERO PSEUDO-SCIENCE GUARDRAILS.
 */
export async function generateEvergreenConceptTopic(preferredDomain?: string): Promise<CuratedTopicResult> {
  const seed = sampleCombinatorialMatrix();
  const domain = preferredDomain || seed.domain;
  const mechanism = seed.mechanism;
  const hook = seed.hook;

  console.log(`[Trends/Evergreen] Matrix Seed sampled: [Domain: "${domain}"] + [Mechanism: "${mechanism}"] + [Hook: "${hook}"]`);

  const prompt = `You are an elite scientific documentary director, investigative researcher, and lead script architect for a prestigious knowledge and engineering channel.
We are executing EVOL-INSTRUCT (MUTATION) on a 3-dimensional combinatorial concept seed to generate a timeless, high-retention, evergreen documentary topic.

COMBINATORIAL CONCEPT SEED:
- Domain Axis: "${domain}"
- Mechanism Axis: "${mechanism}"
- Narrative Tension Hook: "${hook}"

YOUR MISSION:
Evolve (mutate) this abstract 3-part seed into a concrete, peer-reviewed, intellectually electrifying documentary topic.

CRITICAL EDITORIAL & FACT-GROUNDING GUARDRAILS (STRICT COMPLIANCE MANDATORY):
1. STRICT FACT-GROUNDING & ZERO PSEUDO-SCIENCE (NO MYTHS, NO CONSPIRACIES):
   - ABSOLUTELY ZERO pseudo-science, pseudo-archaeology, conspiracy theories, or myth-mongering.
   - NEVER make unverified claims like "aliens built it", "ancient laser technology", or debunked supernatural myths.
   - Everything MUST be grounded in peer-reviewed scientific literature, verified historical records, Archaeological Survey of India (ASI) / UNESCO documentation, or established engineering specifications.
   - The mystery MUST stem from REAL physical, mathematical, geological, or architectural challenges (e.g. top-down monolithic basalt excavation mechanics, structural load distribution, cosmic ray detection, quantum coherence limits).

2. STRICT NON-PARTISAN & CONSTRUCTIVE POLICY:
   - ZERO modern political controversy, elections, party clashes, or corruption drama.
   - 100% objective, awe-inspiring, and intellectually curiosity-driven.

3. EVOL-INSTRUCT MUTATION PROCESS:
   - Step 1 (Concretize): Anchor this seed to a REAL physical entity (e.g., James Webb Deep Field, Kailash Temple Ellora, Mariana Trench Challenger Deep, ITER Fusion Tokamak, Chenab Rail Bridge, Antikythera Mechanism, Voyager Interstellar Boundary).
   - Step 2 (Deepen): Highlight the exact engineering constraint, mathematical anomaly, or physical mechanism that scientists or master architects had to overcome.
   - Step 3 (Curiosity Hook): Formulate an irresistible curiosity question grounded purely in authentic facts.

4. OUTPUT FORMAT (OPTION A - HYBRID RULES):
Return ONLY valid JSON matching this exact structure:
{
  "selected_trend": "EVERGREEN_CONCEPT",
  "trend_reason": "<1-2 clear sentences explaining the timeless scientific or historical paradox and why it captivates minds>",
  "documentary_topic": "<High-CTR topic strictly in English (Roman) alphabet. Hybrid format: [English Topic Keyword] : [Hinglish Curiosity Hook], NEVER Devanagari script>",
  "category": "<Science | Space | Infrastructure & Development | Technology | Nature | History | Sports Milestone>",
  "value_hook": "<1-2 sentences explaining educational/curiosity value in pure English>",
  "language": "Hindi",
  "target_duration_minutes": 3,
  "is_evergreen": true
}`;

  const { text } = await geminiGenerate(prompt);
  if (!text) throw new Error("Gemini returned empty response for evergreen concept generation.");

  let result: CuratedTopicResult;
  try {
    result = JSON.parse(text) as CuratedTopicResult;
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) {
      result = JSON.parse(match[1]) as CuratedTopicResult;
    } else {
      throw new Error(`Failed to parse Gemini evergreen concept response: ${text.slice(0, 200)}`);
    }
  }

  result.is_evergreen = true;
  result.selected_trend = result.selected_trend || "EVERGREEN_CONCEPT";
  return result;
}

/**
 * Uses Gemini to evaluate the top trending items and pick the single best
 * documentary topic that provides genuine value addition to the viewer.
 * Automatically pivots to an Evergreen Concept Video if trend strength is low (< 20K)
 * or if no viable high-quality documentary trend exists.
 */
export async function curateBestTrendTopic(items: TrendingItem[]): Promise<CuratedTopicResult> {
  if (!items.length) {
    console.log("[Trends] ⚠️ No trending items provided. Falling back to Evergreen Concept Video...");
    return await generateEvergreenConceptTopic();
  }

  // 1. Filter out banned sensationalist & negative controversial items (crimes, violence, arrests, scandal mudslinging)
  // 1. Filter out banned controversial items AND active live/in-progress matches
  const cleanItems = items.filter((item) => !isBannedControversialTrend(item) && !isLiveOngoingMatch(item));
  if (cleanItems.length === 0) {
    console.log("[Trends] ⚠️ All trends filtered out by controversy rules. Falling back to Evergreen Concept Video...");
    return await generateEvergreenConceptTopic();
  }

  // 2. Strict Traffic-Weighted Ranking & Threshold Enforcement:
  // Google Trends Web UI returns 300+ items that are NOT sorted purely by search traffic.
  // We strictly sort all clean trends by search traffic descending so only high-volume viral events qualify!
  const trafficSortedItems = [...cleanItems].sort(
    (a, b) => parseApproxTrafficNumber(b.approx_traffic) - parseApproxTrafficNumber(a.approx_traffic)
  );

  // Filter out any micro-trends (< MIN_TREND_TRAFFIC_THRESHOLD e.g. 20K/1K searches)
  const highVolumeTrends = trafficSortedItems.filter(
    (it) => parseApproxTrafficNumber(it.approx_traffic) >= MIN_TREND_TRAFFIC_THRESHOLD
  );

  if (highVolumeTrends.length === 0) {
    console.log(
      `[Trends] ⚠️ Zero trends meet the ${MIN_TREND_TRAFFIC_THRESHOLD.toLocaleString("en-IN")}+ search traffic threshold. Automatically pivoting to Evergreen Combinatorial Matrix + Evol-Instruct...`
    );
    return await generateEvergreenConceptTopic();
  }

  // Strictly select candidate pool from the TOP 10-15 highest search volume trends in India
  const candidatePool = highVolumeTrends.slice(0, 15);
  const topTraffic = candidatePool[0]?.approx_traffic || "20,000+";
  const bottomTraffic = candidatePool[candidatePool.length - 1]?.approx_traffic || "20,000+";
  console.log(`[Trends] 📊 Curating from Top ${candidatePool.length} High-Volume Trends (${topTraffic} down to ${bottomTraffic}).`);

  const itemsListFormatted = candidatePool
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

3. STRONGLY PRIORITIZE High-Value Knowledge, Inspiring Concluded Sports Milestones & Progress:
   - STRICT INVARIANT - ZERO LIVE / IN-PROGRESS SPORTS MATCHES:
     * NEVER EVER select a match that is currently LIVE, ONGOING, IN PROGRESS, or UNDECIDED.
     * The match MUST be 100% FINISHED and CONCLUDED with an official final result, winner, completed scorecard, or finished trophy celebration.
     * Videos on live matches age terribly and lead to hallucinated or incorrect outcomes. Only completed matches qualify.
   - Inspiring Sports Milestones & Concluded Clashes: Finished Asian football matches, historic cricket clashes with final scorecards, athlete records, tactical mastery.
   - Science, Space, Nature, Astronomy, and Deep Ocean phenomena.
   - Emerging technology, AI breakthroughs, Energy & Engineering marvels.
   - Historical mysteries, archaeological discoveries, and cultural heritage.

4. MANDATORY RULE - COVER THE REAL-WORLD EVENT (ZERO SEARCH VOLUME IN OUTPUT):
   - The video MUST directly address the REAL-WORLD EVENT, match, breakthrough, policy, or incident.
   - DO NOT make an abstract or disconnected theoretical lecture.
   - In "trend_reason", summarize ONLY the real-world milestone or breakthrough.
   - NEVER mention search counts, query volume, or Google Trends stats (e.g. DO NOT write "50K+ searches on Google", write "Kusal Mendis scored a match-winning century against Pakistan").

5. OUTPUT FORMAT (OPTION A - HYBRID RULES):
Return ONLY valid JSON matching this exact structure:
{
  "selected_trend": "<exact trend keyword from the list>",
  "trend_reason": "<1-2 clear sentences explaining the EXACT real-world event/news that occurred. NEVER mention search counts or traffic metrics>",
  "documentary_topic": "<High-CTR topic strictly in English (Roman) alphabet. Hybrid format: [English Topic Keyword] : [Hinglish Curiosity Hook about this specific event], NEVER Devanagari script>",
  "category": "<Science | Space | Infrastructure & Development | Technology | Nature | History | Sports Milestone>",
  "value_hook": "<1-2 sentences explaining educational/curiosity value in pure English>",
  "language": "Hindi",
  "target_duration_minutes": 3
}

6. QUALITY ESCAPE HATCH:
If the candidate items in this list are exclusively frivolous celebrity gossip, lottery results, or low-retention noise that do NOT meet our documentary knowledge standards, return:
{
  "no_viable_trend": true,
  "reason": "<explanation of why candidate trends lack documentary value>"
}`;

  const { text } = await geminiGenerate(prompt);
  if (!text) throw new Error("Gemini returned empty response for trend curation.");

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) {
      parsed = JSON.parse(match[1]);
    } else {
      throw new Error(`Failed to parse Gemini trend curation response: ${text.slice(0, 200)}`);
    }
  }

  // Handle Quality Escape Hatch: If Gemini evaluated that no candidate trend is viable, pivot to Evergreen!
  if (parsed.no_viable_trend) {
    console.log(`[Trends] 🌿 Gemini evaluated breaking candidates as low documentary value (${parsed.reason}). Pivoting to Evergreen Concept Video...`);
    return await generateEvergreenConceptTopic();
  }

  return parsed as CuratedTopicResult;
}

// CLI test runner
if (process.argv.includes("--test") || process.argv.includes("--test-evergreen")) {
  (async () => {
    if (process.argv.includes("--test-evergreen")) {
      console.log("[Trends] Testing standalone Evergreen Concept Generation via Combinatorial Matrix + Evol-Instruct...");
      const evergreen = await generateEvergreenConceptTopic();
      console.log("[Trends] Generated Evergreen Result:\n", JSON.stringify(evergreen, null, 2));
      return;
    }

    console.log("[Trends] Fetching Google Trends India (Live Web UI with RSS fallback)...");
    const items = await fetchGoogleTrendsIndia();
    console.log(`[Trends] Fetched ${items.length} active Indian trends.`);
    console.log("[Trends] Curating best value-addition topic with Gemini...");
    const best = await curateBestTrendTopic(items);
    console.log("[Trends] Curated Topic Result:\n", JSON.stringify(best, null, 2));
  })().catch(console.error);
}
