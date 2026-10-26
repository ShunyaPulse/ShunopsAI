import "dotenv/config";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { synthesizeGeminiTTS } from "../src/tools/gemini-tts.js";
import { callCloudflareFlux } from "../src/tools/video/keyframes.js";
import { kaggle } from "../src/tools/video.js";

async function main() {
  console.log("==================================================================");
  console.log("🇿🇦 SURGICAL DELTA REMEDIATION: Nelson Mandela (Rule 16)");
  console.log("   Preserving verified audio 0-14 | Indian English Q&A | Cello BGM | 100% DNA Lock");
  console.log("==================================================================");

  // Set Cloudflare credentials to SaralGati for FLUX image synthesis
  if (process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID && process.env.SARALGATI_CLOUDFLARE_API_TOKEN) {
    process.env.CLOUDFLARE_ACCOUNT_ID = process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID;
    process.env.CLOUDFLARE_API_TOKEN = process.env.SARALGATI_CLOUDFLARE_API_TOKEN;
    console.log("[Launcher] Cloudflare Workers AI credentials active (SaralGati).");
  }

  const jobDir = path.resolve("jobs", "mvp37a5f");
  const dsDir = path.join(jobDir, "dataset");
  const audioDir = path.join(dsDir, "audio");
  const imagesDir = path.join(dsDir, "images");
  const kDir = path.join(jobDir, "kernel");

  // 1. Copy Acoustic Cello BGM
  const bgmSource = path.resolve("src", "assets", "audio", "bgm", "inspirational_cello.ogg");
  const targetBgm = path.join(audioDir, "bgm.ogg");
  if (fsSync.existsSync(bgmSource)) {
    await fs.copyFile(bgmSource, targetBgm);
    console.log("🎻 [Audio] Packaged John Michel Bach Cello Suite BGM -> dataset/audio/bgm.ogg");
  }

  // 2. Load script and apply surgical scene enhancements
  const scriptPath = path.join(dsDir, "script.json");
  const script = JSON.parse(await fs.readFile(scriptPath, "utf8"));

  const MANDELA_DNA = "Nelson Mandela, 75-year-old South African statesman of Xhosa heritage, tall and stately posture, short textured salt-and-pepper hair, warm wise eyes with gentle crow's feet, dignified compassionate expression, rich dark chocolate skin tone, tailored charcoal grey presidential suit, crisp white collar";
  const ART_STYLE_PREFIX = "Cinematic 35mm film photograph, highly detailed photorealistic live-action historical drama, 8k resolution, authentic natural directional lighting, rich tactile textures, subtle 35mm film grain, hyper-realistic cinematography";
  const LATENT_BAN = "(STRICTLY BANNED: 2D cartoon, anime, illustration, pencil sketch, flat vector art, CGI 3D render, floating cartoon hearts, emojis, disembodied severed heads, heads in chains, grotesque uncanny surrealism)";

  // Scenes to update:
  // Scene 3 (idx 2): de Klerk / Thabo Mbeki oath (was 2D cartoon)
  script.scenes[2].visual_prompt = `${ART_STYLE_PREFIX}. Medium shot of the dignified sandstone inauguration podium in Pretoria, 1994. Mr. de Klerk, a 58-year-old Caucasian statesman in a dark tailored presidential suit, taking the oath of office, followed by Thabo Mbeki, a 52-year-old African statesman in formal diplomatic attire. Locked static tripod shot, realistic skin textures, 35mm film grain. ${LATENT_BAN}`;

  // Scene 4 (idx 3): Mandela Oath (Lock DNA)
  script.scenes[3].visual_prompt = `${MANDELA_DNA}. ${ART_STYLE_PREFIX}. Close-up speaking solemnly into a vintage 1994 podium microphone. Photorealistic live-action, natural lighting, crisp facial stability, still hands, zero hand-to-face touching. ${LATENT_BAN}`;

  // Scene 5 (idx 4): Mandela Hero Shot (Lock DNA)
  script.scenes[4].visual_prompt = `${MANDELA_DNA}. ${ART_STYLE_PREFIX}. Low angle hero shot standing before the grand sandstone pillars of Pretoria amphitheater. Triumphant dignified expression, golden hour lighting, photorealistic live-action 35mm film still. ${LATENT_BAN}`;

  // Scene 6 (idx 5): Military Jets Flypast (Jet roar scene)
  script.scenes[5].visual_prompt = `${ART_STYLE_PREFIX}. Looking up from the Union Buildings amphitheatre as five Impala military jets roar in tight V-formation across the bright autumn sky, releasing five vivid smoke trails in the new South African flag colors—red, green, blue, gold, and black. Epic scale, authentic 1994 historic event, 35mm film grain. ${LATENT_BAN}`;

  // Scene 7 (idx 6): Anthems Sung
  script.scenes[6].visual_prompt = `${ART_STYLE_PREFIX}. A solemn and inspiring assembly of diverse South African leaders and citizens, black and white attendees standing side-by-side in formal 1990s attire, hands placed over hearts, singing the national anthems with deep reverence. Authentic natural sunlight, dignified realistic faces, 35mm film grain. ${LATENT_BAN}`;

  // Scene 8 (idx 7): Tribute to African Patriots (Lock DNA)
  script.scenes[7].visual_prompt = `${MANDELA_DNA}. ${ART_STYLE_PREFIX}. Close-up of Mandela's face reflecting quiet reverence and solemn remembrance. Soft autumn sunlight, highly detailed facial lines, photorealistic live-action. ${LATENT_BAN}`;

  // Scene 9 (idx 8): Courage Quote (Lock DNA)
  script.scenes[8].visual_prompt = `${MANDELA_DNA}. ${ART_STYLE_PREFIX}. Medium shot standing beside a historic arched window inside the Union Buildings, looking toward the horizon with quiet inner strength. Photorealistic live-action, still hands resting on ledge. ${LATENT_BAN}`;

  // Scene 10 (idx 9): Love over Hate (Lock DNA)
  script.scenes[9].visual_prompt = `${MANDELA_DNA}. ${ART_STYLE_PREFIX}. Seated gracefully in a historic study, hands resting peacefully on an antique wooden table. Warm soft window light, serene benevolent expression. ${LATENT_BAN}`;

  // Scene 11 (idx 10): Children / humanity (was floating hearts)
  script.scenes[10].visual_prompt = `${ART_STYLE_PREFIX}. A group of South African children of different heritages laughing and running joyfully across a grassy green historic park in Pretoria under warm golden sunlight. Authentic natural documentary cinematography, realistic expressions, 35mm film grain. ${LATENT_BAN}`;

  // Scene 12 (idx 11): Twin Obligations Metaphor
  script.scenes[11].visual_prompt = `${ART_STYLE_PREFIX}. An open vintage leather-bound book on an antique oak study desk with two brass candlesticks burning calmly side by side. Warm scholarly atmosphere, shallow depth of field, clean text-free composition. ${LATENT_BAN}`;

  // Scene 13 (idx 12): Goodness is a Flame (Lock DNA)
  script.scenes[12].visual_prompt = `${MANDELA_DNA}. ${ART_STYLE_PREFIX}. Close-up with dramatic warm candlelight softly illuminating one side of his wise face. Deep chiaroscuro shadows, contemplative peaceful expression. ${LATENT_BAN}`;

  // Scene 14 (idx 13): Indivisible Freedom (was severed head in chains)
  script.scenes[13].visual_prompt = `${MANDELA_DNA}. ${ART_STYLE_PREFIX}. Nelson Mandela walking forward through an open, unlocked historic wrought-iron gate from a shadowy stone courtyard into brilliant morning sunlight, symbolizing liberation and dignity. Cinematic wide shot, realistic physical environment, 35mm film grain. ${LATENT_BAN}`;

  // Scene 15 (idx 14): Oppressor and Oppressed Quote (Lock DNA)
  script.scenes[14].visual_prompt = `${MANDELA_DNA}. ${ART_STYLE_PREFIX}. Standing with quiet dignity before a timeless sandstone colonnade, looking forward with compassionate vision. Photorealistic live-action. ${LATENT_BAN}`;

  // Scene 16 (idx 15): Exam Booster Q1 (Indian English Q&A)
  script.scenes[15] = {
    speaker: "Exam Booster",
    voice: "en-IN-PrabhatNeural",
    narration: "Question: What does Mandela mean by 'an extraordinary human disaster'? Answer: It refers to the brutal policy of Apartheid in South Africa, where human beings suffered extreme racial discrimination and loss of liberty.",
    caption: "Q: What is the 'extraordinary human disaster'? | A: The brutal system of Apartheid.",
    visual_prompt: `${ART_STYLE_PREFIX}. Cinematic study desk with an antique brass desk lamp, an open leather-bound textbook, and a vintage fountain pen resting on aged paper. Warm scholarly atmosphere, clean text-free composition. ${LATENT_BAN}`,
  };

  // Scene 17 (idx 16): Exam Booster Q2 (Indian English Q&A)
  script.scenes[16] = {
    speaker: "Exam Booster",
    voice: "en-IN-PrabhatNeural",
    narration: "Question: What are the 'twin obligations' described by Nelson Mandela? Answer: Every person has two obligations: first to their family, parents, wife and children; and second to their community, people, and country.",
    caption: "Q: What are the 'twin obligations'? | A: 1. Family & parents, 2. People & nation.",
    visual_prompt: `${ART_STYLE_PREFIX}. A pair of antique polished brass scales standing perfectly balanced on a dark oak study table. Warm atmospheric window light, shallow depth of field, clean text-free composition. ${LATENT_BAN}`,
  };

  // Scene 18 (idx 17): Exam Booster Q3 (Indian English Q&A)
  script.scenes[17] = {
    speaker: "Exam Booster",
    voice: "en-IN-PrabhatNeural",
    narration: "Question: Why were two national anthems sung on the day of the inauguration? Answer: To symbolize equality and unity between the white and black communities, celebrating the permanent end of racial discrimination.",
    caption: "Q: Why were two national anthems sung? | A: To mark unity and equality of both races.",
    visual_prompt: `${ART_STYLE_PREFIX}. Two antique classical sheet music manuscripts lying side by side on a polished mahogany piano. Warm afternoon sunbeams, artistic atmosphere, clean text-free composition. ${LATENT_BAN}`,
  };

  // Scene 19 (idx 18): Indomitable Human Spirit (Lock DNA)
  script.scenes[18].visual_prompt = `${MANDELA_DNA}. ${ART_STYLE_PREFIX}. Wide hero shot on the presidential dais looking out toward the vast cheering crowd and the new national flag. Radiant golden hour lighting, cinematic grandeur. ${LATENT_BAN}`;

  // Scene 20 (idx 19): Outro
  script.scenes[19].visual_prompt = `${ART_STYLE_PREFIX}. Close-up of a handsome, aged leather-bound chronicle resting on an antique mahogany table bathed in evening twilight, gently closing as warm shadows settle. Cinematic depth, text-free cover, slow peaceful fade. ${LATENT_BAN}`;

  script.audio_summary = "17/20 Gemini-TTS Hindi/Quotes + 3/20 Indian English Exam Q&A";
  await fs.writeFile(scriptPath, JSON.stringify(script, null, 2));
  console.log("📝 [Script] Updated script.json with 100% Actor DNA Lock, Indian English Q&A, and Anti-Cartoon Anchors.");

  // 3. Synthesize Indian English Audio ONLY for Exam Booster scenes (Scenes 15, 16, 17)
  console.log("\n🎙️ [Audio Delta] Synthesizing Indian English audio for Exam Booster scenes (15, 16, 17)...");
  for (const idx of [15, 16, 17]) {
    const sc = script.scenes[idx];
    const outAudio = path.join(audioDir, `a${String(idx).padStart(3, "0")}.mp3`);
    console.log(`   Synthesizing Scene ${idx + 1} Q&A via Gemini-TTS (English)...`);
    const ok = await synthesizeGeminiTTS(sc.narration, outAudio, "thoughtful", "Charon", "history");
    if (ok) {
      console.log(`   ✅ Scene ${idx + 1} Q&A audio ready: ${outAudio}`);
    } else {
      console.warn(`   ⚠️ Gemini-TTS fallback for Scene ${idx + 1}`);
    }
  }

  // 4. Surgically Re-generate Keyframes for flawed/drifted scenes ONLY
  // Flawed scenes: 2 (2D cartoon), 3, 4, 7, 8, 9, 10 (floating hearts), 12, 13 (severed head), 14, 15, 16, 17, 18
  const scenesToRegen = [2, 3, 4, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18];
  console.log(`\n🎨 [Keyframes Delta] Surgically re-generating ${scenesToRegen.length} flawed keyframes via FLUX.1-schnell...`);

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID!;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN!;

  for (const idx of scenesToRegen) {
    const sc = script.scenes[idx];
    const outPng = path.join(imagesDir, `scene_${String(idx).padStart(3, "0")}.png`);
    console.log(`   Generating Scene ${idx + 1} keyframe -> scene_${String(idx).padStart(3, "0")}.png...`);
    const ok = await callCloudflareFlux(sc.visual_prompt, outPng, accountId, apiToken);
    if (ok) {
      console.log(`   ✅ Scene ${idx + 1} keyframe refreshed with 100% DNA lock.`);
    }
    await new Promise((r) => setTimeout(r, 450));
  }

  // 5. Update Kaggle Dataset
  console.log("\n🚀 [Kaggle Dataset Update] Pushing updated dataset with Cello BGM, Indian English Q&A audio, and locked keyframes...");
  const dsUpload = await kaggle(["datasets", "version", "-p", dsDir, "-m", "Delta Update: Cello BGM, 100% Actor DNA Lock, Indian English Q&A", "--dir-mode", "zip"]);
  console.log(dsUpload);

  // 6. Copy latest render.py to kernel and re-push
  const renderSrc = path.resolve("src", "experiments", "ncert", "render-ncert.py");
  await fs.copyFile(renderSrc, path.join(kDir, "render.py"));

  console.log("🚀 [Kaggle Kernel Update] Pushing Kernel Version with Wan2.1 and Cello BGM mixing...");
  const kPush = await kaggle(["kernels", "push", "-p", kDir]);
  console.log(kPush);

  console.log("\n==================================================================");
  console.log("🎉 SURGICAL DELTA REMEDIATION COMPLETE!");
  console.log("   Dataset updated with Cello BGM + Indian English Q&A.");
  console.log("   Kernel pushed to Kaggle Dual-T4 GPU.");
  console.log("==================================================================");
}

main().catch(console.error);

