import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as dotenv from "dotenv";
import {
  isGoogleCloudTTSAvailable,
  synthesizeGoogleCloudTTS,
  resolveGCPVoice,
} from "./gcp-tts.js";
import {
  isKokoroAvailable,
  synthesizeKokoroTTS,
} from "./kokoro-tts.js";
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

const execFileAsync = promisify(execFile);

const JOBS_DIR = path.resolve(process.cwd(), "jobs");
const RENDER_SRC = path.resolve(process.cwd(), "video", "kernel", "render.py");

function kaggleEnv(): NodeJS.ProcessEnv {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
  const key = process.env.VIDEO_TOKEN || process.env.KAGGLE_KEY || process.env.KAGGLE_API_TOKEN;
  const pathSep = os.platform() === "win32" ? ";" : ":";
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    KAGGLE_USERNAME: user,
    KAGGLE_KEY: key,
    KAGGLE_API_TOKEN: key,
    PATH: `${process.env.PATH}${pathSep}${path.join(os.homedir(), ".local", "bin")}`,
  };
}

export async function kaggle(args: string[], timeout = 120000): Promise<string> {
  const env = kaggleEnv();
  const isWin = os.platform() === "win32";
  const cmd = isWin ? "python" : "kaggle";
  const finalArgs = isWin ? ["-X", "utf8", "-m", "kaggle", ...args] : args;

  try {
    const { stdout, stderr } = await execFileAsync(cmd, finalArgs, {
      env,
      timeout,
      maxBuffer: 1024 * 1024 * 5,
    });
    return (stdout + (stderr ? `\n${stderr}` : "")).trim();
  } catch (e: any) {
    if (!isWin) {
      try {
        const { stdout, stderr } = await execFileAsync("python", ["-X", "utf8", "-m", "kaggle", ...args], {
          env,
          timeout,
          maxBuffer: 1024 * 1024 * 5,
        });
        return (stdout + (stderr ? `\n${stderr}` : "")).trim();
      } catch (pyErr: any) {
        return `Kaggle CLI Error: ${pyErr.message}\n${pyErr.stderr || ""}`.trim();
      }
    }
    return `Kaggle CLI Error: ${e.message}\n${e.stderr || ""}`.trim();
  }
}

export type VideoDomain = "science" | "space" | "technology" | "nature" | "history" | "sports" | "general";

export interface VideoScript {
  title: string;
  description: string;
  tags: string[];
  voice: string;
  rate?: string;
  language?: string;
  domain?: VideoDomain;
  chapters: { title: string; start_scene: number }[];
  scenes: { narration: string; caption?: string; visual_prompt: string }[];
  thumbnail?: {
    headline: string;
    subheadline?: string;
    visual_prompt: string;
  };
}

/**
 * Parse the comma-separated GEMINI_API_KEY pool and return an array of trimmed keys.
 */
