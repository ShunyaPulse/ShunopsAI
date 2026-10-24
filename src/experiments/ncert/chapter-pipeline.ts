import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  geminiGenerate,
  kaggle,
  resolveEdgeVoice,
  synthesizeLocalEdgeTTS,
} from "../../tools/video.js";
import {
  isGoogleCloudTTSAvailable,
  synthesizeGoogleCloudTTS,
  resolveGCPVoice,
} from "../../tools/gcp-tts.js";
import {
  isKokoroAvailable,
  synthesizeKokoroTTS,
  resolveKokoroVoice,
} from "../../tools/kokoro-tts.js";

export interface CharacterVisualDNA {
  name: string;
  role: string;
  actorDnaPrompt: string;
}

export interface PeriodSettingResearch {
  era: string;
  location: string;
  visualDetails?: string[];
  bannedModernElements?: string[];
}

export interface ToneCalibrationResearch {
  genre: string;
  allowedEmotions?: string[];
  strictlyBannedDepictions?: string[];
}

export interface ChapterResearch {
  title: string;
  author: string;
  book: string;
  board: string;
  targetClass: string;
  characters: Array<{ name: string; role: string; traits?: string }>;
  characterVisualBible?: CharacterVisualDNA[];
  periodAndSetting?: PeriodSettingResearch;
  toneCalibration?: ToneCalibrationResearch;
  factualPlotPoints: string[];
  verbatimQuotes: string[];
  themesAndIrony: string[];
  examFlashcards: Array<{ question: string; answer: string }>;
}

export interface ChapterScene {
  speaker?: string;
  voice?: string;
  narration: string;
  caption: string;
  visual_prompt: string;
}

export interface ChapterScript {
  title: string;
  description: string;
  tags: string[];
  chapters: Array<{ title: string; start_scene: number }>;
  thumbnail: {
    headline: string;
    subheadline: string;
    visual_prompt: string;
  };
  language: string;
  voice: string;
  rate?: string;
  domain?: string;
  scenes: ChapterScene[];
}

export interface PipelineOptions {
  board?: string | undefined;
  grade?: string | undefined;
  book?: string | undefined;
  language?: string | undefined;
  scenesCount?: number | undefined;
  dryRun?: boolean | undefined;
  gcpKey?: string | undefined;
}

const EXPERIMENT_RENDER_SRC = path.resolve(process.cwd(), "src", "experiments", "ncert", "render-ncert.py");
const JOBS_DIR = path.resolve(process.cwd(), "jobs");

/**
 * Converts a percentage rate string (e.g. "+10%", "-5%") to a numeric multiplier (e.g. 1.10, 0.95).
 */
function parseRateMultiplier(rateStr?: string): number {
  if (!rateStr) return 1.0;
  const m = rateStr.trim().match(/^([+-]?\d+(?:\.\d+)?)%$/);
  if (!m || !m[1]) return 1.0;
  const pct = parseFloat(m[1]);
  return Math.max(0.5, Math.min(2.0, Number((1 + pct / 100).toFixed(2))));
}

/**
 * Phase 1: AI Autonomous Research & Brainstorming
 * Queries Gemini Flash model pool to autonomously extract zero-hallucination textbook facts,
 * character nuances, verbatim quotes, and high-yield board exam questions.
 */
