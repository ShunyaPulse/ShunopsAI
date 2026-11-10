import { geminiGenerate } from "./gemini.js";
import type { VideoDomain, VisualBible } from "./types.js";
import {
  CRICKET_PRODUCTION_TEMPLATE,
  buildCricketVisualBible,
  isCricketTopic,
  type DynamicCricketParams,
} from "./cricketTemplate.js";

/**
 * Provides an intelligent domain-level fallback Visual Bible if LLM synthesis is temporarily unavailable.
 */
export function getFallbackVisualBible(topic: string, domain: VideoDomain): VisualBible {
  if (domain === "sports") {
    if (isCricketTopic(topic)) {
      return CRICKET_PRODUCTION_TEMPLATE;
    }
    return {
      realWorldGrounding: `Authentic professional athletic venue, arena, or racetrack matching ${topic}, authentic sports equipment, realistic competition environment under volumetric lighting.`,
      organicSettings: [
        "Professional competition circuit or arena",
        "Athletic preparation facility or team paddock",
        "Championship podium or finish line atmosphere",
        "High-performance training facility",
        "Post-competition debrief zone"
      ],
      latentTrapsToBan: [
        "cricket bats in non-cricket sports", "wooden wickets", "casual street clothes",
        "mutated anatomy", "floating gear", "distorted hands", "cartoon characters"
      ],
      demographicGrammar: "Authentic professional athletes matching the national/regional context of the sport, solid unbranded kit.",
      characterGrammar: "Frame athletes in authentic action poses with locked aerodynamic/athletic kit, focused facial expressions, 35mm shallow depth of field.",
      zeroTextRules: "Zero digital leaderboards, scoreboards, or sponsor typography. Depict motion, lighting, and physical equipment without legible text.",
      soundscapeProfile: {
        energyLevel: "high",
        ambientBedStyle: "stadium",
        bgmGenre: "triumphant_brass",
        dominantFrequencies: [80, 160],
        foleyCues: ["engine roar", "crowd cheer", "athletic impact", "wind rush"]
      }
    };
  }

  if (domain === "science" || domain === "space" || domain === "technology") {
    return {
      realWorldGrounding: `Authentic high-tech research facility, real physical instruments, cleanroom environments, spaceborne telescope mirrors, or cosmic phenomena related to ${topic}.`,
      organicSettings: [
        "Scientific laboratory or cleanroom",
        "Mission telemetry operations center",
        "Observatory dome or space telescope deployment",
        "High-performance compute or vacuum chamber facility",
        "Theoretical blackboard discussion space"
      ],
      latentTrapsToBan: [
        "sports jerseys", "cricket bats", "baseball helmets", "stadium crowd", "fantasy magic portals",
        "cartoon aliens", "hacker green terminal screens", "office cubicles", "shattered glass",
        "mutated hands", "gibberish code lines"
      ],
      demographicGrammar: "Cosmopolitan international scientists and researchers, diverse demographics, zero forced stereotypes.",
      characterGrammar: "Frame researchers in medium to wide shots, authentic lab attire from behind, or silhouetted against glowing volumetric instrumentation. Ban macro facial close-ups.",
      zeroTextRules: "All computer readouts, telemetry consoles, and spectrometer charts must feature unlabeled glowing abstract panels, clean cyan/amber HUD glows, and zero legible letters or numbers.",
      soundscapeProfile: {
        energyLevel: "measured",
        ambientBedStyle: "drone",
        bgmGenre: "inspirational_cello",
        dominantFrequencies: [55, 110],
        foleyCues: ["cryogenic hum", "cleanroom air circulation", "servo motor click", "deep telemetry pulse"]
      }
    };
  }

  if (domain === "nature") {
    return {
      realWorldGrounding: `Authentic physical wilderness, real geography matching the region of ${topic}, natural water fluid mechanics, uncompromised biome fidelity.`,
      organicSettings: [
        "Aerial landscape overview",
        "Riverside or shoreline biome",
        "Canopy or forest interior",
        "Geological rock formation or valley",
        "Expedition observation outpost"
      ],
      latentTrapsToBan: [
        "sports gear", "red desert sandstone in tropical zones", "cartographic lines", "fantasy maps",
        "extruded rubber water cylinders", "plastic foliage", "floating ships on land"
      ],
      demographicGrammar: "Authentic local field researchers or expedition naturalists, natural outdoor clothing, or zero human figures focusing on wildlife and terrain.",
      characterGrammar: "Prioritize natural physical environments, wildlife in natural motion, or expedition researchers in wide panoramic framing. Zero facial close-ups.",
      zeroTextRules: "Zero digital map outlines, zero boundary lines, zero latitude numbers in image generation.",
      soundscapeProfile: {
        energyLevel: "contemplative",
        ambientBedStyle: "nature",
        bgmGenre: "gentle_acoustic",
        dominantFrequencies: [45, 90],
        foleyCues: ["wind over canopy", "flowing water current", "subtle distant bird call", "geological rumble"]
      }
    };
  }

  return {
    realWorldGrounding: `Authentic real-world physical venue for ${topic}, grounded architecture, true-to-life materials, and natural cinematic lighting.`,
    organicSettings: [
      "Primary assembly or operational venue",
      "Field operational zone",
      "Control briefing or observation station",
      "Detailed macro equipment interface",
      "Atmospheric exterior establishing perspective"
    ],
    latentTrapsToBan: [
      "fantasy castles", "futuristic neon grids", "floating text in mid-air", "random crowd extras looking at camera",
      "unrelated residential bedrooms", "hallucinated brand logos"
    ],
    demographicGrammar: "Authentic subjects native to the specific real-world event or diverse international professionals.",
    characterGrammar: "Documentary observational camera framing: athletic or professional subjects in authentic field gear, natural non-deformed anatomy, dynamic motion matching the topic. Zero distorted faces.",
    zeroTextRules: "Zero legible letters, zero hallucinated English words on walls, banners, screens, or uniforms. Clean physical textures only.",
    soundscapeProfile: {
      energyLevel: "high",
      ambientBedStyle: "industrial",
      bgmGenre: "uplifting_documentary",
      dominantFrequencies: [60, 120, 240],
      foleyCues: ["subtle room tone", "mechanical click", "movement whoosh", "ambient atmosphere swell"]
    }
  };
}