function geminiKeyPool(): string[] {
  const raw =
    process.env.GEMINI_KEYS ??
    process.env.GEMINI_API_KEYS ??
    process.env.GEMINI_API_KEY ??
    "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Quality-ranked order of Gemini models.
 * For each model, 5-6 keys from the pool are attempted.
 * If all 5-6 keys encounter errors (rate limit, quota, overloaded),
 * quality is degraded to the next model in this order.
 */
export const GEMINI_MODELS_QUALITY_ORDER = [
  "gemini-3.8-flash",        // Active verified primary (3.5/3.6/3.7 deprecated & routed to 3.8)
  "gemini-3-flash-preview",  // Active verified quota (1 / 5)
];

const KEYS_PER_MODEL_ATTEMPT = 6;

/**
 * Select a slice of `count` keys starting at a random offset to distribute load evenly.
 */
function pickKeySubset(pool: string[], count: number): string[] {
  if (pool.length <= count) return [...pool];
  const start = Math.floor(Math.random() * pool.length);
  const subset: string[] = [];
  for (let i = 0; i < count; i++) {
    const k = pool[(start + i) % pool.length];
    if (k) subset.push(k);
  }
  return subset;
}

/**
 * Call Gemini generateContent with 5-6 key retries per model,
 * degrading to the next model in GEMINI_MODELS_QUALITY_ORDER only if all keys fail.
 */
export async function geminiGenerate(prompt: string, preferredModel?: string): Promise<{ text: string; modelUsed: string }> {
  const pool = geminiKeyPool();
  if (!pool.length) throw new Error("GEMINI_API_KEY pool is empty");

  // Determine model hierarchy: preferred model first if specified, followed by the rest
  const modelsToTry = preferredModel
    ? [preferredModel, ...GEMINI_MODELS_QUALITY_ORDER.filter((m) => m !== preferredModel)]
    : GEMINI_MODELS_QUALITY_ORDER;

  let globalLastErr = "";

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const model = modelsToTry[mIdx];
    const candidateKeys = pickKeySubset(pool, Math.min(KEYS_PER_MODEL_ATTEMPT, pool.length));
    const candidateCount = candidateKeys.length;
    console.log(`[Video] Trying model [${mIdx + 1}/${modelsToTry.length}]: "${model}" with ${candidateCount} attempts...`);

    for (let kIdx = 0; kIdx < candidateKeys.length; kIdx++) {
      const key = candidateKeys[kIdx];
      if (!key) continue;
      const keySuffix = key.slice(-6);

      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.8,
                maxOutputTokens: 32768,
              },
            }),
            signal: AbortSignal.timeout(180000),
          }
        );

        if (res.ok) {
          const data: any = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
          if (text) {
            console.log(`[Video] Success with model: "${model}"`);
            return { text, modelUsed: model ?? "unknown" };
          }
        }

        const body = await res.text();
        const errMsg = `Status ${res.status}: ${body.slice(0, 180)}`;
        globalLastErr = `Model ${model} (key ...${keySuffix}) -> ${errMsg}`;
        console.warn(`[Video] Key [${kIdx + 1}/${candidateKeys.length}] failed for ${model}: ${errMsg}`);

        // If model is 404 (does not exist / deprecated), do not waste other keys on this model
        if (res.status === 404) {
          console.warn(`[Video] Model "${model}" returned 404. Skipping remaining keys for this model.`);
          break;
        }

        // Small pause between key retries
        await new Promise((r) => setTimeout(r, 400));
      } catch (err: any) {
        globalLastErr = `Model ${model} (key ...${keySuffix}) error: ${err.message}`;
        console.warn(`[Video] Key [${kIdx + 1}/${candidateKeys.length}] network error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    if (mIdx < modelsToTry.length - 1) {
      console.warn(`[Video] ⚠️ Model "${model}" failed across keys. Degrading quality to next model: "${modelsToTry[mIdx + 1]}"...`);
    }
  }

  // Cross-provider backup: if all Gemini models failed, fallback to Groq
  const groqPool = (process.env.GROQ_KEYS || process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const groqKey = groqPool.length > 0 ? groqPool[Math.floor(Math.random() * groqPool.length)] : process.env.GROQ_API_KEY;
  if (groqKey) {
    console.warn(`[Video] ⚠️ Attempting cross-provider fallback to Groq (openai/gpt-oss-120b, qwen/qwen3.8-27b)...`);
    const groqModels = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
    for (const gModel of groqModels) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model: gModel,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const data: any = await res.json();
          const text = data?.choices?.[0]?.message?.content ?? "";
          if (text) {
            console.log(`[Video] Success with Groq fallback model: "${gModel}"`);
            return { text, modelUsed: `groq:${gModel}` };
          }
        }
      } catch (err: any) {
        console.warn(`[Video] Groq fallback ${gModel} failed: ${err.message}`);
      }
    }
  }

  // Cross-provider backup Tier 3: OpenRouter High-Capability Models
  const openrouterPool = (process.env.OPENROUTER_KEYS || process.env.OPENROUTER_API_KEYS || process.env.OPENROUTER_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const openrouterKey = openrouterPool.length > 0 ? openrouterPool[Math.floor(Math.random() * openrouterPool.length)] : process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    console.warn(`[Video] ⚠️ Attempting cross-provider fallback to OpenRouter...`);
    const openrouterModels = [
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "nvidia/nemotron-3.5-lightning:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemma-4-31b-it:free",
      "cohere/north-mini-code:free",
      "openrouter/free",
    ];
    for (const oModel of openrouterModels) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openrouterKey}`,
            "HTTP-Referer": "https://github.com/ShunyaPulse/ShunopsAI",
            "X-Title": "ShunopsAI Video Script Generation",
          },
          body: JSON.stringify({
            model: oModel,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const data: any = await res.json();
          const text = data?.choices?.[0]?.message?.content ?? "";
          if (text) {
            console.log(`[Video] Success with OpenRouter fallback model: "${oModel}"`);
            return { text, modelUsed: `openrouter:${oModel}` };
          }
        }
      } catch (err: any) {
        console.warn(`[Video] OpenRouter fallback ${oModel} failed: ${err.message}`);
      }
    }
  }

  throw new Error(`All models in GEMINI_MODELS_QUALITY_ORDER, Groq fallback, and OpenRouter fallback failed. Last error: ${globalLastErr}`);
}

/**
 * Detects the intellectual domain of the topic to enforce strict authentic aesthetics,
 * prevent inappropriate cross-domain tropes (e.g. sports gear in science videos),
 * and calibrate narration tone and pacing.
 */
export function detectVideoDomain(topic: string, trendReason?: string): VideoDomain {
  const combined = `${topic} ${trendReason || ""}`.toLowerCase();

  // Sports pattern
  if (/\b(cricket|football|soccer|fifa|ipl|match|score|wicket|batsman|bowler|century|ronaldo|messi|kusal mendis|virat kohli|babar|rohit sharma|champions trophy|world cup|olympics|tennis|badminton|f1|formula 1|formula one|stadium|championship|tournament|league|athlete)\b/i.test(combined)) {
    return "sports";
  }

  // Space pattern
  if (/\b(space|isro|nasa|jwst|james webb|telescope|black hole|astronomy|galaxy|nebula|pulsar|supernova|exoplanet|mars|moon|chandrayaan|artemis|voyager|spacex|cosmos|orbit|interstellar|asteroid|meteor|comet)\b/i.test(combined)) {
    return "space";
  }

  // Science / Physics / Biology pattern
  if (/\b(science|physics|quantum|particle|atom|molecule|biology|dna|gene|crispr|genetics|vaccine|virus|chemistry|laboratory|microscope|fusion|cern|hadron|nobel|gravitational wave|relativity|evolution|neuroscience)\b/i.test(combined)) {
    return "science";
  }

  // Technology / Engineering pattern
  if (/\b(semiconductor|microchip|gpu|nvidia|robot|robotics|artificial intelligence|\bai\b|llm|supercomputer|algorithm|cyber|tunnel|bridge|megaproject|battery|lithium|ev\b|nuclear reactor|engine|photolithography|fab\b|nanometer)\b/i.test(combined)) {
    return "technology";
  }

  // Nature / Earth pattern
  if (/\b(ocean|deep sea|abyss|marianas trench|volcano|earthquake|wildlife|glacier|antarctica|ecosystem|biodiversity|forest|coral reef|species|amazon rainforest|geology)\b/i.test(combined)) {
    return "nature";
  }

  // History / Archaeology pattern
  if (/\b(history|ancient|civilization|archaeology|excavation|dynasty|temple|kailash temple|pyramid|empire|monument|ruins|century|medieval|bronze age|indus valley|harappa|mohenjo|sculpture|inscriptions)\b/i.test(combined)) {
    return "history";
  }

  return "general";
}