export async function researchChapter(
  chapterQuery: string,
  options: PipelineOptions = {}
): Promise<ChapterResearch> {
  console.log(`\n🧠 [AI Research & Brainstorming] Researching chapter: "${chapterQuery}"...`);

  const prompt = `You are a distinguished academic researcher and literature scholar specializing in secondary school curriculum (CBSE, ICSE, NCERT, State Boards).
Conduct comprehensive, rigorous, 100% factual research on the following literature chapter or story:
"${chapterQuery}"
${options.board ? `Board Preference: ${options.board}` : ""}
${options.grade ? `Target Grade/Class: ${options.grade}` : ""}
${options.book ? `Prescribed Textbook: ${options.book}` : ""}

CRITICAL INVARIANTS:
1. ZERO FICTION / ZERO HALLUCINATION:
   - Provide exact author, prescribed textbook name, and authentic board curriculum (e.g. ICSE Treasure Chest, CBSE First Flight, Flamingo, etc.).
   - Character names, roles, and demeanors must come directly from the authentic text.
2. VERBATIM QUOTES:
   - Extract at least 4-6 authentic, verbatim English dialogue lines and iconic quotations from the original prose/poem.
3. FACTUAL PLOT TIMELINE:
   - Extract 8-10 chronological factual events, specific settings, and turning points without modern inventions.
4. EXAM FLASHCARDS:
   - 3 high-yield board exam questions (Previous Years Questions / Board HOTS) with model answers.
5. AUTONOMOUS CHARACTER VISUAL BIBLE (100% ACTOR DNA LOCK):
   - For every major recurring character, establish an explicit, 100% Actor DNA descriptor that will remain locked across all shots:
     * Exact age, gender, ethnicity/regional heritage, facial structure, skin tone, hair color/style, facial hair, eyewear, signature period garments, fabrics, textures, and accessories.
     * Must be authentic to the author's story and period.
6. AUTHENTIC PERIOD & SETTING RESEARCH:
   - Identify the authentic historical era/decade, geographical location, and architectural environment of this story.
   - List key authentic visual materials, lighting, and period-accurate props.
   - List banned modern anachronisms that must NEVER appear (e.g. modern factories, airplane hangars, warehouses, modern vehicles, smartphones).
7. TONE & EMOTIONAL CALIBRATION:
   - Identify the story's genre (e.g. comedic satire, tragic realism, spiritual faith, lighthearted adventure, patriotic history).
   - Define appropriate emotional body language and facial expressions (e.g. gentlemanly awkwardness, rustic reverence, quiet grief).
   - List strictly banned depictions (e.g. zero horror/violence/choking in comedies, zero modern cynicism in earnest literature).

Respond strictly in valid JSON matching this schema:
{
  "title": string,
  "author": string,
  "book": string,
  "board": string,
  "targetClass": string,
  "characters": [
    { "name": string, "role": string, "traits": string }
  ],
  "characterVisualBible": [
    { "name": string, "role": string, "actorDnaPrompt": string }
  ],
  "periodAndSetting": {
    "era": string,
    "location": string,
    "visualDetails": [string],
    "bannedModernElements": [string]
  },
  "toneCalibration": {
    "genre": string,
    "allowedEmotions": [string],
    "strictlyBannedDepictions": [string]
  },
  "factualPlotPoints": [string],
  "verbatimQuotes": [string],
  "themesAndIrony": [string],
  "examFlashcards": [
    { "question": string, "answer": string }
  ]
}`;

  const res = await geminiGenerate(prompt);
  let clean = res.text.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  const research: ChapterResearch = JSON.parse(clean);
  console.log(`✅ [AI Research Done] Researched "${research.title}" by ${research.author} (${research.board} ${research.targetClass}) via ${res.modelUsed}.`);
  console.log(`   Characters: ${research.characters.map((c) => c.name).join(", ")}`);
  console.log(`   Verbatim Quotes Found: ${research.verbatimQuotes.length}`);
  return research;
}

/**
 * Phase 2: Dual-Voice Cinematic Script Generation
 * Converts the researched factual knowledge into a production-ready script with:
 * - Hindi Narrator ("hi-IN-Neural2-B" / "hi-IN-MadhurNeural")
 * - English Character Voices (Kokoro-82M "am_adam"/"bm_george"/"af_heart" -> GCP Neural2 -> Edge-TTS)
 * - Pure English Subtitle captions
 * - Photorealistic Wan2.1 DiT visual prompts
 * - YouTube SEO metadata
 */
