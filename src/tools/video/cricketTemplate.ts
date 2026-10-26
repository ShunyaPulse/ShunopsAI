import type { VisualBible } from "./types.js";

/**
 * Universal latent traps to ban across all cricket renders.
 * Completely eliminates ghost grounds, tennis lines, bowling pins, and domestic architecture.
 */
export const CRICKET_LATENT_TRAPS = [
  // Empty & ghost ground traps (eliminates deserted grounds)
  "empty stadium", "empty seats in stadium", "deserted cricket ground", "unoccupied stands",
  "ghost stadium", "silent empty field", "abandoned arena", "no crowd visible", "empty benches",

  // Non-cricket sports & geometry contamination (eliminates tennis lines, bowling pins, golf balls)
  "tennis court lines", "tennis court", "tennis net on pitch", "multiple parallel white lines on turf",
  "tennis court service boxes", "white rectangle markings on grass", "badminton court",
  "bowling pins", "ten-pin bowling", "skittles", "carrom pawns", "croquet wickets",
  "wooden frames in front of stumps", "double stumps", "stumps without bails", "croquet hoops",
  "baseball", "baseball bat", "baseball glove", "baseball sliding into home plate", "baseball diamond",
  "baseball catcher mask", "baseball umpire chest protector", "golf swing", "golf club", "golf green",
  "golf ball", "lawn bowls ball", "smooth white plastic ball", "seamless white ball", "billiard ball",
  "american football helmet", "rugby ball", "soccer goalpost", "basketball hoop", "hockey stick",

  // Architectural & domestic venue hallucinations
  "colonial mansion", "british palace", "haveli", "luxury resort garden", "hotel balcony",
  "residential brick house", "office cubicle", "corporate boardroom", "cctv room", "dining room",
  "swimming pool in outfield", "living room sofa",

  // Malformed equipment & anatomical glitches
  "4 stumps", "2 stumps", "plastic wickets", "wire fence on pitch", "holding bat upside down",
  "bat handle separated from blade", "curved tennis racket handle on bat", "three arms on batter",
  "football goalkeeper gloves on wicketkeeper", "ice hockey helmet", "floating bat", "melting shoulder",
  "fused fingers", "disjointed elbow", "cartoon", "anime", "cgi video game look", "faceless mannequin",

  // Garbled diffusion text & scoreboard hallucinations
  "scoreboard with text", "digital numbers scoreboard", "led ticker display", "text on jersey",
  "numbers on shirt", "commercial logos on boundary", "legible text on screen", "garbled letters on screen"
];

export interface DynamicCricketParams {
  teamsDescription?: string;
  heroPlayersDNA?: string;
}

/**
 * Dynamically builds a production-grade Cricket Visual & Acoustic Bible
 * using real-world research facts (teams, notable players)
 * merged with strict physical & geometric invariants of an international cricket stadium.
 */