const VISUAL_BIBLE_PROMPT = (topic: string, trendReason?: string, domain?: VideoDomain) => `You are an elite Hollywood production designer and visual director.
Analyze this video topic: "${topic}" ${trendReason ? `(Trend Context: ${trendReason})` : ""} (Domain: ${domain || "general"}).

STEP 0 — FIRST PRINCIPLES SEMANTIC GROUNDING (ZERO HARDCODED PRESETS):
Do NOT use rigid presets (do NOT force boardrooms, cleanrooms, generic office cubicles, or domestic spaces).
Reason dynamically from first principles based on the true physical reality of this specific subject:

1. DYNAMIC GEOGRAPHIC & DEMOGRAPHIC GROUNDING:
Categorize the topic dynamically into one of two fundamental categories:
- Category 1: Location / Culture Bound (e.g. events, historical figures, local crises, regional tournaments, or geography-specific phenomena like Delhi AQI, Sediqullah Atal in Kabul/Dubai, Nelson Mandela in South Africa, Arsenal vs Everton in the UK, Bay of Bengal cyclone).
  - Deduce the authentic geographic region, native human demographics (skin tones, facial features, authentic local clothing).
  - Crucially: Identify diffusion model LATENT BIAS TRAPS for this topic. For example:
    * For air pollution / smog with face masks: diffusion models suffer from East Asian latent bias (hallucinating Beijing/Tokyo faces or Japanese kanji). Explicitly detect and ban these in "latentTrapsToBan" and ground in the authentic native demographic!
    * For historical or regional struggles: ban inappropriate Western/modern apparel or colonial architectural tropes.
    * For sports: ban cross-sport equipment (e.g. cricket pads in football or vice versa).
- Category 2: Non-Place-Bound / Universal / Institutional (e.g. Marvell semiconductor merger, Microsoft corporate debt, Voyager 1 interstellar mission, deep quantum mechanics, oceanic biology).
  - Ground the setting in the organic physical or cosmic environment native to that functional reality (deep space vacuum, high-tech manufacturing, corporate financial strategy, open ocean, etc.).
  - Demographics (if humans are present) must be cosmopolitan, internationally diverse professionals, or machine/hardware-focused with zero forced regional stereotyping.

2. PHYSICAL SETTINGS & LIGHTING:
Dynamically deduce 6-10 authentic physical venues, architectural environments, natural terrain, or instrument stages where this topic actually unfolds in the real world.

Synthesize an exact, non-hallucinatory Visual & Acoustic Production Bible tailored to this topic.
Your output will be used to steer image diffusion (FLUX.1-schnell) and video motion models (Wan2.1-VACE).

Return a JSON object with:
1. "realWorldGrounding": A precise 2-sentence description of the authentic physical stage/environment where this subject actually exists in the real world or cosmos.
2. "organicSettings": An array of 6-10 authentic scene settings physically native to this topic.
3. "demographicGrammar": A concise, explicit demographic descriptor for any human figures in this topic (e.g. "Authentic North Indian citizens with natural South Asian facial features and local everyday attire" OR "Internationally diverse team of senior engineers and executives with cosmopolitan attire" OR "Zero human presence — deep space telemetry and robotic probes").
4. "geographicGrounding": {
  "isLocationBound": true or false,
  "locationContext": "Specific city/country/region OR Universal/Cosmic",
  "demographicProfile": "Specific native ethnicity/demographic OR Cosmopolitan/Diverse/None"
},
5. "latentTrapsToBan": An array of 20-30 specific negative prompt strings that generative models frequently hallucinate for this topic (including diffusion demographic biases, cross-domain equipment, corrupt text, and unwanted geometric/religious symbols).
6. "characterGrammar": Strict cinematic rules for human anatomy, camera angles (35mm shallow depth of field), natural lighting, authentic kit/attire, and camera framing appropriate for this topic.
7. "zeroTextRules": Explicit rules ensuring zero legible scoreboards, digital ticker text, written letters, or hallucinatory brand logos appear in generated latents. Emphasize clean physical architectural textures, minimalist geometry, and real tactile materials native to this domain.
8. "soundscapeProfile": {
  "energyLevel": "high" | "measured" | "contemplative" | "dramatic",
  "ambientBedStyle": "stadium" | "industrial" | "nature" | "orchestral" | "drone",
  "bgmGenre": "inspirational_cello" | "dramatic_strings" | "triumphant_brass" | "epic_orchestral" | "warm_serenade" | "gentle_acoustic" | "uplifting_documentary" | "contemplative_piano" | "solemn_history" | "heroic_adventure",
  "dominantFrequencies": [number, number],
  "foleyCues": ["string"]
}
BGM Genre Guidance:
- "inspirational_cello": Hardware engineering, silicon chips, deep tech architecture, calm analytical focus
- "dramatic_strings": High-stakes corporate debt races, severe financial tension, corporate battles, market crises, urgent suspense
- "triumphant_brass": Sports victories, championship finals, gold medals, athletic triumphs, celebrations
- "epic_orchestral": Deep space missions, planetary probes, cosmic discoveries, massive monumental engineering
- "warm_serenade": Human-interest stories, uplifting community achievements, peaceful cultural transitions
- "gentle_acoustic": Wildlife ecosystems, deep forest or marine biomes, wilderness expeditions, acoustic reflection
- "uplifting_documentary": Scientific innovation, medical breakthroughs, clean energy revolutions, biology discoveries
- "contemplative_piano": Philosophical dilemmas, existential mysteries, introspective technological ethics
- "solemn_history": Historical retrospectives, somber memorials, classical heritage, tragic turning points
- "heroic_adventure": High-octane breakthroughs, rapid technological rivalries, bold frontier explorations

Return ONLY raw JSON in this structure:
{
  "realWorldGrounding": "string",
  "organicSettings": ["string"],
  "demographicGrammar": "string",
  "geographicGrounding": {
    "isLocationBound": true,
    "locationContext": "string",
    "demographicProfile": "string"
  },
  "latentTrapsToBan": ["string"],
  "characterGrammar": "string",
  "zeroTextRules": "string",
  "soundscapeProfile": {
    "energyLevel": "high",
    "ambientBedStyle": "industrial",
    "bgmGenre": "inspirational_cello",
    "dominantFrequencies": [60, 120],
    "foleyCues": ["string"]
  }
}`;