export async function generateChapterScript(
  input: string | ChapterResearch,
  options: PipelineOptions = {}
): Promise<ChapterScript> {
  const research = typeof input === "string" ? await researchChapter(input, options) : input;
  const targetScenes = options.scenesCount || 18;

  console.log(`\n🎬 [Script Generation] Producing cinematic dual-voice script for "${research.title}" (~${targetScenes} scenes)...`);

  // Dynamically format character DNA bible from research
  const characterBibleText = research.characterVisualBible?.length
    ? research.characterVisualBible.map((c) => `     * ${c.name} (${c.role}): ${c.actorDnaPrompt}`).join("\n")
    : research.characters.map((c) => `     * ${c.name} (${c.role}): ${c.traits || "Authentic period character appearance"}`).join("\n");

  const settingText = research.periodAndSetting
    ? `- Era & Location: ${research.periodAndSetting.era}, ${research.periodAndSetting.location}\n` +
      `   - Authentic Architecture, Atmosphere & Props: ${research.periodAndSetting.visualDetails?.join(", ") || "Authentic period environment"}\n` +
      `   - STRICTLY FORBIDDEN: ${research.periodAndSetting.bannedModernElements?.join(", ") || "Modern anachronisms, industrial factories, warehouses, airplane hangars, modern vehicles, digital screens"}`
    : `- All scenes must strictly match the authentic historical era, location, and environment of the story.\n` +
      `   - STRICTLY FORBIDDEN: Modern industrial warehouses, airplane hangars, modern factories, or out-of-period anachronisms.`;

  const toneText = research.toneCalibration
    ? `- Genre & Story Atmosphere: ${research.toneCalibration.genre}\n` +
      `   - Appropriate Emotional Depictions: ${research.toneCalibration.allowedEmotions?.join(", ") || "Authentic to characters and narrative context"}\n` +
      `   - STRICTLY FORBIDDEN: ${research.toneCalibration.strictlyBannedDepictions?.join(", ") || "Grotesque horror, physical assault, choking, strangling, gruesome violence"}`
    : `- Visuals must strictly match the emotional tone and literary genre of the story.\n` +
      `   - STRICTLY FORBIDDEN: Grotesque horror, physical assault, choking, strangling, or unnatural aggression unless explicitly in the textbook.`;

  const prompt = `You are a master educational filmmaker producing an authentic, cinematic educational adaptation of:
"${research.title}" by ${research.author}
Curriculum: ${research.board} ${research.targetClass} (Textbook: ${research.book})

FACTUAL RESEARCH DATA (STRICT GROUNDING):
${JSON.stringify(research, null, 2)}

STRICT FILMMAKING DIRECTIVES:
1. ZERO HALLUCINATION / ZERO MODERN FICTION:
   - Ground every scene in the factual research data. Do NOT add modern gadgets, altered plots, or fictitious characters.
2. DUAL-VOICE ARCHITECTURE:
   - Default Narrator voice: "hi-IN-Neural2-B" (Google Cloud Studio voice: speaks dramatic, captivating, crystal-clear Hindi narration explaining the scene and psychological depth).
   - Character dialogue scenes (speaking iconic textbook lines):
     * Set "speaker" to the character's name (e.g. "${research.characters[0]?.name || "Narrator"}" or "${research.characters[1]?.name || "Character"}")
     * Set "voice" to a Kokoro-82M voice: "am_adam" (for natural sincere male voice), "bm_george" (for cold/intellectual male technician), or "af_heart" (for female characters)
     * In "narration", write the verbatim English line from the textbook!
   - Exam Booster scenes (final 2-3 scenes):
     * Set "speaker" to "Exam Booster"
     * Summarize high-yield board exam takeaways and questions.
3. SUBTITLES ("caption"):
   - Every single scene MUST have "caption" written in 100% pure, clean ENGLISH words.
4. CHARACTER VISUAL BIBLE & 100% ACTOR CONSISTENCY:
   - Establish and maintain a strict Character Visual DNA across every shot:
${characterBibleText}
   - MANDATORY: Whenever a character appears in a scene, their visual prompt MUST start with their exact DNA descriptor verbatim.
   - NEVER introduce random unscripted people, unexpected ethnicities, or unrelated extras unless explicitly in the textbook story. In focused scenes, the featured character remains the sole subject.

5. TONE & EMOTION CALIBRATION:
   ${toneText}

6. AUTHENTIC PERIOD SETTING:
   ${settingText}

7. ZERO-DIFFUSION TEXT RULE (NO GIBBERISH RUNES):
   - Diffusion models CANNOT spell words or render typography.
   - In all "visual_prompt" fields: STRICTLY ZERO text, ZERO bullet points, ZERO charts, ZERO written words.
   - For reading scenes: describe characters holding authentic period-appropriate books, letters, or newspapers with faint artistic illustrations, NO readable text.
   - For Exam Booster / summary scenes: describe cinematic symbolic study metaphors authentic to the story's world (e.g. vintage study desk, open leather-bound book, reading lamp, thematic props with warm atmospheric lighting, clean text-free composition).

8. ANTI-MORPHING & CAMERA RIGIDITY:
   - For all dialogue and close-up scenes, use: "Locked static tripod shot, eye-level framing, subtle natural breathing, still hands resting on lap, zero hand-to-face touching, crisp facial stability".
   - Avoid complex multi-hand interactions or close-up finger movements that cause AI morphing.

9. LENGTH:
   - Generate approximately ${targetScenes} scenes total (runtime 3.5 to 4.5 minutes).

10. YOUTUBE METADATA:
   - High-CTR click-worthy educational Title including Chapter name, Class, Board, and "Full Explanation in Hindi".
   - High-ranking SEO Tags, structured Description, and a high-contrast Thumbnail concept prompt.

Respond strictly in valid JSON matching this schema:
{
  "title": string,
  "description": string,
  "tags": [string],
  "chapters": [{ "title": string, "start_scene": number }],
  "thumbnail": {
    "headline": string,
    "subheadline": string,
    "visual_prompt": string
  },
  "language": "Hindi",
  "voice": "hi-IN-Neural2-B",
  "rate": "+10%",
  "scenes": [
    {
      "speaker": string,
      "voice": string,
      "narration": string,
      "caption": string,
      "visual_prompt": string
    }
  ]
}`;

  const res = await geminiGenerate(prompt);
  let clean = res.text.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  const script: ChapterScript = JSON.parse(clean);
  script.language = script.language || "Hindi";
  script.voice = script.voice || "hi-IN-Neural2-B";
  script.rate = script.rate || "+10%";

  // Safety sanitation for scene voices
  for (const sc of script.scenes) {
    if (!sc.voice) {
      sc.voice = sc.speaker && sc.speaker !== "Narrator" && sc.speaker !== "Exam Booster" ? "am_adam" : script.voice;
    }
  }

  console.log(`✅ [Script Ready] Generated "${script.title}" with ${script.scenes.length} scenes via ${res.modelUsed}.`);
  return script;
}