/**
 * Returns strict visual and tonal prompt directives tailored to the domain.
 */
export function getDomainPromptDirectives(domain: VideoDomain): string {
  switch (domain) {
    case "science":
    case "space":
    case "technology":
      return `CRITICAL DOMAIN DIRECTIVES (${domain.toUpperCase()} INTELLECTUAL DOCUMENTARY):
- MANDATORY HARD SCIENTIFIC METRICS & SCALE (CONCRETE NUMBERS):
  * Spoken narration MUST state concrete, real-world measurements rather than vague descriptions: exact distances (km, light years, astronomical units), wavelengths (infrared, X-ray), temperatures (Kelvin, Celsius), mirror/antenna diameters, speeds, or dates (e.g. "Dharti se 15 lakh kilometer door L2 orbit", "minus 233 degree Celsius", "6.5 meter ka beryllium mirror", "13.6 billion saal purani pehli galaxy").
  * STRICTLY BAN vague fluff ("bohot door tha", "bohot bada tha"); anchor every scene with real physical scale.
- STRICT BAN ON SPORTS, ATHLETICS & CARTOONS:
  * ABSOLUTELY ZERO sports footage, cricket bats, balls, pads, wickets, footballs, American football or baseball helmets, athletic jerseys, referee uniforms, scoreboards, or stadium crowds.
  * ABSOLUTELY ZERO anime, cartoon, manga, or comic caricature characters.
- CINEMATIC REALISM & VISUAL MOTIFS:
  * Visuals MUST authentically depict real physical science: ${domain === "space" ? "golden beryllium telescope mirrors (JWST style), radio telescope dishes pointing at the stars, deep cosmic nebulae with accurate gravitational lensing, orbital mechanics, planetary surfaces, solar flare magnetic loops" : domain === "technology" ? "sub-nanometer photolithography cleanrooms with deep ultraviolet illumination, silicon wafer inspection, superconducting quantum processor dilution refrigerators, sleek industrial robotics, high-speed fiber-optic data switches" : "particle collision tracks, cryogenic electron microscopy, laser interferometry, glowing plasma chambers, 3D molecular protein folding models, sterile laboratory cleanrooms"}.
- ELIMINATION OF CHARACTER WARPING & FACE MORPHING:
  * For science and space documentaries, NEVER generate recurring human face close-ups across cuts (which causes horrific AI face warping, eye distortion, and melting skin).
  * Keep visuals focused on the physical phenomenon, cosmic structures, instruments, cleanroom robots, or silhouetted researchers seen from a wide angle or from behind in cleanroom bunny suits.
- ZERO AI TEXT IN DIFFUSION RULE (MANDATORY):
  * Diffusion models must NEVER attempt to render legible text, letters, numerals, words, or pseudocode in the image (which creates gibberish distorted glyphs).
  * Every monitor, telemetry screen, or laboratory readout MUST be described as: "unlabeled glowing abstract cyan and amber telemetry monitors, clean holographic data visualization, ambient volumetric HUD glow with zero text, zero letters, zero numbers".
- AUDIO TONE, CADENCE & INTELLIGENT ENERGY:
  * Voiceover tone must be measured, cerebral, awe-inspiring, and authoritative (in the style of Cosmos / Veritasium / Think School / Brian Cox).
  * NOT screaming sports commentary or shallow reel hype. Deliver an intellectual thrill with dynamic pitch variation, thoughtful pauses before major revelations, and deep respect for the viewer's intelligence.`;

    case "sports":
      return `CRITICAL DOMAIN DIRECTIVES (SPORTS DOCUMENTARY):
- MANDATORY MATCH NUMBERS & SCORECARD CONTEXT (THE JOURNALISTIC ANCHOR):
  * Spoken narration MUST deliver the concrete real-world match figures, scoreboard situation, and individual statistics:
    1. Opponent's total score or target to chase (e.g. "Pakistan ne pehle batting karte hue 344 runs ka vishal score khada kiya").
    2. Exact match situation when player walked out to bat (e.g. "Sri Lanka ke 2 wickets sirf 28 run par gir chuke the").
    3. The player's exact individual milestone numbers (e.g. "Mendis ne sirf 77 gendon mein 122 run ki tabadtod paari kheli — jisme 14 chauke aur 6 chhakke shamil the").
    4. Required run rate, partnership numbers, and the ultimate match outcome.
  * STRICTLY BAN generic, abstract fluff ("unhone shandar paari kheli", "match bohot exciting tha") without backing it up with exact numbers, wickets, balls, and runs.
- AUTHENTIC ATHLETIC REALISM:
  * Visuals must accurately depict the specific sport being discussed. If cricket, depict green pitch, authentic cricket bats, red/white leather cricket ball, three wooden stumps. NEVER confuse cricket with baseball or American football helmets.
  * Ban cartoon/anime faces and distorted crowds. Use dynamic steadycam motion tracking athlete movements.
- ZERO AI TEXT IN DIFFUSION RULE:
  * NEVER render text on jerseys, scoreboards, or stadium hoardings. Describe them as: "unlabeled athletic team jerseys with clean solid color panels, glowing stadium floodlights, dynamic out-of-focus crowd with zero legible text or letters".
- HIGH ENERGY & PASSIONATE CADENCE:
  * Voiceover tone must be energetic, thrilling, and punchy, capturing the high-stakes drama of the match or tournament with rising pitch on clutch moments.`;

    case "history":
      return `CRITICAL DOMAIN DIRECTIVES (HISTORICAL INQUIRY):
- MANDATORY CHRONOLOGY & ARCHITECTURAL METRICS:
  * State exact centuries, dynasty names, estimated stone tonnages, and archaeological timelines (e.g. "8th century Rashtrakuta dynasty", "2 lakh ton basalt rock ko top-down kaat kar").
- AUTHENTIC ARCHITECTURAL & PERIOD REALISM:
  * Ancient stonework, weathered monolithic architecture, archaeological excavation trenches, atmospheric dust motes in stone corridors, warm volumetric sunlight.
  * Zero modern sports gear, zero plastic, zero cartoon aesthetics.
- ELIMINATION OF CHARACTER MORPHING:
  * Focus on monolithic structures, ancient tools, geological strata, carved stone relief without modern facial close-ups.
- ZERO AI TEXT IN DIFFUSION:
  * Abstract ancient chisel marks and weathered hieroglyphic silhouettes with zero modern legible letters or text.
- REVERENT, IMMERSIVE TONE:
  * Deep, resonant, captivating storytelling with deliberate pacing.`;

    case "nature":
      return `CRITICAL DOMAIN DIRECTIVES (NATURE & DEEP EARTH):
- NATURAL MAJESTY & MACRO/MICRO TEXTURES:
  * Deep ocean abyss, bioluminescent creatures, volcanic basalt lava flows, massive Antarctic ice shelves, pristine untouched geological landscapes.
  * Zero sports gear, zero cartoon aesthetics.
- ZERO TEXT IN DIFFUSION:
  * Pure untouched nature, zero artificial text.
- AWE-INSPIRING TONE:
  * Contemplative, immersive documentary narration.`;

    default:
      return `CRITICAL DOMAIN DIRECTIVES (GENERAL DOCUMENTARY):
- AUTHENTIC CINEMATIC REALISM:
  * Modern digital documentary cinematography, authentic textures, balanced natural lighting.
  * Zero sports gear unless the topic is sports; zero cartoon/anime aesthetics.
- ZERO AI TEXT IN DIFFUSION:
  * Zero legible text, letters, or numbers inside the generated video frame.
- ENGAGING, DYNAMIC TONE:
  * Clear, authoritative, intelligent pacing.`;
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
  const domainDirectives = getDomainPromptDirectives(domain);

  // Curated documentary voices:
  // hi-IN-Neural2-C: Authoritative documentary studio narrator (Priority for Science/Space/Tech/History)
  // hi-IN-Neural2-B: Dynamic, energetic narrator (Priority for Sports/General)
  // en-IN-PrabhatNeural: authentic Indian intellectual documentary narrator
  const voice = /hindi/i.test(language)
    ? (domain === "sports" ? "hi-IN-Neural2-B" : "hi-IN-Neural2-C")
    : "en-IN-PrabhatNeural";

  const rate = domain === "sports" ? "+4%" : "+0%";

  const sanitizedTrendReason = trendReason
    ? trendReason
        .replace(/\b\d+[\d,]*\+?\s*(searches|search|traffic|queries|queries on google|searches on google trends)\b/gi, "")
        .replace(/\b(50k\+|100k\+|200k\+|500k\+|10k\+|20k\+|5k\+)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    : undefined;

  const prompt = `You are an elite investigative documentary filmmaker and YouTube director (Vox, Johnny Harris, Think School style).
Write a gripping, 100% factual, highly engaging video script with hard synchronization between spoken narration and cinematic footage.

Topic: ${topic}
${sanitizedTrendReason ? `BREAKING REAL-WORLD EVENT CONTEXT: "${sanitizedTrendReason}"` : ""}
Domain: ${domain.toUpperCase()}
Language: ${language}
Target Length: about ${targetWords} spoken words (${minutes} minutes) divided into about ${sceneCount} tightly-paced scenes (12-20 words each).

${domainDirectives}

CRITICAL DIRECTIVES:
1. MANDATORY - COVER THE ACTUAL BREAKING EVENT (STRICT ZERO SEARCH NUMBERS / METRICS):
   - The video MUST directly explain the REAL-WORLD EVENT, match, breakthrough, policy, or incident: ${sanitizedTrendReason || topic}.
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
   - ZERO AI UI / TEXT HALLUCINATIONS (CRITICAL):
     * NEVER instruct the AI model to render legible text, words, labels, graphs, line charts, or alphanumeric dashboards inside the shot.
     * When screens, monitors, or control rooms are depicted, explicitly specify: "unlabeled glowing telemetry monitors, abstract clean data visualization, ambient blue HUD glow with zero text, zero letters, zero numbers, zero pseudocode".
     * Any data charts or maps will be composited as clean motion graphics templates in post-production.
   - RIGID BACKGROUND GEOMETRY & LOW-MOTION STABILITY (PREVENT BREATHING/SURFACE WARPING):
     * For indoor, laboratory, server room, and character shots: Specify steady camera control: "Subtle character breathing and gentle eye movement, locked solid background geometry, rigid non-morphing walls, stable monitor frames in 3D space".
     * Ban rapid boiling, shifting surfaces, and inconsistent morphing.
   - CONTROLLED DOLLY SPEEDS (ELIMINATE MOTION BLUR & FRAME SMEAR):
     * Ban whip-pans, fast zooms, or aggressive camera tracks.
     * Specify slow, controlled, steady camera work: "Slow cinematic dolly forward on track", "Smooth steadicam glidecam push-in", "Gentle cinematic tripod pan".
   - Modern Digital Lighting & Clarity:
     * "Crisp natural 4K digital cinematography, modern high-end documentary lighting, balanced realistic color grade, sharp clean focus, absolutely NO vintage/retro/sepia/8mm/grainy aesthetics."
   - Realism enforcement: Clean, authentic physical textures (modern architectural glass, polished materials, real skin, crisp telemetry). Avoid retro filters, heavy grain, sepia tones, plastic CGI, or still-photo aesthetics.
5. HIGH-CLICKTHROUGH (CTR) TRUTHFUL THUMBNAIL CONCEPT (OPTION A):
   - Design a dedicated hero concept thumbnail that creates irresistible psychological curiosity ("Ask Studio" style) without deception or clickbait lies.
   - It must authentically depict the central subject, revelation, or event of the video with cinematic drama, rim lighting, atmospheric depth, and deep contrast.
   - Include a short, bold 2-4 word headline (e.g. "GHOST PARTICLES", "SECRET DEEP ICE", "THE IMPOSSIBLE ENGINE") and a complementary subheadline.
6. Return ONLY valid JSON in this exact structure:
{
  "title": "<Hybrid Title: [English Topic] : [Hinglish Curiosity Hook], Roman alphabet only, <=70 chars, NO Devanagari>",
  "description": "<Comprehensive Pure English SEO description of the event, 150-250 words with timestamps & keywords, NO Devanagari>",
  "tags": ["<8-15 high volume relevant tags in English alphabet>"],
  "chapters": [{"title": "<Chapter Title in English>", "start_scene": 0}],
  "thumbnail": {
    "headline": "<Punchy 2-4 word high-impact text hook, e.g. 'GHOST PARTICLES'>",
    "subheadline": "<Sub-hook or curiosity teaser, e.g. 'ANTARCTICA DEEP ICE SECRET'>",
    "visual_prompt": "<Extremely vivid, cinematic hero poster prompt in pure English: dramatic subject, intense rim lighting, atmospheric glow, high dynamic range, clean composition leaving lower space for text, 8k cinematic masterpiece, zero text in image>"
  },
  "scenes": [
    {
      "narration": "<Exact words spoken in Hindi by voice ${voice}>",
      "caption": "<Exact English translation in pure English language and Roman alphabet for on-screen subtitles>",
      "visual_prompt": "<Ultra-detailed cinematic video prompt in English: camera move (slow dolly/steadicam), lens, subject action matching narration, lighting, locked rigid background geometry, clean text-free screens>"
    }
  ]
}`;

  const pool = geminiKeyPool();
  const { text, modelUsed } = await geminiGenerate(prompt, preferredModel);

  if (!text) throw new Error("Gemini returned empty content");
  let script: VideoScript;
  try {
    script = JSON.parse(text) as VideoScript;
  } catch {
    // Sometimes the model wraps JSON in a code fence — strip it
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match && match[1]) {
      script = JSON.parse(match[1]) as VideoScript;
    } else {
      throw new Error(`Gemini response is not valid JSON: ${text.slice(0, 200)}`);
    }
  }

  if (!script.scenes?.length) throw new Error("Gemini returned a script with no scenes");
  script.voice = voice;
  script.language = language;
  script.domain = domain;
  script.rate = script.rate || rate;
  console.log(`[Video] Script generated with model "${modelUsed}" for domain "${domain}" via Gemini key pool (${pool.length} keys). Title: ${script.title}`);
  return script;
}

/**
 * Curated Microsoft Edge-TTS voices for non-GCP users.
 */
export function resolveEdgeVoice(
  requestedVoice?: string,
  language = "Hindi",
  domain: VideoDomain = "general"
): { name: string; pitch: string; rate: string } {
  const isHindi = /hindi/i.test(language) || (requestedVoice && requestedVoice.toLowerCase().includes("hi"));
  const defaultRate = domain === "sports" ? "+4%" : "+0%";
  const defaultPitch = domain === "sports" ? "+0Hz" : (domain === "science" || domain === "space" || domain === "technology" || domain === "history" ? "-2Hz" : "+0Hz");

  if (isHindi) {
    if (requestedVoice && (requestedVoice.toLowerCase().includes("swara") || requestedVoice.toLowerCase().includes("female"))) {
      return { name: "hi-IN-SwaraNeural", pitch: defaultPitch, rate: defaultRate };
    }
    // Natural, crisp male Hindi voice
    return { name: "hi-IN-MadhurNeural", pitch: defaultPitch, rate: defaultRate };
  }

  // English
  if (requestedVoice && (requestedVoice.toLowerCase().includes("neerja") || requestedVoice.toLowerCase().includes("female"))) {
    return { name: "en-IN-NeerjaExpressiveNeural", pitch: defaultPitch, rate: defaultRate };
  }
  return { name: "en-IN-PrabhatNeural", pitch: defaultPitch, rate: defaultRate };
}

/**
 * Pre-synthesizes narration locally using Microsoft Edge-TTS via python -m edge_tts.
 * Packages ready audio into the Kaggle dataset to bypass Kaggle datacenter IP 403 Forbidden blocks.
 */
export async function synthesizeLocalEdgeTTS(
  text: string,
  outPath: string,
  voice = "hi-IN-MadhurNeural",
  pitch = "+0Hz",
  rate = "+0%"
): Promise<boolean> {
  const tmpTxt = path.join(os.tmpdir(), `edge_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  try {
    await fs.writeFile(tmpTxt, text, "utf-8");
    const args = ["-m", "edge_tts", "-f", tmpTxt, "-v", voice, "--pitch", pitch, "--rate", rate, "--write-media", outPath];
    await execFileAsync("python", args, { timeout: 30000 });
    const stat = await fs.stat(outPath);
    return stat.size > 500;
  } catch (err: any) {
    return false;
  } finally {
    await fs.unlink(tmpTxt).catch(() => {});
  }
}

/**
 * Stage 3: package script + renderer and launch it on a Kaggle GPU kernel.
 */
export async function startVideoJob(
  topic: string,
  minutes = 5,
  language = "English",
  trendReason?: string,
  options?: { gcpKey?: string }
): Promise<string> {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
  if (!user) return "Error: KAGGLE_USERNAME not set.";

  const script = await generateScript(topic, minutes, language, trendReason);
  const id = Date.now().toString(36);
  const jobDir = path.join(JOBS_DIR, id);
  const dsDir = path.join(jobDir, "dataset");
  const kDir = path.join(jobDir, "kernel");
  await fs.mkdir(dsDir, { recursive: true });
  await fs.mkdir(kDir, { recursive: true });

  // Pre-synthesize studio-grade narration (Tier 1: Google Cloud Neural2, Tier 2: Calibrated Edge-TTS)
  const audioDir = path.join(dsDir, "audio");
  await fs.mkdir(audioDir, { recursive: true });

  const gcpAvailable = isGoogleCloudTTSAvailable(options?.gcpKey);
  const gcpVoice = gcpAvailable ? resolveGCPVoice(script.voice, language) : null;
  const edgeVoice = resolveEdgeVoice(script.voice, language, script.domain || "general");

  console.log(
    gcpAvailable
      ? `[Video] 🎙️ Google Cloud Neural2 detected as Tier 1 Priority (${gcpVoice?.name}). Best-to-worst fallback: Tier 1 (Google Cloud Neural2) ➔ Tier 2 (Edge-TTS)...`
      : `[Video] 🎙️ No Google Cloud credentials. Running Tier 1 (Edge-TTS pre-synthesis [${edgeVoice.name}, pitch=${edgeVoice.pitch}, rate=${edgeVoice.rate}])...`
  );

  let gcpSuccessCount = 0;
  let edgeSuccessCount = 0;

  for (let i = 0; i < script.scenes.length; i++) {
    const sc = script.scenes[i];
    if (!sc) continue;
    const outMp3 = path.join(audioDir, `a${String(i).padStart(3, "0")}.mp3`);

    let synthesized = false;
    const isHindi = /hindi/i.test(language) || Boolean(script.voice && (/hindi|neural2|madhur|swara/i.test(script.voice) || script.voice.startsWith("hi-")));

    // For English: Tier 1 is Kokoro-82M SOTA Engine (Option A: Kaggle GPU / Local)
    if (!isHindi && (await isKokoroAvailable())) {
      synthesized = await synthesizeKokoroTTS(sc.narration, outMp3, {
        language,
        speed: 1.0,
      });
    }

    // Tier 1 for Hindi (or fallback for English): Google Cloud Neural2 with retries
    if (!synthesized && gcpAvailable && gcpVoice) {
      for (let gcpAttempt = 1; gcpAttempt <= 2; gcpAttempt++) {
        try {
          synthesized = await synthesizeGoogleCloudTTS(sc.narration, outMp3, {
            voiceName: gcpVoice.name,
            language,
            speakingRate: script.domain === "sports" ? 1.04 : 1.0,
            gcpKey: options?.gcpKey,
          });
          if (synthesized) {
            gcpSuccessCount++;
            break;
          }
        } catch (gcpErr: any) {
          console.warn(`[Video] ⚠️ Scene ${i + 1} Google Cloud TTS attempt ${gcpAttempt} failed: ${gcpErr.message}`);
        }
        if (gcpAttempt < 2) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!synthesized) {
        console.warn(`[Video] ⚠️ Scene ${i + 1} Google Cloud TTS failed after 2 attempts. Falling back to local Edge-TTS...`);
      }
    }

    // Edge-TTS (Local host fallback if GCP unavailable/failed)
    if (!synthesized) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        synthesized = await synthesizeLocalEdgeTTS(sc.narration, outMp3, edgeVoice.name, edgeVoice.pitch, edgeVoice.rate);
        if (synthesized) {
          edgeSuccessCount++;
          break;
        }
        console.warn(`[Video] ⚠️ Scene ${i + 1} Edge-TTS attempt ${attempt}/3 failed.`);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
    }

    if (!synthesized) {
      throw new Error(`[Video] Fatal: Audio synthesis failed for scene ${i + 1} after all attempts. Aborting job immediately to prevent launching a GPU kernel on a mute video.`);
    }
  }

  // Strict invariant: verify 100% of scenes have pre-packaged audio on disk before dataset creation
  for (let i = 0; i < script.scenes.length; i++) {
    const chkMp3 = path.join(audioDir, `a${String(i).padStart(3, "0")}.mp3`);
    try {
      const st = await fs.stat(chkMp3);
      if (st.size < 500) {
        throw new Error(`Scene audio ${path.basename(chkMp3)} is too small (${st.size} bytes).`);
      }
    } catch (err: any) {
      throw new Error(`[Video] Fatal: Pre-packaged audio verification failed for scene ${i + 1} (${chkMp3}): ${err.message}. Aborting dispatch to protect Kaggle GPU resources.`);
    }
  }

  if (gcpSuccessCount > 0 && gcpVoice) {
    script.voice = gcpVoice.name;
    console.log(`[Video] ✅ Audio synthesis complete: ${gcpSuccessCount}/${script.scenes.length} scenes via Google Cloud Neural2 (${gcpVoice.name}), ${edgeSuccessCount} via Edge-TTS fallback.`);
  } else if (edgeSuccessCount > 0) {
    script.voice = edgeVoice.name;
    console.log(`[Video] ✅ Audio synthesis complete: ${edgeSuccessCount}/${script.scenes.length} scenes synthesized via Edge-TTS.`);
  }

  await fs.writeFile(path.join(dsDir, "script.json"), JSON.stringify(script, null, 2));
  await fs.writeFile(
    path.join(dsDir, "dataset-metadata.json"),
    JSON.stringify({
      title: `video job ${id}`,
      id: `${user}/video-job-${id}`,
      licenses: [{ name: "CC0-1.0" }],
      is_private: true,
    })
  );
  await fs.writeFile(
    path.join(dsDir, "config.json"),
    JSON.stringify({
      groq_api_key: process.env.GROQ_API_KEY || "",
      hf_token: process.env.HF_TOKEN || "",
    }, null, 2)
  );
  await fs.copyFile(RENDER_SRC, path.join(kDir, "render.py"));
  await fs.writeFile(
    path.join(kDir, "kernel-metadata.json"),
    JSON.stringify({
      id: `${user}/video-render-${id}`,
      title: `video render ${id}`,
      code_file: "render.py",
      language: "python",
      kernel_type: "script",
      is_private: true,
      enable_gpu: true,
      enable_internet: true,
      dataset_sources: [`${user}/video-job-${id}`],
    })
  );

  const ds = await kaggle(["datasets", "create", "-p", dsDir, "--dir-mode", "zip"]);
  // dataset processing takes a few seconds before a kernel can mount it
  await new Promise((r) => setTimeout(r, 20000));
  const push = await kaggle(["kernels", "push", "-p", kDir]);

  return JSON.stringify(
    {
      jobId: id,
      kernel: `${user}/video-render-${id}`,
      title: script.title,
      scenes: script.scenes.length,
      dataset: ds.slice(0, 200),
      push: push.slice(0, 300),
      next: "Use manage_kaggle action=status ref=<kernel> to observe; action=output to download video.mp4",
    },
    null,
    2
  );
}

/**
 * Reruns an existing video job on Kaggle with the latest patched renderer.
 */
export async function rerunVideoJob(jobId: string): Promise<string> {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
  if (!user) return "Error: KAGGLE_USERNAME not set.";

  const cleanId = jobId.replace(/^video-render-/, "").replace(/^shunyapulse\//, "");
  const jobDir = path.join(JOBS_DIR, cleanId);
  const kDir = path.join(jobDir, "kernel");
  const dsDir = path.join(jobDir, "dataset");
  await fs.mkdir(kDir, { recursive: true });

  // Ensure pre-packaged audio exists in dataset; auto-synthesize if missing
  try {
    const scriptFile = path.join(dsDir, "script.json");
    const scriptExists = await fs.stat(scriptFile).then(() => true).catch(() => false);
    if (scriptExists) {
      const scriptRaw = await fs.readFile(scriptFile, "utf-8");
      const script = JSON.parse(scriptRaw) as VideoScript;
      const audioDir = path.join(dsDir, "audio");
      await fs.mkdir(audioDir, { recursive: true });

      const gcpAvailable = isGoogleCloudTTSAvailable();
      const gcpVoice = gcpAvailable ? resolveGCPVoice(script.voice, script.language) : null;
      const edgeVoice = resolveEdgeVoice(script.voice, script.language);

      let anySynthesized = false;
      for (let i = 0; i < script.scenes.length; i++) {
        const outMp3 = path.join(audioDir, `a${String(i).padStart(3, "0")}.mp3`);
        const stat = await fs.stat(outMp3).catch(() => null);
        if (!stat || stat.size < 500) {
          const sc = script.scenes[i];
          if (!sc) continue;
          let ok = false;
          if (gcpAvailable && gcpVoice) {
            ok = await synthesizeGoogleCloudTTS(sc.narration, outMp3, {
              voiceName: gcpVoice.name,
              language: script.language,
            });
          }
          if (!ok) {
            ok = await synthesizeLocalEdgeTTS(sc.narration, outMp3, edgeVoice.name, edgeVoice.pitch);
          }
          if (ok) anySynthesized = true;
        }
      }
      if (anySynthesized) {
        await kaggle(["datasets", "version", "-p", dsDir, "-m", "Auto-heal audio sync", "--dir-mode", "zip"]);
      }
    }
  } catch (syncErr: any) {
    console.warn(`[Video] Audio sync warning in rerunVideoJob: ${syncErr.message}`);
  }

  // Copy latest patched render.py into the job kernel directory
  await fs.copyFile(RENDER_SRC, path.join(kDir, "render.py"));

  // Ensure kernel-metadata.json is present and correctly mounts the dataset
  await fs.writeFile(
    path.join(kDir, "kernel-metadata.json"),
    JSON.stringify(
      {
        id: `${user}/video-render-${cleanId}`,
        title: `video render ${cleanId}`,
        code_file: "render.py",
        language: "python",
        kernel_type: "script",
        is_private: true,
        enable_gpu: true,
        enable_internet: true,
        dataset_sources: [`${user}/video-job-${cleanId}`],
      },
      null,
      2
    )
  );

  console.log("[Video] Pushing updated kernel to Kaggle...");
  const pushRes = await kaggle(["kernels", "push", "-p", kDir]);
  console.log("[Video] Kernel push completed.");

  const statusRes = await kaggle(["kernels", "status", `${user}/video-render-${cleanId}`]);

  return JSON.stringify(
    {
      jobId: cleanId,
      kernel: `${user}/video-render-${cleanId}`,
      push: pushRes,
      status: statusRes,
    },
    null,
    2
  );
}

/**
 * Observe Kaggle training / rendering kernels.
 */
export async function manageKaggle(action: "list" | "status" | "output" | "rerun", ref?: string): Promise<string> {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
  if (action === "list") return await kaggle(["kernels", "list", "--mine", "--page-size", "15"]);
  if (!ref) return "Error: 'ref' (owner/kernel-slug) is required for status/output/rerun.";
  const full = ref.includes("/") ? ref : `${user}/${ref}`;
  if (action === "status") return await kaggle(["kernels", "status", full]);
  if (action === "rerun") return await rerunVideoJob(ref);

  // output: download files + execution log
  const slug = full.split("/")[1] ?? full;
  const dest = path.join(JOBS_DIR, slug.replace(/^video-render-/, ""), "output");
  await fs.mkdir(dest, { recursive: true });
  const out = await kaggle(["kernels", "output", full, "-p", dest], 600000);
  const files = await fs.readdir(dest).catch(() => [] as string[]);
  let logTail = "";
  const logFile = files.find((f) => f.endsWith(".log"));
  if (logFile) {
    const raw = await fs.readFile(path.join(dest, logFile), "utf-8");
    logTail = raw.slice(-1500);
  }
  return `${out}\nFiles in ${dest}: ${files.join(", ") || "(none yet)"}\n--- log tail ---\n${logTail}`;
}

import { uploadToYouTube } from "./youtube.js";
import * as fsSync from "node:fs";

/**
 * Automatically publishes a rendered video job to YouTube with private visibility.
 */
export async function publishJobToYouTube(jobDirOrId: string, privacy: "private" | "unlisted" | "public" = "private"): Promise<string> {
  const isDirect = path.isAbsolute(jobDirOrId) || jobDirOrId.includes("/") || jobDirOrId.includes("\\");
  const targetDir = isDirect
    ? path.resolve(process.cwd(), jobDirOrId)
    : path.join(JOBS_DIR, jobDirOrId, "output");

  const videoPath = path.join(targetDir, "video.mp4");
  const metaPath = path.join(targetDir, "meta.json");
  let thumbnailPath = ["thumbnail.jpg", "thumbnail.png", "frame_30s.jpg", "frame_15s.jpg", "frame_03s.jpg", "frame_45s.jpg"]
    .map((f) => path.join(targetDir, f))
    .find((f) => fsSync.existsSync(f));

  // Fail-safe: If no thumbnail exists locally, generate one from video.mp4 via Python cv2/PIL
  if (!thumbnailPath && fsSync.existsSync(videoPath)) {
    try {
      const genScript = `
import cv2, os
from PIL import Image, ImageDraw, ImageFont
cap = cv2.VideoCapture(r'${videoPath.replace(/\\/g, "/")}')
fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
cap.set(cv2.CAP_PROP_POS_FRAMES, int(fps * 15))
ret, frame = cap.read()
cap.release()
if ret:
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).resize((1280, 720), Image.Resampling.LANCZOS)
    overlay = Image.new('RGBA', (1280, 720), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for y in range(480, 720):
        odraw.line([(0, y), (1280, y)], fill=(0, 0, 0, int((y - 480) / 240 * 185)))
    img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
    out_p = r'${path.join(targetDir, "thumbnail.jpg").replace(/\\/g, "/")}'
    img.save(out_p, quality=95)
    print('Generated fallback thumbnail:', out_p)
`;
      const { execFileSync } = await import("node:child_process");
      execFileSync("python", ["-c", genScript]);
      const genPath = path.join(targetDir, "thumbnail.jpg");
      if (fsSync.existsSync(genPath)) {
        thumbnailPath = genPath;
      }
    } catch (e: any) {
      console.warn(`[Video] Fallback thumbnail generation warning: ${e.message}`);
    }
  }

  const result = await uploadToYouTube({
    videoPath,
    metaPath,
    thumbnailPath,
    privacyStatus: privacy,
  });

  return JSON.stringify(result, null, 2);
}
