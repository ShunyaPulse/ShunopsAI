import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { geminiGenerate, kaggle } from "../../tools/video.js";

export interface ChapterResearch {
  title: string;
  author: string;
  book: string;
  board: string;
  targetClass: string;
  characters: Array<{ name: string; role: string; traits?: string }>;
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
  scenes: ChapterScene[];
}

export interface PipelineOptions {
  board?: string | undefined;
  grade?: string | undefined;
  book?: string | undefined;
  language?: string | undefined;
  scenesCount?: number | undefined;
  dryRun?: boolean | undefined;
}

const EXPERIMENT_RENDER_SRC = path.resolve(process.cwd(), "src", "experiments", "ncert", "render-ncert.py");
const JOBS_DIR = path.resolve(process.cwd(), "jobs");

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
 * - Hindi Narrator ("hi-IN-MadhurNeural")
 * - English Character Voices ("en-IN-PrabhatNeural" / "en-US-AndrewNeural") for verbatim quotes
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

  const prompt = `You are a master educational filmmaker producing an authentic, cinematic educational adaptation of:
"${research.title}" by ${research.author}
Curriculum: ${research.board} ${research.targetClass} (Textbook: ${research.book})

FACTUAL RESEARCH DATA (STRICT GROUNDING):
${JSON.stringify(research, null, 2)}

STRICT FILMMAKING DIRECTIVES:
1. ZERO HALLUCINATION / ZERO MODERN FICTION:
   - Ground every scene in the factual research data. Do NOT add modern gadgets, altered plots, or fictitious characters.
2. DUAL-VOICE ARCHITECTURE:
   - Default Narrator voice: "hi-IN-MadhurNeural" (speaks dramatic, captivating, crystal-clear Hindi narration explaining the scene and psychological depth).
   - Character dialogue scenes (speaking iconic textbook lines):
     * Set "speaker" to the character's name (e.g. "${research.characters[0]?.name || "Protagonist"}")
     * Set "voice" to "en-IN-PrabhatNeural" or "en-US-AndrewNeural"
     * In "narration", write the verbatim English line from the textbook!
   - Exam Booster scenes (final 2-3 scenes):
     * Set "speaker" to "Exam Booster"
     * Summarize high-yield board exam takeaways and questions.
3. SUBTITLES ("caption"):
   - Every single scene MUST have "caption" written in 100% pure, clean ENGLISH words.
4. SCENE VISUAL PROMPTS:
   - Detailed, 8k photographic descriptions for Wan 2.1 video generation.
   - Describe period clothing, authentic lighting, camera distance (close-up, medium shot, wide shot), and subtle facial expressions.
5. LENGTH:
   - Generate approximately ${targetScenes} scenes total (runtime 3.5 to 4.5 minutes).
6. YOUTUBE METADATA:
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
  "voice": "hi-IN-MadhurNeural",
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
  script.voice = script.voice || "hi-IN-MadhurNeural";
  script.rate = script.rate || "+10%";

  // Safety sanitation for scene voices
  for (const sc of script.scenes) {
    if (!sc.voice) {
      sc.voice = sc.speaker && sc.speaker !== "Narrator" ? "en-IN-PrabhatNeural" : script.voice;
    }
  }

  console.log(`✅ [Script Ready] Generated "${script.title}" with ${script.scenes.length} scenes via ${res.modelUsed}.`);
  return script;
}

/**
 * Phase 3: Launch Chapter Video Job to Kaggle GPU
 * Dispatches the script and Wan2.1 rendering pipeline to a remote Kaggle GPU runner.
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
      groq_api_key: process.env.GROQ_API_KEY || "",
      hf_token: process.env.HF_TOKEN || "",
    }, null, 2)
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

  console.log(`\n🚀 [Kaggle Dispatch] Uploading dataset & kernel for "${script.title}"...`);
  await kaggle(["datasets", "create", "-p", dsDir]);
  await kaggle(["kernels", "push", "-p", kDir]);

  const kaggleUrl = `https://www.kaggle.com/code/${user}/video-render-${id}`;
  console.log(`\n✅ [Dispatched Successfully!]`);
  console.log(`   Job ID: ${id}`);
  console.log(`   Title: ${script.title}`);
  console.log(`   Scenes: ${script.scenes.length}`);
  console.log(`   Tracker URL: ${kaggleUrl}\n`);

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
    console.error("❌ Pipeline failed:", err?.message || err);
    process.exit(1);
  });
}