/**
 * Dynamically extracts notable match players and teams from live research facts.
 * Adheres strictly to Rule 12 (Actor DNA Lock) and Rule 14 (Real-Time Grounding).
 * Completely eliminates brittle hardcoding of player names or teams.
 */
async function extractCricketMatchContext(
  topic: string,
  trendReason?: string,
  liveSearchFacts?: string
): Promise<DynamicCricketParams> {
  const prompt = `You are an expert international sports broadcast director and character visual designer.
Analyze this cricket match and live research facts:
Match Topic: "${topic}"
Context: "${trendReason || ""}"
Live Research Facts: "${liveSearchFacts ? liveSearchFacts.slice(0, 1800) : "N/A"}"

Extract and return a JSON object with:
1. "teamsDescription": "Championship cricket match between <Team A> (in solid <KitColor> athletic jersey) and <Team B> (in solid <KitColor> athletic jersey, clean cloth folds, zero text/logos)"
2. "heroPlayersDNA": "Concrete Character Visual DNA for the notable key players in this match (e.g. Hero Batter: <exact age/ethnicity, trimmed beard or clean-shaven, hair, athletic build, team kit solid color, batting pads, helmet with steel grille>; Hero Bowler: <appearance, solid jersey color>). Focus strictly on physical appearance, hair/beard, build, and solid unbranded attire; DO NOT prescribe specific batting strokes, celebration gestures, or multi-hand bat poses (actions are dictated per-scene). Ensure single-player focus and 100% actor visual consistency across scenes."

Return ONLY valid JSON in this structure:
{
  "teamsDescription": "...",
  "heroPlayersDNA": "..."
}`;

  try {
    const { text } = await geminiGenerate(prompt, process.env.GEMINI_MODEL);
    let cleaned = text.trim();
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) cleaned = match[1].trim();
    const parsed = JSON.parse(cleaned) as DynamicCricketParams;
    if (parsed.teamsDescription || parsed.heroPlayersDNA) {
      return parsed;
    }
  } catch {
    console.warn("[Video] Cricket dynamic match extraction non-fatal fallback activated.");
  }
  return {};
}

