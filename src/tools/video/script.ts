import { geminiGenerate } from "./gemini.js";
import { detectVideoDomain, getDomainPromptDirectives } from "./domain.js";
import { synthesizeTopicVisualBible } from "./visualBible.js";
import { executeWebSearch } from "../cloud/webSearch.js";
import type { VideoDomain, VideoScript, VisualBible } from "./types.js";

/** Strip search-volume noise from the trend context before prompting. */
function sanitizeTrendReason(trendReason?: string): string | undefined {
  return trendReason
    ? trendReason
        .replace(/\b\d+[\d,]*\+?\s*(searches|search|traffic|queries|queries on google|searches on google trends)\b/gi, "")
        .replace(/\b(50k\+|100k\+|200k\+|500k\+|10k\+|20k\+|5k\+)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    : undefined;
}

/** Curated documentary voices by language and domain. */
function selectVoice(language: string, domain: VideoDomain): string {
  // hi-IN-Neural2-C: Authoritative documentary studio narrator (Science/Space/Tech/History)
  // hi-IN-Neural2-B: Dynamic, energetic narrator (Sports/General)
  // en-IN-PrabhatNeural: authentic Indian intellectual documentary narrator
  if (!/hindi/i.test(language)) return "en-IN-PrabhatNeural";
  return domain === "sports" ? "hi-IN-Neural2-B" : "hi-IN-Neural2-C";
}

function buildScriptPrompt(params: {
  topic: string;
  minutes: number;
  language: string;
  domain: VideoDomain;
  voice: string;
  targetWords: number;
  sceneCount: number;
  trendReason: string | undefined;
  visualBible: VisualBible;
  liveSearchFacts?: string;
}): string {
  const { topic, minutes, language, domain, voice, targetWords, sceneCount, trendReason, visualBible, liveSearchFacts } = params;
  const domainDirectives = getDomainPromptDirectives(domain);

  return `You are an elite investigative documentary filmmaker and YouTube director (Vox, Johnny Harris, Think School style).
Write a gripping, 100% factual, highly engaging video script with hard synchronization between spoken narration and cinematic footage.

Topic: ${topic}
${trendReason ? `BREAKING REAL-WORLD EVENT CONTEXT: "${trendReason}"` : ""}
${liveSearchFacts ? `REAL-TIME VERIFIED GROUNDING INTEL (SEARCHED LIVE TODAY):\n${liveSearchFacts}\n` : ""}
Domain: ${domain.toUpperCase()}
Language: ${language}
Target Length: about ${targetWords} spoken words (${minutes} minutes) divided into about ${sceneCount} tightly-paced scenes (12-20 words each).

${domainDirectives}

DIRECTOR'S BESPOKE VISUAL & ACOUSTIC BIBLE (DYNAMIC TOPIC GROUNDING):
- REAL-WORLD GROUNDING: ${visualBible.realWorldGrounding}
- MANDATORY ORGANIC VENUES (ALL SCENES MUST BE SET HERE): ${visualBible.organicSettings.join(", ")}
- LATENT DIFFUSION TRAPS STRICTLY BANNED: ${visualBible.latentTrapsToBan.join(", ")}
- CINEMATOGRAPHY & CHARACTER GRAMMAR: ${visualBible.characterGrammar}
- ZERO-TEXT TRANSLATION: ${visualBible.zeroTextRules}
- SOUNDSCAPE & PACING: Energy level: ${visualBible.soundscapeProfile.energyLevel}, Ambient style: ${visualBible.soundscapeProfile.ambientBedStyle}, Foley cues: ${visualBible.soundscapeProfile.foleyCues.join(", ")}

CRITICAL DIRECTIVES:
1. MANDATORY - COVER THE ACTUAL BREAKING EVENT (STRICT ZERO SEARCH NUMBERS / METRICS):
   - The video MUST directly explain the REAL-WORLD EVENT, match, breakthrough, policy, or incident: ${trendReason || topic}.
   - ABSOLUTELY NEVER mention search counts, query volume, or Google Trends stats in the narration, captions, or description (STRICTLY FORBIDDEN: "50 hazar logo ne search kiya", "1 lakh searches", "Google par trending hai", "internet par search spike").
   - NEVER break the fourth wall. Speak directly about the real-world story, person, match, or scientific phenomenon itself like a high-end Vox, Netflix, or Think School documentary.
   - ZERO SEARCH UI / BROWSER SHOTS: Never depict a Google search bar, browser tab, or typing queries on a keyboard in the visual prompts (which causes distorted AI gibberish text). Depict real-world action, stadiums, labs, or celestial bodies.
   - Act 1 (Scene 1-4): Hook the viewer immediately with the dramatic event that happened today.
   - Act 2 (Middle Scenes): Deep dive into the mechanics, science, history, or engineering behind this specific event.
   - Act 3 (Final Scenes - Conclusive Ending & Outro):
     * Do NOT end abruptly on technical facts or body content.
     * The final scenes must synthesize what this discovery or event means for humanity and the future.
     * The very last scene MUST feature a memorable, conclusive closing statement and sign-off so the viewer experiences complete, satisfying narrative closure.
2. STRICT NON-PARTISAN & CONSTRUCTIVE POLICY (ZERO CONTROVERSIAL/AGGRESSIVE POLITICS):
   - STRICTLY ZERO aggressive politics, party warfare, communal tension, or controversial blame-games.
   - ABSOLUTELY ZERO condemnation ("ninda"), fault-finding ("kamiyan"), criticism, roasting, or exposing any politician, party, leader, or government.
   - IF COVERING GOVERNANCE, PUBLIC POLICY, OR A LEADER'S WORK:
     * Focus 100% on the CONSTRUCTIVE WORK, positive achievements, engineering scale, and tangible public welfare (e.g. how a bridge/expressway was engineered, how a welfare scheme reached millions, how renewable energy was deployed, how a space/defense milestone succeeded).
     * Maintain an objective, educational, inspiring, documentary tone.
     * NEVER indulge in partisan bias, NEVER mock opponents, and NEVER engage in political controversy.
3. SCRIPT & SCRIPT-LANGUAGE RULES (MANDATORY - OPTION A HYBRID FORMULA):
   - TITLE (THE HYBRID FORMULA): Must be strictly in English (Roman) alphabet. Format: "[English Topic Keyword] : [Hinglish Curiosity Question/Hook about this specific event]".
     Example: "Aadhaar Super-Engine : 140 Crore Logo Ka Data Kaise Safe Rehta Hai?"
     Example: "Cristiano Ronaldo 900 Goals : 40 Ki Umar Mein Aisa Record Kaise Banaya?"
     Example: "Semiconductor Fab : India Mein Microchips Banana Itna Mushkil Kyu Hai?"
     NEVER use Devanagari script. Maximum 70 characters.
   - DESCRIPTION (PURE ENGLISH): Must be written in 100% PURE ENGLISH (English language & Roman letters). Include detailed SEO overview of the event, key technical keywords, and timestamps/chapters. No Devanagari script.
   - CHAPTER TITLES & TAGS: Must be strictly in English (Roman) alphabet.
   - NARRATION (Spoken Audio): Natural, engaging Hindi dialogue spoken by studio documentary voice ${voice}.
   - CAPTIONS (On-Screen Subtitles): Must be in 100% PURE ENGLISH (both English letters AND English language words). For every single scene, provide the exact English translation in "caption" to be displayed on-screen.
4. Visual Prompt Engineering for True Continuous Video & Flaw-Free Execution:
   - For EVERY scene, write a "visual_prompt" that describes a real, continuous cinematic video shot — NOT a static photo or generic concept.
   - ZERO AI TEXT & ABSOLUTE ZERO SCOREBOARDS/TICKERS (CRITICAL):
     * NEVER instruct the AI model to render legible text, words, numbers, scores, labels, graphs, or line charts inside the shot.
     * STRICTLY FORBIDDEN: NEVER prompt stadium scoreboards, digital timers, leaderboards, or score tickers (which cause garbled gibberish text like "34AAST").
     * When screens, monitors, or stadiums are depicted: depict glowing floodlights, blurred spectators, player emotions, or abstract color gradations with strictly zero text, zero letters, zero numbers.
   - FUNCTIONAL ARENA GROUNDING (ZERO UNRELATED RESIDENTIAL MANSIONS/PALACES):
     * Every scene must be physically set inside the authentic arena or domain stage (e.g. green playing turf, dugout, launchpad, lab cleanroom).
     * STRICTLY BANNED: Residential buildings, colonial palaces, mansions, havelis, luxury resort gardens, or random hotel rooms in sports or technical documentaries.
   - BIOMECHANICAL KINEMATICS & ANTI-WARPING STANDARD:
     * For athletic or high-speed maneuvers: NEVER prompt full-body side-profile complex swings or high-speed human limb contortions (which trigger shoulder melting, floating equipment, or cross-sport confusion like baseball sliding).
     * Use macro equipment cinematography (e.g. ball seam spinning, equipment impact, turf explosion under spikes), dynamic tracking of trajectory, over-the-shoulder perspectives, or backlit silhouetted celebrations.
   - RIGID BACKGROUND GEOMETRY & LOW-MOTION STABILITY (PREVENT BREATHING/SURFACE WARPING):
     * For indoor, laboratory, server room, and character shots: Specify steady camera control: "Subtle character breathing and gentle eye movement, locked solid background geometry, rigid non-morphing walls, stable monitor frames in 3D space".
     * Ban rapid boiling, shifting surfaces, and inconsistent morphing.
   - CONTROLLED DOLLY SPEEDS (ELIMINATE MOTION BLUR & FRAME SMEAR):
     * Ban whip-pans, fast zooms, or aggressive camera tracks.
     * Specify slow, controlled, steady camera work: "Slow cinematic dolly forward on track", "Smooth steadicam glidecam push-in", "Gentle cinematic tripod pan".
   - Modern Digital Lighting & Clarity:
     * "Crisp natural 4K digital cinematography, modern high-end documentary lighting, balanced realistic color grade, sharp clean focus, absolutely NO vintage/retro/sepia/8mm/grainy aesthetics."
   - Realism enforcement: Clean, authentic physical textures (modern architectural glass, polished materials, real skin, crisp telemetry). Avoid retro filters, heavy grain, sepia tones, plastic CGI, or still-photo aesthetics.
5. HIGH-CLICKTHROUGH (CTR) TRUTHFUL THUMBNAIL CONCEPT (MODERN 2026 YOUTUBE S-TIER STANDARD):
   - Design a dedicated hero concept thumbnail that commands instant attention (Think School / Veritasium / Vox / Curious Elephant style) without cheap clickbait.
   - HERO FOREGROUND FOCAL ELEMENT (CRITICAL):
     * The visual MUST feature a prominent, dramatic foreground hero element occupying the center-to-right portion of the frame (e.g. glowing high-tech artifact, dramatic close-up macro machine/engine, historic relic with volumetric lighting, intense celestial body, or athlete gear in dramatic stadium smoke).
     * ABSOLUTELY NEVER generate empty landscapes, blank skies, flat concrete floors, or distant wide angles where nothing is in the foreground.
     * Extreme dynamic contrast: intense volumetric rim lighting, deep shadows, rich cinematic color grade, shallow depth of field.
   - PUNCHY 2-LINE TEXT HOOK (ALL CAPS, ULTRA-SHORT):
     * "headline": 2-3 words MAX in ALL CAPS. Must be a curiosity-inducing trigger (e.g. "THE SECRET RUNWAY", "TIME BROKE", "BENGALI DNA", "THAT'S NOT WATER", "CAPTAINCY WAR", "GHOST PARTICLES"). NEVER repeat the boring official topic name!
     * "subheadline": 2-4 words MAX in ALL CAPS. The shocking twist or consequence (e.g. "WHY JETS STOPPED", "HAS A SECRET", "THEY TURNED IT", "WHO REPLACES ROHIT?", "IMPOSSIBLE DISCOVERY").
     * Total combined words across headline and subheadline should be 4-7 words maximum!
6. Return ONLY valid JSON in this exact structure:
{
  "title": "<Hybrid Title: [English Topic] : [Hinglish Curiosity Hook], Roman alphabet only, <=70 chars, NO Devanagari>",
  "description": "<Comprehensive Pure English SEO description of the event, 150-250 words with timestamps & keywords, NO Devanagari>",
  "tags": ["<8-15 high volume relevant tags in English alphabet>"],
  "chapters": [{"title": "<Chapter Title in English>", "start_scene": 0}],
  "thumbnail": {
    "headline": "<2-3 words in ALL CAPS: High-curiosity psychological hook, e.g. 'THE SECRET RUNWAY', 'TIME BROKE', 'BENGALI DNA'>",
    "subheadline": "<2-4 words in ALL CAPS: Shocking consequence or twist, e.g. 'WHY JETS STOPPED', 'HAS A SECRET', 'WHO REPLACES ROHIT?'>",
    "visual_prompt": "<Ultra-vivid cinematic hero visual prompt in pure English: dramatic macro/medium foreground subject occupying center-right of frame, intense volumetric rim lighting, cinematic mist/haze, deep contrast, shallow depth of field, dark atmospheric left side for text, 8k masterpiece, zero text in image>"
  },
  "scenes": [
    {
      "narration": "<Exact words spoken in Hindi by voice ${voice}>",
      "caption": "<Exact English translation in pure English language and Roman alphabet for on-screen subtitles>",
      "visual_prompt": "<Ultra-detailed cinematic video prompt in English: camera move (slow dolly/steadicam), lens, subject action matching narration, lighting, locked rigid background geometry, clean text-free screens>"
    }
  ]
}`;
}

function parseScriptJson(text: string): VideoScript {
  try {
    return JSON.parse(text) as VideoScript;
  } catch {
    // Sometimes the model wraps JSON in a code fence — strip it
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) {
      return JSON.parse(match[1]) as VideoScript;
    }
    throw new Error(`Gemini response is not valid JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Stage 1-2: Brainstorm-to-script using the Gemini key pool and quality degradation.
 */
export async function generateScript(
  topic: string,
  minutes = 5,
  language = "English",
  trendReason?: string
): Promise<VideoScript> {
  const preferredModel = process.env.GEMINI_MODEL;
  const targetWords = Math.round(minutes * 150);
  const sceneCount = Math.round(targetWords / 16);

  const domain = detectVideoDomain(topic, trendReason);

  // Rule 14: Real-Time Event Grounding & Pre-Generation Web Research Invariant
  let liveSearchFacts = "";
  const isMatchOrSports = domain === "sports" || /\b(vs|versus|match|series|tournament|cup|trophy|race|derby|final|game)\b/i.test(topic);
  if (isMatchOrSports || trendReason) {
    try {
      const currentYear = new Date().getFullYear();
      const searchQuery = isMatchOrSports
        ? `${topic} latest match result scorecard ${currentYear}`
        : `${topic} breaking news facts ${currentYear}`;
      const searchRes = await executeWebSearch(searchQuery, { maxResults: 4 });
      if (searchRes && !searchRes.includes("No results found")) {
        liveSearchFacts = searchRes.slice(0, 2500);
        console.log(`[Video] Rule 14 Pre-generation search grounded topic: "${topic}"`);
      }
    } catch (err: any) {
      console.warn(`[Video] Rule 14 Pre-generation search non-fatal fallback: ${err?.message || err}`);
    }
  }
  const visualBible = await synthesizeTopicVisualBible(topic, trendReason, domain);
  const voice = selectVoice(language, domain);
  const rate = domain === "sports" ? "+4%" : "+0%";
  const sanitizedTrendReason = sanitizeTrendReason(trendReason);

  const prompt = buildScriptPrompt({
    topic,
    minutes,
    language,
    domain,
    voice,
    targetWords,
    sceneCount,
    trendReason: sanitizedTrendReason,
    visualBible,
    liveSearchFacts,
  });

  const { text, modelUsed } = await geminiGenerate(prompt, preferredModel);
  if (!text) throw new Error("Gemini returned empty content");

  const script = parseScriptJson(text);
  if (!script.scenes?.length) throw new Error("Gemini returned a script with no scenes");

  script.voice = voice;
  script.language = language;
  script.domain = domain;
  script.rate = script.rate || rate;
  script.visual_bible = visualBible;

  const poolSize = (process.env.GEMINI_KEYS ?? process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean).length;
  console.log(`[Video] Script generated with model "${modelUsed}" for domain "${domain}" via Gemini key pool (${poolSize} keys). Title: ${script.title}`);
  return script;
}
