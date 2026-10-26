import "dotenv/config";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
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
import { synthesizeGeminiTTS } from "../../tools/gemini-tts.js";
import { generateSceneKeyframes } from "../../tools/video/keyframes.js";
import { searchAndDownloadSFX } from "../../tools/video/dynamicSound.js";

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

export interface SoundscapeProfileResearch {
  bgmGenre: string;
  mood: string;
  keySFXMoments?: Array<{ sceneHint: string; sfx: string }>;
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
  unifiedArtStyle?: string;
  latentTrapsToBan?: string[];
  soundscapeProfile?: SoundscapeProfileResearch;
  factualPlotPoints: string[];
  verbatimQuotes: string[];
  themesAndIrony: string[];
  examFlashcards: Array<{ question: string; answer: string; boardTip?: string }>;
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

8. UNIFIED GLOBAL ART STYLE (ZERO ART-STYLE DRIFT):
   - Formulate a single, explicit visual medium descriptor to maintain the cinematic 3D aesthetic consistently across all shots:
     e.g., "Cinematic 3D render, volumetric dramatic lighting, photorealistic textures, 8k resolution, cinematic atmosphere. STRICTLY BANNED: 2D cartoon, anime, flat vector art, comic book, pencil sketch, line drawing, 2D animation."
9. STRICT LATENT TRAPS TO BAN (NO STRANGE VISUAL LOGIC):
   - Identify latent traps prone to diffusion artifacts for this story:
     e.g., "Floating cartoon hearts, emoji icons on faces/clothing, disembodied severed heads/limbs, heads emerging from objects or chains, surreal dreamlike art collages, grotesque uncanny anatomy, bizarre metaphysical distortions."
10. SOUNDSCAPE & BGM PROFILE (ATMOSPHERIC ACOUSTIC DEPTH):
   - "bgmGenre": "inspirational_cello" (for solemn, dignified, inspiring historical/patriotic drama) | "dramatic_strings" | "ambient_piano" | "epic_orchestral"
   - "mood": e.g. "Solemn, deeply inspiring, dignified acoustic cello and warm strings"
   - "keySFXMoments": Key acoustic moments (e.g. military jet flypast rumble, distant anthem chorus)
11. EXAM BOOSTER (100% INDIAN ENGLISH Q&A FORMAT):
   - Provide 3-4 high-yield Board Exam Question & Answer pairs formulated in pristine, academic Indian English curriculum style:
     * Question: e.g. "What does Mandela mean by 'an extraordinary human disaster'?"
     * Answer: e.g. "It refers to the brutal policy of racial Apartheid where people were stripped of their basic human rights and dignity."

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
  "unifiedArtStyle": string,
  "latentTrapsToBan": [string],
  "soundscapeProfile": {
    "bgmGenre": string,
    "mood": string,
    "keySFXMoments": [{ "sceneHint": string, "sfx": string }]
  },
  "factualPlotPoints": [string],
  "verbatimQuotes": [string],
  "themesAndIrony": [string],
  "examFlashcards": [
    { "question": string, "answer": string, "boardTip": string }
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
      * Set "voice" to an Indian English voice: "en-IN-PrabhatNeural" (or "en-IN-NeerjaExpressiveNeural")
      * In "narration", write the Board Exam Question & Answer in crystal-clear, academic Indian English curriculum format:
        "Question: [CBSE/ICSE Board Question]? Answer: [Precise Model Answer]."
      * In "caption", summarize the Question and Answer in clean English words.
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

9. UNIFIED GLOBAL ART STYLE (ZERO ART-STYLE DRIFT):
    - MANDATORY: Every single "visual_prompt" MUST start with this exact art style descriptor:
      "${research.unifiedArtStyle || 'Cinematic 35mm film photograph, highly detailed photorealistic live-action, 8k resolution, authentic natural directional lighting, rich tactile textures, film grain, hyper-realistic cinematography. STRICTLY BANNED: 2D cartoon, anime, illustration, pencil sketch, flat vector art, CGI render, 3D claymation.'}"

10. STRICT LATENT TRAPS BAN (NO STRANGE VISUAL LOGIC):
    - STRICTLY BANNED: ${research.latentTrapsToBan?.join(", ") || 'Floating cartoon hearts, emojis on faces/clothes, disembodied severed heads/limbs, heads emerging from objects or chains, surreal dreamlike art collages, grotesque uncanny anatomy.'}
    - All scenes must be physically grounded, realistic live-action setups.

11. LENGTH:
    - Generate approximately ${targetScenes} scenes total (runtime 3.5 to 4.5 minutes).

12. YOUTUBE METADATA:
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

  // Autonomous Pipeline Invariant Enforcement (Zero Art Style Drift, 100% Actor Lock, Indian English Q&A)
  const globalArtPrefix = research.unifiedArtStyle || "Cinematic 3D aesthetic, volumetric dramatic lighting, photorealistic textures, 8k resolution, cinematic depth.";
  const anti2dGuards = ["2D cartoon", "anime", "flat vector art", "comic book illustration", "pencil sketch", "line drawing", "2D animation"];
  const latentTrapsBanned = Array.from(new Set([...anti2dGuards, ...(research.latentTrapsToBan || [])])).join(", ");

  for (let i = 0; i < script.scenes.length; i++) {
    const sc = script.scenes[i]!;

    // A. Enforce Exam Booster in Indian English Q&A format
    const isExamScene = sc.speaker === "Exam Booster" || i >= script.scenes.length - 3 || /exam tip|board exam|exam booster/i.test(sc.narration);
    if (isExamScene && i >= script.scenes.length - 4) {
      sc.speaker = "Exam Booster";
      sc.voice = "en-IN-PrabhatNeural";
      (sc as any).language = "English";
      if (!sc.narration.startsWith("Question:") && !sc.narration.startsWith("Q:")) {
        const matchingCard = research.examFlashcards?.[script.scenes.length - 1 - i] || research.examFlashcards?.[0];
        if (matchingCard && (!sc.narration.includes("?") || sc.narration.includes("परीक्षा"))) {
          sc.narration = `Question: ${matchingCard.question} Answer: ${matchingCard.answer}`;
          sc.caption = `Q: ${matchingCard.question} | A: ${matchingCard.answer}`;
        } else {
          sc.narration = `Question: ${sc.caption || "Key Board Exam Concept"}? Answer: ${sc.narration}`;
        }
      }
    }

    // B. Enforce 100% Actor DNA lock if character appears
    if (research.characterVisualBible?.length) {
      for (const char of research.characterVisualBible) {
        const charNameRegex = new RegExp(`\\b${char.name}\\b`, "i");
        const isSpeaker = sc.speaker && charNameRegex.test(sc.speaker);
        const inPrompt = charNameRegex.test(sc.visual_prompt);
        if (isSpeaker || inPrompt) {
          const dnaCore = char.actorDnaPrompt.slice(0, 35);
          if (!sc.visual_prompt.includes(dnaCore)) {
            sc.visual_prompt = `${char.actorDnaPrompt}. ${sc.visual_prompt}`;
          }
        }
      }
    }

    // C. Enforce Unified Art Style Prefix (Zero Art-Style Drift, Cinematic 3D aesthetic)
    const promptLower = sc.visual_prompt.toLowerCase();
    if (!promptLower.includes("cinematic") && !promptLower.includes("3d")) {
      sc.visual_prompt = `${globalArtPrefix} ${sc.visual_prompt}`;
    }

    // D. Append Negative Latent Trap Guard to Visual Prompt
    if (!sc.visual_prompt.toLowerCase().includes("strictly banned")) {
      sc.visual_prompt += ` (STRICTLY BANNED: ${latentTrapsBanned})`;
    }

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
/**
 * 100% Cloud-Streamed BGM Catalog (Zero Laptop Storage)
 * Streams authentic public domain master tracks on-demand during cloud execution.
 * Zero audio files stored in the repository or on the local laptop.
 */
const BGM_CLOUD_CATALOG: Record<string, { title: string; url: string }> = {
  inspirational_cello: {
    title: "Bach Cello Suite - John Michel",
    url: "https://upload.wikimedia.org/wikipedia/commons/e/ec/John_Michel_-_Cello_Suite_No._1_in_G_Major_-_1._Pr%C3%A9lude.ogg",
  },
  ambient_piano: {
    title: "Satie Gymnopedie No 1",
    url: "https://upload.wikimedia.org/wikipedia/commons/2/29/Debussy_Gymnopedie_1%2C_arrangement_of_Satie%E2%80%99s_Gymnopedie_3.wav",
  },
  dramatic_strings: {
    title: "Beethoven Symphony 5",
    url: "https://upload.wikimedia.org/wikipedia/commons/5/52/Ludwig_van_Beethoven_-_Symphonie_5_c-moll_-_1._Allegro_con_brio.ogg",
  },
  gentle_acoustic: {
    title: "Tarrega Recuerdos de la Alhambra",
    url: "https://upload.wikimedia.org/wikipedia/commons/0/05/Recuerdos_de_la_Alhambra.ogg",
  },
  epic_orchestral: {
    title: "Dvorak New World Symphony",
    url: "https://upload.wikimedia.org/wikipedia/commons/5/57/Antonin_Dvorak_-_symphony_no._9_in_e_minor_%27from_the_new_world%27%2C_op._95_-_iv._allegro_con_fuoco.ogg",
  },
  melancholy_violin: {
    title: "Massenet Meditation Thais",
    url: "https://upload.wikimedia.org/wikipedia/commons/3/3d/Meditation_from_Thais_-_Bomsori_Kim.opus",
  },
  mysterious_ambient: {
    title: "Debussy Clair de Lune",
    url: "https://upload.wikimedia.org/wikipedia/commons/e/e2/Moonlight_-_Clair_de_Lune_%28As_the_rememberance_of_Sir_Debussy.ogg",
  },
  triumphant_brass: {
    title: "Holst Planets Jupiter",
    url: "https://upload.wikimedia.org/wikipedia/commons/5/57/Gustav_Holst_-_the_planets%2C_op._32_-_iv._jupiter%2C_the_bringer_of_jollity.ogg",
  },
  uplifting_documentary: {
    title: "Vivaldi Spring",
    url: "https://upload.wikimedia.org/wikipedia/commons/3/3c/Vivaldi_-_Four_Seasons_1_Spring_mvt_1_Allegro_-_John_Harrison_violin.oga",
  },
  warm_serenade: {
    title: "Mozart Romanze",
    url: "https://upload.wikimedia.org/wikipedia/commons/1/14/Mozart_-_Serenade_No._13_for_strings_in_G_major%2C_K._525_-_Romanze.ogg",
  },
};

async function resolveAndDownloadCloudBgm(bgmGenre: string | undefined, outAudioDir: string): Promise<boolean> {
  const norm = (bgmGenre || "inspirational_cello").toLowerCase().replace(/[^a-z0-9]/g, "_");
  const key = Object.keys(BGM_CLOUD_CATALOG).find(k => k === norm || norm.includes(k) || k.includes(norm)) || "inspirational_cello";
  const track = BGM_CLOUD_CATALOG[key] || BGM_CLOUD_CATALOG["inspirational_cello"]!;
  const targetBgm = path.join(outAudioDir, "bgm.ogg");

  try {
    const res = await fetch(track.url, {
      headers: { "User-Agent": "ShunopsAI/1.0 (https://github.com/ShunyaPulse/ShunopsAI; shunyapulse42@gmail.com)" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 5000) {
        await fs.writeFile(targetBgm, buf);
        console.log(`🎵 [Cloud BGM Streamed] Downloaded "${track.title}" (${(buf.length / 1024 / 1024).toFixed(2)} MB) directly into dataset.`);
        return true;
      }
    }
  } catch (err: any) {
    console.warn(`[Cloud BGM] Failed to stream ${track.title}:`, err?.message || err);
  }
  return false;
}

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

  let geminiCount = 0;
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

    // Tier 1: Gemini 3.8/3.1 Flash TTS (8B Multimodal Foundation LLM across 34-key pool)
    try {
      const speakerLower = (sc.speaker || "").toLowerCase();
      const voiceLower = (sc.voice || "").toLowerCase();
      const isFemale = /female|woman|girl|wife|mother|sister|af_|bf_|swara|neerja/.test(`${speakerLower} ${voiceLower}`);
      const isDeepMale = /postmaster|elder|leader|king|george|father/.test(`${speakerLower} ${voiceLower}`);
      const isYouth = /lencho|boy|student|son|kid/.test(`${speakerLower} ${voiceLower}`);
      const geminiVoice = isFemale ? "Aoede" : (isDeepMale ? "Charon" : (isYouth ? "Puck" : "Fenrir"));

      audioReady = await synthesizeGeminiTTS(
        sc.narration,
        outAudio,
        (sc as any).tone || "neutral",
        geminiVoice,
        "history"
      );
      if (audioReady) {
        geminiCount++;
      }
    } catch {}

    if (!audioReady && isHindi) {
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
            console.warn(`   ⚠️ Scene ${i + 1} GCP TTS attempt ${attempt}/2 failed: [REDACTED]`);
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
    } else if (!audioReady) {
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
    } else if (!audioReady) {
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
    `   🛡️ [Pre-Flight Verification] All ${script.scenes.length} audio files 100% verified (Gemini=${geminiCount}, GCP=${gcpCount}, Kokoro=${kokoroCount}, Edge-TTS=${edgeCount}).`
  );

  (script as any).audio_summary = `${geminiCount}/${script.scenes.length} via Gemini-3.8-Flash-TTS` +
    (gcpCount ? `, ${gcpCount} GCP` : "") +
    (kokoroCount ? `, ${kokoroCount} Kokoro` : "") +
    (edgeCount ? `, ${edgeCount} Edge-TTS` : "");
  if (geminiCount === script.scenes.length) {
    (script as any).voice = "gemini-3.8-flash-tts";
  }

  // Stage 0.5: Dynamically stream domain BGM from cloud catalog (Zero Laptop Storage)
  const requestedGenre = (script as any).soundscape_profile?.bgmGenre || (script as any).soundscapeProfile?.bgmGenre;
  await resolveAndDownloadCloudBgm(requestedGenre, audioDir);

  // Stage 0.6: Dynamically search and package on-demand acoustic SFX moments (Scales to millions of topics)
  const sfxMoments: Array<{ sceneHint?: string; sfx?: string; sfxQuery?: string }> =
    (script as any).soundscape_profile?.keySFXMoments ||
    (script as any).soundscapeProfile?.keySFXMoments ||
    [];
  if (Array.isArray(sfxMoments) && sfxMoments.length > 0) {
    for (const moment of sfxMoments) {
      const q = moment.sfx || moment.sfxQuery;
      if (q) {
        await searchAndDownloadSFX(q, audioDir);
      }
    }
  }

  // Stage 1 (Tarika 2): Pre-package keyframes via Cloudflare Workers AI FLUX.1-schnell
  const imagesDir = path.join(dsDir, "images");
  await fs.mkdir(imagesDir, { recursive: true });
  const keyframes = await generateSceneKeyframes(script as any, imagesDir);
  (script as any).keyframes_summary = `${keyframes.successCount}/${keyframes.totalScenes} via ${keyframes.modelUsed}`;
  console.log(`🎨 [Keyframe Pre-Packaging] Complete: ${(script as any).keyframes_summary}`);

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
      hf_token: process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || (process.env.KAGGLE_BUNDLE_HF_TOKEN === "true" ? (process.env.HF_TOKEN || "") : ""),
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
    console.error("❌ Pipeline failed: [REDACTED]");
    process.exit(1);
  });
}
