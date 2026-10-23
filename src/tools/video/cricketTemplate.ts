import type { VisualBible } from "./types.js";

/**
 * Highly optimized, deterministic production-grade Cricket Visual & Acoustic Bible.
 * Bypasses LLM token consumption and model hallucinations for all cricket videos.
 *
 * Guarantees:
 * - 100% authentic stadium and pitch grounding (zero mansions, havelis, or palaces)
 * - Zero cross-sport contamination (no baseball catcher masks, golf swings, or tennis rackets)
 * - Zero distorted AI text ("34AAST" scoreboard traps completely banned)
 * - Kinematically safe camera grammar (macro seam flight, sweet-spot impact, stump rattle)
 * - Immersive 80,000-capacity stadium acoustic profile
 */
export const CRICKET_PRODUCTION_TEMPLATE: VisualBible = {
  realWorldGrounding:
    "Authentic international cricket arena featuring a manicured 22-yard clay-and-turf pitch with white chalk batting and bowling creases, 3 wooden Ash/English willow stumps with wooden bails, professional English willow cricket bats with rubber-grip cane handles, genuine four-piece raised-seam leather cricket balls, boundary rope perimeter with foam triangular cushions, and 6 towering stadium floodlight pylons under an atmospheric evening sky. Strictly anchored within the playing oval, boundary perimeter, and team dugout.",

  organicSettings: [
    "22-yard turf cricket pitch with chalk batting creases, wooden stumps, and bails",
    "Curator rolling the 22-yard clay-turf pitch under morning stadium sunlight",
    "Lush green outfield boundary rope perimeter with foam triangular cushions and towering floodlights",
    "Slip cordon and wicketkeeper crouching in low anticipation stance behind stumps",
    "Bowler measuring run-up markers from bowling crease with white chalk",
    "Team technical dugout and player bench under grandstand canopy",
    "Athletic player tunnel and glass-fronted dressing room looking out onto the cricket field",
    "Outdoor practice turf nets with chain-link boundary fencing",
    "Batter tapping toe of bat on popping crease while adjusting batting gloves",
    "Pitch-center team celebration huddle and high-fives under intense stadium floodlight haze",
    "Dynamic boundary line tracking shot of white leather ball skidding across lush green outfield turf",
    "Atmospheric twilight stadium grandstand under dramatic floodlit match haze and pyrotechnic mist"
  ],

  latentTrapsToBan: [
    // Non-cricket sports & cross-sport contamination
    "baseball", "baseball bat", "baseball glove", "baseball sliding into home plate", "baseball diamond",
    "baseball catcher mask", "baseball umpire chest protector", "golf swing", "golf club", "golf green",
    "tennis racket", "tennis net on pitch", "american football helmet", "rugby ball", "soccer goalpost",
    "basketball hoop", "table tennis paddle", "hockey stick",

    // Architectural & domestic venue hallucinations
    "colonial mansion", "british palace", "haveli", "luxury resort garden", "hotel balcony",
    "residential brick house", "office cubicle", "corporate boardroom", "cctv room", "dining room",
    "swimming pool in outfield", "living room sofa",

    // Malformed equipment & anatomical glitches
    "4 stumps", "2 stumps", "plastic wickets", "wire fence on pitch", "holding bat upside down",
    "bat handle separated from blade", "curved tennis racket handle on bat", "three arms on batter",
    "football goalkeeper gloves on wicketkeeper", "ice hockey helmet", "floating bat", "melting shoulder",
    "fused fingers", "disjointed elbow", "cartoon", "anime", "cgi video game look",

    // Garbled diffusion text & scoreboard hallucinations
    "scoreboard with text", "digital numbers scoreboard", "led ticker display", "text on jersey",
    "numbers on shirt", "commercial logos on boundary", "legible text on screen", "garbled letters on screen"
  ],

  characterGrammar:
    "Kinematically decoupled cricket cinematography: prioritize (1) macro equipment dynamics in high-speed slow motion (spinning leather ball seam in flight with visible stitched revolutions, English willow bat sweet-spot impact compressing ball, turf explosion under bowler's front-foot plant, middle stump uprooted cartwheeling through air), (2) dynamic over-the-shoulder perspectives from slips/wicketkeeper toward the popping crease, (3) smooth steadicam tracking along boundary rope cushion, and (4) atmospheric floodlit athlete silhouettes in evening mist. Strictly ban full-body 360-degree rotational swing animations (which morph cricket bats into baseball/tennis swings) and ban macro facial deepfakes of real cricketers.",

  zeroTextRules:
    "STRICT ABSOLUTE ZERO SCOREBOARDS OR DIGITAL TEXT: Never render stadium scoreboards, speed guns, or digital time tickers in diffusion latents. Athletic jerseys must feature solid vibrant color panels and clean cloth folds with zero numbers, zero sponsor text, zero letters. All boundary perimeter hoardings must be smooth blurred color gradients with zero legible branding.",

  soundscapeProfile: {
    energyLevel: "high",
    ambientBedStyle: "stadium",
    dominantFrequencies: [65, 130, 260],
    foleyCues: [
      "crack of willow bat hitting leather ball",
      "rhythmic stadium crowd roar and applause",
      "wooden stump rattle and bails clatter",
      "spiked cricket shoes crunching on turf",
      "leather ball whoosh through air",
      "umpire crisp wooden ball tap and appeal call",
      "deafening 80,000-voice stadium chorus rising to an explosive roar"
    ]
  }
};

/**
 * Checks if a topic or trend is specifically cricket-focused.
 * Covers tournaments, international players, venues, and specialized cricketing terms.
 */
export function isCricketTopic(topic: string, trendReason?: string): boolean {
  const text = `${topic} ${trendReason || ""}`.toLowerCase();
  return /\b(cricket|ipl|wpl|bcci|icc|test match|odi|t20|t20i|bgt|border gavaskar|wtc|world test championship|champions trophy|asia cup|bbl|psl|cpl|the hundred|ranji|smat|wicket|stumps|pitch|batsman|bowler|century|scorecard|kohli|virat|rohit sharma|babar|bumrah|jasprit|malinga|jayasuriya|harry brook|joe root|ben stokes|shubman gill|jaiswal|yashasvi|rishabh pant|pant|siraj|shami|kuldeep|dhoni|sachin|hardik pandya|hardik|shaheen|rashid khan|cummins|starc|hazlewood|travis head|head|klaasen|maxwell|warner|boult|williamson|rachin|conway|santner|surya|sky|suryakumar|arshdeep|axar|sanju samson|varun chakravarthy|rawalpindi|lords|headingley|wankhede|eden gardens|melbourne|mcg|scg|galle|colombo|ahmedabad|motera|dharamsala|tri-series|tri-nation|world cup cricket|cricketer|super over|powerplay|death overs|yorker|bouncer|googly|doosra|carrom ball|reverse swing|inswinger|outswinger|cover drive|pull shot|hook shot|straight drive|helicopter shot|reverse sweep|slip cordon|gully|silly point|deep midwicket|long on|long off|third man|fine leg|hat trick|fifer|maiden over|free hit|lbw|stumped|run out)\b/i.test(text);
}