/**
 * Intelligent Director's Visual & Acoustic Bible Synthesizer.
 * Dynamically extracts topic-specific real-world grounding, authentic venues,
 * latent diffusion traps, anatomical character rules, and soundscape profile.
 * Replaces narrow brittle regex / hardcoded rules with semantic AI reasoning.
 */
export async function synthesizeTopicVisualBible(
  topic: string,
  trendReason?: string,
  domain: VideoDomain = "general",
  liveSearchFacts?: string
): Promise<VisualBible> {
  // Cricket Domain: Merge Live Research Facts & Notable Player DNA with Strict Geometry Invariants
  if (isCricketTopic(topic, trendReason)) {
    console.log(`[Video] 🏏 Extracting real-world notable players & venue for "${topic}" from research phase...`);
    const cricketParams = await extractCricketMatchContext(topic, trendReason, liveSearchFacts);
    const bible = buildCricketVisualBible(cricketParams);
    console.log(`[Video] 🏏 Synthesized dynamic Cricket Visual Bible with locked Actor DNA and 60,000+ packed crowd.`);
    return bible;
  }

  const preferredModel = process.env.GEMINI_MODEL;
  const prompt = VISUAL_BIBLE_PROMPT(topic, trendReason, domain);

  try {
    const { text } = await geminiGenerate(prompt, preferredModel);
    let cleaned = text.trim();
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) cleaned = match[1].trim();

    const parsed = JSON.parse(cleaned) as VisualBible;
    if (
      parsed.realWorldGrounding &&
      Array.isArray(parsed.organicSettings) &&
      Array.isArray(parsed.latentTrapsToBan) &&
      parsed.characterGrammar &&
      parsed.zeroTextRules &&
      parsed.soundscapeProfile
    ) {
      console.log(`[Video] ✅ Synthesized intelligent Visual & Acoustic Bible for "${topic}" (${parsed.latentTrapsToBan.length} dynamic negative traps, ${parsed.organicSettings.length} organic settings).`);
      return parsed;
    }
  } catch (err: any) {
    console.warn(`[Video] Notice: Dynamic Bible synthesis fallback used: [REDACTED]`);
  }

  return getFallbackVisualBible(topic, domain);
}
