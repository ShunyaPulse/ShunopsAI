import { geminiGenerate } from "./gemini.js";
import type { VideoDomain, VisualBible } from "./types.js";

/**
 * Provides an intelligent domain-level fallback Visual Bible if LLM synthesis is temporarily unavailable.
 */
export function getFallbackVisualBible(topic: string, domain: VideoDomain): VisualBible {
  if (domain === "sports") {
    return {
      realWorldGrounding: `Authentic professional athletic venue for ${topic}, real sport-specific equipment, authentic pitch or court, dramatic floodlights, crisp natural textures.`,
      organicSettings: [
        "Competition playing field or pitch",
        "Team dugout and technical bench",
        "Locker room and tactical review board",
        "Practice nets and training ground",
        "Press conference media room"
      ],
      latentTrapsToBan: [
        "baseball", "baseball bat", "baseball glove", "american football", "american football helmet",
        "rugby ball", "tennis court", "basketball hoop", "office cubicle", "corporate boardroom",
        "cctv control room", "abstract 3d floating objects", "cartoon", "anime"
      ],
      characterGrammar: "Frame athletes in dynamic medium-to-wide action shots, over-the-shoulder perspectives, or dramatic floodlit silhouettes. Strictly ban macro facial portrait close-ups of real athletes to prevent face morphing.",
      zeroTextRules: "Scoreboards, perimeter LED boards, and player jerseys must be clean solid color panels and glowing abstract indicator lights with zero text, zero letters, zero numbers.",
      soundscapeProfile: {
        energyLevel: "high",
        ambientBedStyle: "stadium",
        dominantFrequencies: [65, 130],
        foleyCues: ["stadium crowd roar", "ball impact", "referee whistle chime", "athletic footwear turf squeak"]
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
      "Executive planning or strategic chamber",
      "Public archival or historic landmark site"
    ],
    latentTrapsToBan: [
      "suspension bridge runway", "ocean stilts", "scrambled airport display letters", "rubber swords",
      "floating drums", "office cubicle defaults", "distorted faces", "mutated hands", "cartoon", "anime"
    ],
    characterGrammar: "Cinematic wide-to-medium steadicam tracking, natural posture, locked rigid background geometry, zero facial morphing.",
    zeroTextRules: "Displays, status boards, and signs must be depicted as unlabeled glowing abstract panels with zero letters, zero numbers, zero pseudocode.",
    soundscapeProfile: {
      energyLevel: "dramatic",
      ambientBedStyle: "orchestral",
      dominantFrequencies: [58, 116],
      foleyCues: ["subtle room tone", "ceremonial resonance", "ambient reverberation"]
    }
  };
}

const VISUAL_BIBLE_PROMPT = (topic: string, trendReason: string | undefined, domain: VideoDomain): string => `You are an elite Hollywood Production Designer, Director of Photography, and Master Sound Designer.
Analyze this documentary video topic and synthesize an authoritative, topic-specific Visual & Acoustic Production Bible.

TOPIC: "${topic}"
${trendReason ? `BREAKING EVENT CONTEXT: "${trendReason}"` : ""}
PRIMARY DOMAIN: ${domain.toUpperCase()}

Your goal is to eliminate generative AI hallucinations, diffusion biases, distorted faces, gibberish AI text, and acoustic mismatch by specifying strict semantic directives for this EXACT topic.

Analyze:
1. "realWorldGrounding": 1-2 concrete, vivid sentences describing the authentic physical environment, architectural style, real equipment, textures, and lighting for THIS specific topic.
2. "organicSettings": Array of 4-6 authentic real-world physical locations where this topic naturally takes place (e.g. for cricket: dugout, pavilion, 22-yard turf pitch, practice nets, dressing room; for airport: air traffic control tower, tarmac taxiway, maintenance hangar, terminal boarding lounge; for space: mission control console, satellite integration cleanroom, launchpad gantry). Strictly ban irrelevant default spaces (e.g. generic office cubicles, CCTV rooms, fantasy bridges).
3. "latentTrapsToBan": Array of 10-18 topic-specific negative prompts and diffusion biases that AI video models frequently hallucinate for this topic (e.g. for cricket: baseball, baseball bat, american football helmet, rugby ball, tennis court, office cubicle, 3d stacked spheres; for airports: suspension bridge runway, runway in water, ocean stilts, fids screen letters; for historical: modern wristwatches, nylon, plastic, modern cars; for space: sports jerseys, fantasy portals).
4. "characterGrammar": Explicit camera framing and cinematography rules for characters/athletes/figures in this video to prevent face warping, distorted eyes, or melting skin (e.g. medium-to-wide action shots, over-the-shoulder perspectives, floodlit silhouettes; zero macro facial portraits of recognizable celebrities).
5. "zeroTextRules": Concrete instructions on how all screens, monitors, scoreboards, jerseys, or documents in this topic must be rendered as clean, text-free visual metaphors (e.g. "unlabeled glowing abstract telemetry displays, solid color athletic jerseys, illuminated status indicators with zero letters, zero numbers, zero pseudocode").
6. "soundscapeProfile":
   - "energyLevel": One of "high", "measured", "contemplative", "dramatic".
   - "ambientBedStyle": One of "drone", "stadium", "nature", "industrial", "orchestral".
   - "dominantFrequencies": Array of 2-3 Hz numbers (e.g. [55, 110] for deep sub-bass, [65, 130] for sports pulse, [45, 90] for oceanic nature).
   - "foleyCues": Array of 3-5 authentic sound effect elements (e.g. ["bat leather impact", "stadium roar", "cleat footstep"] or ["jet engine roar", "atc radio chime", "runway wind"]).

Return ONLY a valid JSON object matching this schema without any markdown formatting or commentary:
{
  "realWorldGrounding": "string",
  "organicSettings": ["string"],
  "latentTrapsToBan": ["string"],
  "characterGrammar": "string",
  "zeroTextRules": "string",
  "soundscapeProfile": {
    "energyLevel": "high",
    "ambientBedStyle": "stadium",
    "dominantFrequencies": [65, 130],
    "foleyCues": ["string"]
  }
}`;

/**
 * Intelligent Director's Visual & Acoustic Bible Synthesizer.
 * Dynamically extracts topic-specific real-world grounding, authentic venues,
 * latent diffusion traps, anatomical character rules, and soundscape profile.
 * Replaces narrow brittle regex / hardcoded rules with semantic AI reasoning.
 */
export async function synthesizeTopicVisualBible(
  topic: string,
  trendReason?: string,
  domain: VideoDomain = "general"
): Promise<VisualBible> {
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
