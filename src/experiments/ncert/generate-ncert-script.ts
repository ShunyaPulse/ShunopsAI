import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { geminiGenerate } from "../../tools/video.js";
import { A_LETTER_TO_GOD_PROSE } from "./ncert-prose-data.js";

export interface NCERTScene {
  speaker?: "Narrator" | "Lencho" | "Postmaster" | "Postman" | "Exam Booster";
  voice?: string;
  narration: string;
  caption: string;
  visual_prompt: string;
}

export interface NCERTScript {
  title: string;
  description: string;
  tags: string[];
  chapters: { title: string; start_scene: number }[];
  thumbnail: {
    headline: string;
    subheadline: string;
    visual_prompt: string;
  };
  language: string;
  voice: string;
  scenes: NCERTScene[];
}

export async function generateNCERTScript(): Promise<NCERTScript> {
  console.log(`[NCERT Script] Building factual zero-hallucination script for '${A_LETTER_TO_GOD_PROSE.title}'...`);

  const prompt = `You are a master educational filmmaker producing an authentic, cinematic Class 10 NCERT English adaptation.
You MUST write a gripping, 100% factual script strictly based on the official NCERT textbook prose below.

SOURCE TEXTBOOK & FACTUAL DATA:
Title: ${A_LETTER_TO_GOD_PROSE.title}
Author: ${A_LETTER_TO_GOD_PROSE.author}
Book: ${A_LETTER_TO_GOD_PROSE.book} (NCERT Class 10 CBSE & UP Board)
Characters: ${JSON.stringify(A_LETTER_TO_GOD_PROSE.characters)}
Factual Plot Points:
- Setting: ${A_LETTER_TO_GOD_PROSE.factualData.setting}
- Disaster: ${A_LETTER_TO_GOD_PROSE.factualData.disasterDuration}
- Financials: Lencho demanded ${A_LETTER_TO_GOD_PROSE.factualData.requestedAmount}, postmaster collected ${A_LETTER_TO_GOD_PROSE.factualData.collectedAmount}, missing ${A_LETTER_TO_GOD_PROSE.factualData.missingAmount}. Envelope signed "${A_LETTER_TO_GOD_PROSE.factualData.envelopeSignature}".
- Core Irony: ${A_LETTER_TO_GOD_PROSE.factualData.centralIrony}

VERBATIM QUOTES TO FEATURE IN ENGLISH:
${A_LETTER_TO_GOD_PROSE.verbatimQuotes.map((q) => `- "${q}"`).join("\n")}

STRICT INVARIANTS:
1. ZERO HALLUCINATION / ZERO FICTION:
   - Do NOT invent imaginary characters, events, modern technology, or altered endings.
   - Lencho is a farmer with unquestioning faith; the postmaster is a fat, generous, amiable man who collected 70 pesos.
2. DUAL-VOICE ARCHITECTURE:
   - Default Narrator voice: "hi-IN-MadhurNeural" (speaks dramatic, captivating Hindi narration).
   - Character dialogue scenes (Lencho or Postmaster speaking textbook lines in English):
     * Set "speaker": "Lencho" (or "Postmaster")
     * Set "voice": "en-IN-PrabhatNeural" (or "en-US-AndrewNeural")
     * In "narration", write the exact English line from the NCERT book (e.g. "A plague of locusts would have left more than this!")
3. SUBTITLES ("caption"):
   - Every single scene must have "caption" written in 100% PURE ENGLISH words.
4. ACT BREAKDOWN (Target: 18-20 scenes total, 3.5 to 4.2 minutes runtime):
   - Act 1 (Scenes 0-3): The Ripe Cornfield, Valley Setting, and Arrival of Rain ("New coins").
   - Act 2 (Scenes 4-7): The Devastating Hailstorm, Field Covered in Salt, Lencho's despair and deep solitary faith.
   - Act 3 (Scenes 8-11): Writing "To God", Postman's laughter, Postmaster's realization, Collecting 70 pesos charity.
   - Act 4 (Scenes 12-16): Lencho receives envelope, anger at 70 pesos, second letter demanding the remaining 30 pesos and calling postal staff a "bunch of crooks".
   - Act 5 (Scenes 17-19): 3 High-Yield Board Exam Flashcards:
     1. The Central Irony (Why calling staff 'bunch of crooks' is ironic).
     2. Postmaster's Character Sketch (Benevolent human charity).
     3. Lencho's Unshakable Faith vs Blind Suspicion.
5. YOUTUBE METADATA:
   - Title: "A Letter to God Class 10 English First Flight | Full Chapter Explanation & Animation in Hindi"
   - Description: Pure English detailed overview, timestamps, summary of Lencho's faith and the postmaster's kindness, and CBSE/UP Board exam tips.
   - Tags: ["A Letter to God Class 10", "A Letter to God Full Story", "First Flight Chapter 1", "Class 10 English NCERT", "Lencho Story Animation", "CBSE Class 10 English", "UP Board English Class 10"]
   - Thumbnail: High-contrast hero concept prompt of Lencho standing in a devastated white cornfield clutching an envelope addressed "To God".

Respond with pure JSON conforming to this schema:
{
  "title": string,
  "description": string,
  "tags": string[],
  "chapters": [{ "title": string, "start_scene": number }],
  "thumbnail": {
    "headline": string,
    "subheadline": string,
    "visual_prompt": string
  },
  "language": "Hindi",
  "voice": "hi-IN-MadhurNeural",
  "scenes": [
    {
      "speaker": "Narrator" | "Lencho" | "Postmaster",
      "voice": "hi-IN-MadhurNeural" | "en-IN-PrabhatNeural",
      "narration": string,
      "caption": string,
      "visual_prompt": string
    }
  ]
}`;

  const { text } = await geminiGenerate(prompt);
  let parsed: NCERTScript;
  try {
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    throw new Error(`Failed to parse NCERT script JSON: ${err.message}\nRaw output: ${text.slice(0, 300)}`);
  }

  console.log(`[NCERT Script] Generated ${parsed.scenes.length} scenes successfully.`);
  return parsed;
}

const isCLI = process.argv[1]?.endsWith("generate-ncert-script.ts") || process.argv[1]?.endsWith("generate-ncert-script.js");
if (isCLI) {
  generateNCERTScript().then((s) => {
    console.log("\n--- Preview of Generated Script ---");
    console.log(`Title: ${s.title}`);
    console.log(`Scenes: ${s.scenes.length}`);
    console.log("Scene 1:", s.scenes[0]);
    console.log("Scene 5:", s.scenes[4]);
    console.log("Last Scene (Exam Booster):", s.scenes[s.scenes.length - 1]);
  }).catch(console.error);
}