/**
 * Phase 3: Launch Chapter Video Job to Kaggle GPU
 * Dispatches the script and Wan2.1 rendering pipeline to a remote Kaggle GPU runner.
 * Uses the unified multi-tier audio fallback cascade (Kokoro-82M ➔ Google Cloud Neural2 ➔ Calibrated Edge-TTS).
 */
export async function launchChapterJob(
  input: string | ChapterScript,
  options: PipelineOptions = {}
): Promise<{ jobId: string; kernel: string; title: string; scenes: number; kaggleUrl?: string }> {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
  if (!user && !options.dryRun) {
    throw new Error("KAGGLE_USERNAME is not set in environment.");
  }

  let script: ChapterScript;
  if (typeof input === "string") {
    script = await generateChapterScript(input, options);
  } else {
    script = input;
  }

  const id = Date.now().toString(36);
  const jobDir = path.join(JOBS_DIR, id);
  const dsDir = path.join(jobDir, "dataset");
  const kDir = path.join(jobDir, "kernel");

  await fs.mkdir(dsDir, { recursive: true });
  await fs.mkdir(kDir, { recursive: true });

  // Pre-synthesize all scenes locally with the unified multi-tier cascade before dispatching to Kaggle
  const audioDir = path.join(dsDir, "audio");
  await fs.mkdir(audioDir, { recursive: true });

  const rateStr = script.rate || "+10%";
  const speakingRate = parseRateMultiplier(rateStr);
  const gcpAvailable = isGoogleCloudTTSAvailable(options.gcpKey);
  const kokoroReady = await isKokoroAvailable();

  console.log(
    `\n🎙️ [Audio Pre-Synthesis] Synthesizing ${script.scenes.length} scenes locally (rate=${rateStr}, speed=${speakingRate}x, GCP=${gcpAvailable ? "Ready" : "Off"}, Kokoro=${kokoroReady ? "Ready" : "Off"})...`
  );

  let gcpCount = 0;
  let kokoroCount = 0;
  let edgeCount = 0;

  for (let i = 0; i < script.scenes.length; i++) {
    const sc = script.scenes[i];
    if (!sc) continue;
    const outAudio = path.join(audioDir, `a${String(i).padStart(3, "0")}.mp3`);
    const isHindi =
      !sc.speaker ||
      sc.speaker === "Narrator" ||
      sc.speaker === "Exam Booster" ||
      (sc as any).language === "Hindi" ||
      /[\u0900-\u097F]/.test(sc.narration);

    let audioReady = false;

    if (isHindi) {
      const gcpVoice = resolveGCPVoice(sc.voice || script.voice, "Hindi");
      const edgeVoice = resolveEdgeVoice(sc.voice || script.voice, "Hindi", "history");

      // Tier 1 for Hindi: Google Cloud Neural2 with up to 2 attempts
      if (gcpAvailable) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            audioReady = await synthesizeGoogleCloudTTS(sc.narration, outAudio, {
              voiceName: gcpVoice.name,
              language: "Hindi",
              speakingRate,
              gcpKey: options.gcpKey,
            });
            if (audioReady) {
              gcpCount++;
              break;
            }
          } catch (err: any) {
            console.warn(`   ⚠️ Scene ${i + 1} GCP TTS attempt ${attempt}/2 failed: ${err.message}`);
          }
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Tier 2 for Hindi: Calibrated Local Edge-TTS with up to 3 attempts
      if (!audioReady) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          audioReady = await synthesizeLocalEdgeTTS(
            sc.narration,
            outAudio,
            edgeVoice.name,
            edgeVoice.pitch,
            rateStr
          );
          if (audioReady) {
            edgeCount++;
            break;
          }
          console.warn(`   ⚠️ Scene ${i + 1} Edge-TTS attempt ${attempt}/3 failed.`);
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
    } else {
      // English Character Dialogue Cascade: Tier 1 Kokoro-82M ➔ Tier 2 Google Cloud Neural2 ➔ Tier 3 Edge-TTS
      const speakerLower = (sc.speaker || "").toLowerCase();
      const voiceLower = (sc.voice || "").toLowerCase();
      const isPhotographerOrBrit = /photographer|british|george|bm_|bf_/.test(`${speakerLower} ${voiceLower}`);
      const isFemale = /female|woman|girl|wife|mother|sister|af_|bf_|swara|neerja/.test(`${speakerLower} ${voiceLower}`);

      const kokoroVoice = isPhotographerOrBrit
        ? (isFemale ? "bf_emma" : "bm_george")
        : resolveKokoroVoice(sc.voice || (isFemale ? "af_heart" : "am_adam"), "English");

      // Tier 1: Kokoro-82M
      if (kokoroReady) {
        try {
          audioReady = await synthesizeKokoroTTS(sc.narration, outAudio, {
            voice: kokoroVoice,
            language: "English",
            speed: speakingRate,
          });
          if (audioReady) kokoroCount++;
        } catch {}
      }

      // Tier 2: Google Cloud Neural2 English
      if (!audioReady && gcpAvailable) {
        const gcpEngVoice = isPhotographerOrBrit
          ? (isFemale ? "en-GB-Neural2-A" : "en-GB-Neural2-B")
          : (isFemale ? "en-US-Neural2-F" : "en-US-Neural2-J");
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            audioReady = await synthesizeGoogleCloudTTS(sc.narration, outAudio, {
              voiceName: gcpEngVoice,
              language: "English",
              speakingRate,
              gcpKey: options.gcpKey,
            });
            if (audioReady) {
              gcpCount++;
              break;
            }
          } catch {}
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Tier 3: Calibrated Edge-TTS English with up to 3 attempts
      if (!audioReady) {
        const engEdgeVoice = isPhotographerOrBrit
          ? "en-GB-RyanNeural"
          : isFemale
            ? "en-IN-NeerjaExpressiveNeural"
            : "en-US-GuyNeural";
        for (let attempt = 1; attempt <= 3; attempt++) {
          audioReady = await synthesizeLocalEdgeTTS(sc.narration, outAudio, engEdgeVoice, "+0Hz", rateStr);
          if (audioReady) {
            edgeCount++;
            break;
          }
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
    }

    if (audioReady) {
      console.log(`   ✅ Scene ${i + 1}/${script.scenes.length} synthesized (${isHindi ? "Hindi narration" : `English dialogue [${sc.speaker}]`})`);
    } else {
      console.warn(`   ⚠️ Warning: Scene ${i + 1} synthesis failed across all tiers.`);
    }
  }

  // Pre-Flight Verification Gate: Halt immediately if any audio is missing
  for (let i = 0; i < script.scenes.length; i++) {
    const expectedAudio = path.join(audioDir, `a${String(i).padStart(3, "0")}.mp3`);
    try {
      const stat = await fs.stat(expectedAudio);
      if (stat.size < 500) {
        throw new Error(`Scene ${i + 1} audio too small (${stat.size} bytes)`);
      }
    } catch {
      throw new Error(`[Pre-Flight Abort] Scene ${i + 1} audio missing in dataset/audio. Refusing to dispatch broken job to Kaggle GPU.`);
    }
  }
  console.log(
    `   🛡️ [Pre-Flight Verification] All ${script.scenes.length} audio files 100% verified (GCP=${gcpCount}, Kokoro=${kokoroCount}, Edge-TTS=${edgeCount}).`
  );

  await fs.writeFile(path.join(dsDir, "script.json"), JSON.stringify(script, null, 2));
  await fs.writeFile(
    path.join(dsDir, "dataset-metadata.json"),
    JSON.stringify({
      title: `chapter video job ${id}`,
      id: `${user}/video-job-${id}`,
      licenses: [{ name: "CC0-1.0" }],
      is_private: true,
    }, null, 2)
  );
  await fs.writeFile(
    path.join(dsDir, "config.json"),
    JSON.stringify({
      hf_token: process.env.KAGGLE_BUNDLE_HF_TOKEN === "true" ? (process.env.HF_TOKEN || "") : "",
      gcp_tts_api_key:
        process.env.KAGGLE_BUNDLE_GCP_KEY === "true"
          ? (options.gcpKey || process.env.GCP_TTS_API_KEY || process.env.GOOGLE_TTS_API_KEY || "")
          : "",
    }, null, 2),
    { mode: 0o600 }
  );

  // Copy Wan2.1 DiT + Edge-TTS GPU runner
  await fs.copyFile(EXPERIMENT_RENDER_SRC, path.join(kDir, "render.py"));
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
    }, null, 2)
  );

  if (options.dryRun) {
    console.log(`\n🔍 [Dry Run] Job files generated locally at: ${jobDir}`);
    console.log(`   Scenes: ${script.scenes.length}`);
    return {
      jobId: id,
      kernel: `${user}/video-render-${id}`,
      title: script.title,
      scenes: script.scenes.length,
    };
  }

  console.log(`\n🚀 [Kaggle Dispatch] Uploading dataset with all pre-packaged audio (--dir-mode zip) & kernel for "${script.title}"...`);
  await kaggle(["datasets", "create", "-p", dsDir, "--dir-mode", "zip"]);
  // Wait 20 seconds for Kaggle dataset mount propagation before pushing kernel
  await new Promise((r) => setTimeout(r, 20000));
  await kaggle(["kernels", "push", "-p", kDir]);

  const kaggleUrl = `https://www.kaggle.com/code/${user}/video-render-${id}`;
  console.log(`\n✅ [Dispatched Successfully!]`);
  console.log(`   Job ID: ${id}`);
  console.log(`   Title: ${script.title}`);
  console.log(`   Scenes: ${script.scenes.length}`);
  console.log(`   Tracker URL: [REDACTED]\n`);

  return {
    jobId: id,
    kernel: `${user}/video-render-${id}`,
    title: script.title,
    scenes: script.scenes.length,
    kaggleUrl,
  };
}