export function buildCricketVisualBible(params: DynamicCricketParams = {}): VisualBible {
  const teamContext = params.teamsDescription
    ? `${params.teamsDescription}.`
    : "High-stakes international cricket fixture between two professional teams in clean solid-color athletic kits.";

  const heroDNA = params.heroPlayersDNA
    ? params.heroPlayersDNA
    : "Hero International Cricketer: Athletic professional cricketer in prime physical conditioning, wearing team-authentic solid vibrant athletic jersey (clean cloth folds, zero text/logos), protective batting pads, and helmet with steel face grille. Focused competitive gaze, authentic batting stance on the single chalk popping crease, executing crisp cricket strokes with high elbow, and raising bat in triumphant celebration to a standing ovation from 60,000 cheering fans.";

  return {
    realWorldGrounding:
      `Electrifying international cricket stadium packed to capacity with 60,000+ passionate roaring fans filling the multi-tiered grandstands under massive floodlight towers. ${teamContext} Vibrant team flags waving in the crowd, celebratory pyrotechnic smoke haze drifting over the boundary perimeter foam cushions, thrilling championship match atmosphere. A pristine 22-yard clay-and-turf cricket pitch with sharp single white chalk batting and bowling crease lines, and exactly 3 wooden Ash stumps with 2 wooden bails at each end. Genuine four-piece raised-seam leather cricket ball with visible hand-stitched white seam. Strictly anchored within the playing oval, boundary perimeter, team dugout, and roaring grandstands.`,

    organicSettings: [
      "Packed 60,000-seat cricket stadium stands with standing roaring fans waving team flags under blazing floodlights",
      "Pristine 22-yard clay-turf cricket pitch with single chalk popping crease, exactly 3 wooden stumps, and 2 bails",
      "Batter in solid team kit stepping out of the crease, executing powerful stroke past roaring crowd in the background",
      "Pitch-center mid-pitch celebration huddle, hero batsman raising English willow bat to standing ovation from 60,000 cheering fans",
      "Close-up of hero cricketer raising helmet and English willow bat high in triumph, roaring crowd in background",
      "Bowler charging in past roaring crowd, delivering four-piece raised-seam leather ball toward 3 wooden stumps",
      "Dugout players leaping onto boundary cushions in wild celebration under confetti and pyrotechnic stadium haze",
      "Lush green outfield boundary rope perimeter with foam triangular cushions and towering floodlights shining over packed stands",
      "Athletic wicketkeeper crouching in low anticipation stance behind the 3 wooden stumps with bails",
      "Dynamic boundary line tracking shot of white leather ball skidding across lush green outfield turf toward boundary cushion"
    ],

    latentTrapsToBan: CRICKET_LATENT_TRAPS,

    characterGrammar:
      `Authentic athletic cricket cinematography: (1) Hero Character Visual DNA: ${heroDNA}. Active players in dynamic action stances (pull shot, crisp cover drive, lofted straight hit, or diving into the crease) wearing team-authentic solid athletic jerseys (clean cloth folds, zero text/logos), protective pads, and steel-grille helmet. (2) Electric Stadium & Fan Invariant: Never depict empty or ghost stadiums. Every stadium perspective must reveal packed cheering grandstands with 60,000+ roaring spectators and waving team flags under floodlights. (3) Peak Emotional Climax: Batsman raising English willow bat toward the standing roaring crowd, passionate fist-pumping celebration with batting partner mid-pitch. (4) 100% Genuine Cricket Equipment: Exactly 22-yard clay pitch with a single crisp chalk batting crease line, exactly three vertical wooden Ash stumps with two bails, four-piece leather ball with visible hand-stitched white seam. Strictly ban empty stadiums, tennis court lines, bowling pins, croquet wickets, and golf balls.`,

    zeroTextRules:
      "STRICT ABSOLUTE ZERO SCOREBOARDS OR DIGITAL TEXT: Never render stadium scoreboards, speed guns, or digital time tickers in diffusion latents. Athletic jerseys must feature solid vibrant color panels and clean cloth folds with zero numbers, zero sponsor text, zero letters. All boundary perimeter hoardings must be smooth blurred color gradients with zero legible branding.",

    soundscapeProfile: {
      energyLevel: "high",
      ambientBedStyle: "stadium",
      dominantFrequencies: [65, 130, 260],
      foleyCues: [
        "crack of willow bat hitting leather ball",
        "deafening 60,000-voice stadium chorus rising to an explosive roar",
        "wooden stump rattle and bails clatter",
        "spiked cricket shoes crunching on turf",
        "leather ball whoosh through air",
        "passionate player roar and celebratory scream",
        "stadium horns, cheers, and rhythmic applause"
      ]
    }
  };
}

/**
 * Universal default cricket template fallback.
 */
export const CRICKET_PRODUCTION_TEMPLATE: VisualBible = buildCricketVisualBible();

/**
 * Checks if a topic or trend is specifically cricket-focused.
 * Covers tournaments, international players, venues, and specialized cricketing terms.
 */
export function isCricketTopic(topic: string, trendReason?: string): boolean {
  const text = `${topic} ${trendReason || ""}`.toLowerCase();
  return /\b(cricket|ipl|wpl|bcci|icc|test match|odi|t20|t20i|bgt|border gavaskar|wtc|world test championship|champions trophy|asia cup|bbl|psl|cpl|the hundred|ranji|smat|wicket|stumps|pitch|batsman|bowler|century|scorecard|kohli|virat|rohit sharma|babar|bumrah|jasprit|malinga|jayasuriya|harry brook|joe root|ben stokes|shubman gill|jaiswal|yashasvi|rishabh pant|pant|siraj|shami|kuldeep|dhoni|sachin|hardik pandya|hardik|shaheen|rashid khan|cummins|starc|hazlewood|travis head|head|klaasen|maxwell|warner|boult|williamson|rachin|conway|santner|surya|sky|suryakumar|arshdeep|axar|sanju samson|varun chakravarthy|rawalpindi|lords|headingley|wankhede|eden gardens|melbourne|mcg|scg|galle|colombo|ahmedabad|motera|dharamsala|tri-series|tri-nation|world cup cricket|cricketer|super over|powerplay|death overs|yorker|bouncer|googly|doosra|carrom ball|reverse swing|inswinger|outswinger|cover drive|pull shot|hook shot|straight drive|helicopter shot|reverse sweep|slip cordon|gully|silly point|deep midwicket|long on|long off|third man|fine leg|hat trick|fifer|maiden over|free hit|lbw|stumped|run out|shadab|haris rauf)\b/i.test(text);
}
