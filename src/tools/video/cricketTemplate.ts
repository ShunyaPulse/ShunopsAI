import type { VisualBible } from "./types.js";

/**
 * Highly optimized, deterministic production-grade Cricket Visual & Acoustic Bible.
 * Bypasses LLM token consumption and model hallucinations for all cricket videos.
 * Guarantees zero mansions/palaces, zero warped baseball/football swings,
 * zero garbled scoreboard text ("34AAST"), and rich stadium sound design.
 */
export const CRICKET_PRODUCTION_TEMPLATE: VisualBible = {
  realWorldGrounding:
    "Authentic international cricket arena featuring a manicured 22-yard clay-and-turf pitch with white crease markings, 3 wooden stumps with bails, professional English willow cricket bats, genuine four-piece raised-seam leather cricket balls, boundary rope perimeter, and towering stadium floodlights under an atmospheric sky. Strictly anchored within the playing oval and dugout.",
  organicSettings: [
    "22-yard turf cricket pitch with chalk batting creases and wooden stumps",
    "Lush green outfield boundary rope perimeter with towering stadium floodlights",
    "Team technical dugout and player bench under stadium grandstand",
    "Athletic player tunnel and dressing room looking out onto the cricket field",
    "Outdoor practice turf nets with boundary fencing",
    "Pitch-center team celebration huddle under stadium floodlights"
  ],
  latentTrapsToBan: [
    "colonial mansion", "british palace", "haveli", "luxury resort garden", "hotel balcony",
    "residential brick house", "office cubicle", "corporate boardroom", "cctv room",
    "baseball", "baseball bat", "baseball glove", "baseball sliding", "baseball diamond",
    "american football helmet", "rugby ball", "soccer goalpost", "tennis court", "basketball hoop",
    "scoreboard with text", "digital numbers scoreboard", "led ticker display", "text on jersey",
    "wooden sticks on dining table", "floating bat", "melting shoulder", "fused fingers", "cartoon", "anime"
  ],
  characterGrammar:
    "Kinematically decoupled cricket cinematography: prioritize (1) macro equipment shots (spinning leather ball seam in flight, willow bat sweet-spot impact, turf explosion under bowler's spiked boots, cartwheeling bails), (2) dynamic over-the-shoulder perspectives from slips/wicketkeeper, (3) medium tracking shots along boundary rope, and (4) atmospheric floodlit silhouettes of athletes. Strictly ban full-body side-profile swing contortions (to prevent baseball warping and shoulder melting) and ban macro facial portraits of real cricketers.",
  zeroTextRules:
    "STRICT ABSOLUTE ZERO SCOREBOARDS OR DIGITAL TEXT: Never render stadium scoreboards, speed guns, or digital time tickers in diffusion latents. Athletic jerseys must feature solid vibrant color panels and clean cloth folds with zero numbers, zero sponsor text, zero letters. All boundary perimeter hoardings must be smooth blurred color gradients with zero legible branding.",
  soundscapeProfile: {
    energyLevel: "high",
    ambientBedStyle: "stadium",
    dominantFrequencies: [65, 130],
    foleyCues: [
      "crack of willow bat hitting leather ball",
      "rhythmic stadium crowd roar and applause",
      "wooden stump rattle and bails clatter",
      "spiked cricket shoes crunching on turf",
      "leather ball whoosh through air"
    ]
  }
};

/**
 * Checks if a topic or trend is specifically cricket-focused.
 */
export function isCricketTopic(topic: string, trendReason?: string): boolean {
  const text = `${topic} ${trendReason || ""}`.toLowerCase();
  return /\b(cricket|ipl|bcci|icc|test match|odi|t20|t20i|wicket|stumps|pitch|batsman|bowler|century|scorecard|kohli|rohit sharma|babar|bumrah|malinga|jayasuriya|harry brook|joe root|ben stokes|shubman gill|dhoni|sachin|hardik pandya|shaheen|rashid khan|cummins|starc|rawalpindi|lords|headingley|wankhede|eden gardens|melbourne|mcg|scg|galle|colombo|tri-series|tri-nation|champions trophy|world cup cricket|cricketer)\b/i.test(text);
}