// ==========================================
// CLI Invocation Handler
// ==========================================
const isCLI =
  process.argv[1]?.endsWith("chapter-pipeline.ts") ||
  process.argv[1]?.endsWith("chapter-pipeline.js");

if (isCLI) {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log(`
📚 Universal Educational Chapter Video Pipeline
Usage:
  npx tsx src/experiments/ncert/chapter-pipeline.ts "<Chapter Name>" [options]

Examples:
  npx tsx src/experiments/ncert/chapter-pipeline.ts "With the Photographer" --board ICSE --class 10
  npx tsx src/experiments/ncert/chapter-pipeline.ts "A Letter to God" --board CBSE --class 10
  npx tsx src/experiments/ncert/chapter-pipeline.ts "The Last Lesson" --dry-run

Options:
  --board <name>    Board curriculum (e.g. ICSE, CBSE, NCERT)
  --class <grade>   Target grade/class (e.g. 10, 9, 12)
  --book <name>     Prescribed textbook name
  --scenes <num>    Target scene count (default: 18)
  --dry-run         Generate research & script locally without pushing to Kaggle
    `);
    process.exit(0);
  }

  const chapterArg = args.find((a) => !a.startsWith("-")) || "With the Photographer";
  const boardIdx = args.indexOf("--board");
  const classIdx = args.indexOf("--class");
  const bookIdx = args.indexOf("--book");
  const scenesIdx = args.indexOf("--scenes");
  const dryRun = args.includes("--dry-run");

  const scenesStr = scenesIdx !== -1 && scenesIdx + 1 < args.length ? args[scenesIdx + 1] : undefined;
  const options: PipelineOptions = {
    board: boardIdx !== -1 && boardIdx + 1 < args.length ? args[boardIdx + 1] : undefined,
    grade: classIdx !== -1 && classIdx + 1 < args.length ? args[classIdx + 1] : undefined,
    book: bookIdx !== -1 && bookIdx + 1 < args.length ? args[bookIdx + 1] : undefined,
    scenesCount: scenesStr ? parseInt(scenesStr, 10) : undefined,
    dryRun,
  };

  launchChapterJob(chapterArg, options).catch((err) => {
    console.error("❌ Pipeline failed: [REDACTED]", err?.message || "");
    process.exit(1);
  });
}
