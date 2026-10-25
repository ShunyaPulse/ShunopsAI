export type VideoDomain = "science" | "space" | "technology" | "nature" | "history" | "sports" | "general";

export interface VisualBible {
  realWorldGrounding: string;
  organicSettings: string[];
  latentTrapsToBan: string[];
  characterGrammar: string;
  zeroTextRules: string;
  soundscapeProfile: {
    energyLevel: "high" | "measured" | "contemplative" | "dramatic";
    ambientBedStyle: "drone" | "stadium" | "nature" | "industrial" | "orchestral";
    dominantFrequencies: number[];
    foleyCues: string[];
  };
}

export interface VideoScript {
  title: string;
  description: string;
  tags?: string[] | undefined;
  voice: string;
  rate?: string;
  language?: string;
  audio_summary?: string;
  keyframes_summary?: string;
  domain?: VideoDomain;
  visual_bible?: VisualBible;
  chapters: { title: string; start_scene: number }[];
  scenes: {
    narration: string;
    caption?: string;
    visual_prompt: string;
    /** LLM-assigned emotional tone for this scene — drives Gemini TTS prompt & Chirp 3 HD SSML */
    tone?: "excited" | "suspense" | "dramatic" | "somber" | "neutral";
  }[];
  thumbnail?: {
    headline: string;
    subheadline?: string;
    visual_prompt: string;
  };
}

export type VideoPrivacy = "private" | "unlisted" | "public";
export type KaggleAction = "list" | "status" | "output" | "rerun";
