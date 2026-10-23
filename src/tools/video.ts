import * as path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

/**
 * Video production pipeline barrel.
 *
 * Implementation lives in `./video/`:
 * - `types`       — script, visual-bible and domain types
 * - `kaggle`      — Kaggle CLI wrapper
 * - `gemini`      — Gemini key pool, quality degradation, Groq/OpenRouter fallbacks
 * - `domain`      — topic domain detection and domain-specific prompt directives
 * - `visualBible` — bespoke visual/acoustic bible synthesis and fallback
 * - `script`      — script generation and parsing
 * - `tts`         — Edge-TTS voices, narration sanitization and local synthesis
 * - `narration`   — tiered per-scene narration synthesis and repair
 * - `job`         — job packaging, Kaggle dispatch, reruns and output download
 * - `publish`     — YouTube upload with thumbnail fallback
 */
export type { KaggleAction, VideoDomain, VideoPrivacy, VideoScript, VisualBible } from "./video/types.js";
export { kaggle } from "./video/kaggle.js";
export { GEMINI_MODELS_QUALITY_ORDER, geminiGenerate } from "./video/gemini.js";
export { detectVideoDomain, getDomainPromptDirectives } from "./video/domain.js";
export { getFallbackVisualBible, synthesizeTopicVisualBible } from "./video/visualBible.js";
export { generateScript } from "./video/script.js";
export { resolveEdgeVoice, sanitizeNarrationForTTS, synthesizeLocalEdgeTTS } from "./video/tts.js";
export { startVideoJob, rerunVideoJob, manageKaggle } from "./video/job.js";
export { publishJobToYouTube } from "./video/publish.js";
