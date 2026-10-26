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
    return CRICKET_PRODUCTION_TEMPLATE;
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
      characterGrammar: "Frame researchers in medium to wide shots, cleanroom bunny suits from behind, or silhouetted against glowing volumetric instrumentation. Ban macro facial close-ups.",
      zeroTextRules: "All computer readouts, telemetry consoles, and spectrometer charts must feature unlabeled glowing abstract panels, clean cyan/amber HUD glows, and zero legible letters or numbers.",
      soundscapeProfile: {
        energyLevel: "measured",
        ambientBedStyle: "drone",
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
      characterGrammar: "Prioritize natural physical environments, wildlife in natural motion, or expedition researchers in wide panoramic framing. Zero facial close-ups.",
      zeroTextRules: "Zero digital map outlines, zero boundary lines, zero latitude numbers in image generation.",
      soundscapeProfile: {
        energyLevel: "contemplative",
        ambientBedStyle: "nature",
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
    characterGrammar: "Documentary observational camera framing: athletic or professional subjects in authentic field gear, natural non-deformed anatomy, dynamic motion matching the topic. Zero distorted faces.",
    zeroTextRules: "Zero legible letters, zero hallucinated English words on walls, banners, screens, or uniforms. Clean physical textures only.",
    soundscapeProfile: {
      energyLevel: "high",
      ambientBedStyle: "industrial",
      dominantFrequencies: [60, 120, 240],
      foleyCues: ["subtle room tone", "mechanical click", "movement whoosh", "ambient atmosphere swell"]
    }
  };
}

const VISUAL_BIBLE_PROMPT = (topic: string, trendReason?: string, domain?: VideoDomain) => `You are an elite Hollywood production designer and visual director.
Analyze this video topic: "${topic}" ${trendReason ? `(Trend Context: ${trendReason})` : ""} (Domain: ${domain || "general"}).

Synthesize an exact, non-hallucinatory Visual & Acoustic Production Bible tailored to this topic.
Your output will be used to steer image diffusion (FLUX.1-schnell) and video motion models (Wan2.1-VACE).

Return a JSON object with:
1. "realWorldGrounding": A precise 2-sentence description of the authentic physical venue/stage where this event occurs. Strictly forbid colonial mansions, british palaces, havelis, luxury resort gardens, or domestic rooms for technical, military, space, and sports topics.
2. "organicSettings": An array of 6-10 authentic scene settings physically native to this topic.
3. "latentTrapsToBan": An array of 20-30 specific negative prompt strings that generative models frequently hallucinate for this topic (e.g. cross-sport equipment, incorrect period architecture, distorted text, scoreboard traps, malformed anatomy).
4. "characterGrammar": Strict cinematic rules for human anatomy, camera angles, lighting, motion safety, and authentic uniforms/clothing for this topic.
5. "zeroTextRules": Explicit rules ensuring zero legible scoreboards, ticker text, digital numbers, or brand logos appear in generated latents.
6. "soundscapeProfile": {
  "energyLevel": "high" | "measured" | "contemplative",
  "ambientBedStyle": "stadium" | "industrial" | "nature" | "orchestral" | "drone",
  "dominantFrequencies": [number, number],
  "foleyCues": ["string"]
}

Return ONLY raw JSON in this structure:
{
  "realWorldGrounding": "string",
  "organicSettings": ["string"],
  "latentTrapsToBan": ["string"],
  "characterGrammar": "string",
  "zeroTextRules": "string",
  "soundscapeProfile": {
    "energyLevel": "high",
    "ambientBedStyle": "stadium",
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
2. "heroPlayersDNA": "Concrete Character Visual DNA for the notable key players in this match (e.g. Hero Batter <Name>: <exact age/ethnicity, trimmed beard or clean-shaven, hair, athletic build, team kit, batting pads, helmet with steel grille, signature shot and passionate bat-raising celebration>; Hero Partner or Bowler <Name>: <appearance, kit, celebration huddle>). Ensure 100% actor visual consistency across scenes."

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
  } catch (err: any) {
    console.warn(`[Video] Cricket dynamic match extraction non-fatal fallback: ${err?.message || err}`);
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
