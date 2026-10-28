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
  "baseball bat", "round bat", "rolling pin", "flat wooden board", "plank of wood", "flat paddle", "bat looking like a plank", "paddle bat", "hockey stick",
  "4 stumps", "2 stumps", "5 stumps", "6 stumps", "7 stumps", "multiple stumps", "stumps sprouting from ground", "floating stumps", "floating wickets", "floating bails", "flying stumps while batsman batting",
  "plastic wickets", "wire fence on pitch", "holding bat upside down",
  "bat handle separated from blade", "curved tennis racket handle on bat", "three arms on batter",
  "football goalkeeper gloves on wicketkeeper", "ice hockey helmet", "floating bat", "melting shoulder",
  "fused fingers", "disjointed elbow", "cartoon", "anime", "cgi video game look", "faceless mannequin",

  // Inappropriate attire & rogue extra hallucinations
  "gym vest", "sleeveless shirt", "tank top", "black sleeveless t-shirt", "workout tank", "civilian clothes on pitch", "streetwear on field", "bare arms without team jersey",
  "yellow and black jersey on Indian player", "yellow pads on Indian batsman", "mismatched random kit", "unbranded random colored shirt", "random spectators on pitch", "people without cricket uniforms",

  // Inappropriate trophies & non-bilateral celebrations
  "champions league trophy", "giant silver football cup", "uefa trophy", "fifa world cup trophy", "giant two-handled metallic cup", "lifting trophy in bilateral match", "holding football trophy",

  // Passive / disconnected animations
  "passive crowd panning", "ball floating purposelessly in dark sky", "static players staring", "motionless players standing around",

  // Garbled diffusion text & scoreboard hallucinations
  "scoreboard with text", "digital numbers scoreboard", "led ticker display", "text on jersey",
  "numbers on shirt", "commercial logos on boundary", "legible text on screen", "garbled letters on screen"
];

export interface CricketActionDefinition {
  id: string;
  category: "batting" | "bowling" | "fielding" | "celebration";
  name: string;
  biomechanicalPrompt: string;
}

/**
 * Complete catalog of 22 canonical cricket action types covering batting,
 * bowling, fielding, and celebration cinematography.
 */
export const CRICKET_MAJOR_ACTIONS: CricketActionDefinition[] = [
  // 1. Front-Foot Classical Cover Drive
  {
    id: "cover_drive",
    category: "batting",
    name: "Front-Foot Classical Cover Drive",
    biomechanicalPrompt: "Hero batsman bending front knee with head over the ball, high front elbow pointing toward extra cover, presenting the wide flat face of the handcrafted English willow bat to caress the leather ball along the turf past the fielder under blazing floodlights."
  },
  // 2. Back-Foot Authoritative Pull Shot
  {
    id: "pull_shot",
    category: "batting",
    name: "Back-Foot Authoritative Pull Shot",
    biomechanicalPrompt: "Hero batsman rocking back onto back foot, pivoting decisively, swinging the English willow bat in a powerful horizontal arc across the chest, dispatching the short-pitched ball through midwicket into the deep boundary."
  },
  // 3. Textbook Straight Drive / On-Drive
  {
    id: "straight_drive",
    category: "batting",
    name: "Textbook Straight Drive / On-Drive",
    biomechanicalPrompt: "Hero batsman leaning forward with vertical bat blade, elbow high and head perfectly still, punching the full-length ball crisply past the bowler along the clay pitch."
  },
  // 4. Lofted Straight Hit Down-the-Ground
  {
    id: "lofted_straight_hit",
    category: "batting",
    name: "Lofted Straight Hit Down-the-Ground",
    biomechanicalPrompt: "Hero batsman dancing down the pitch with nimble footwork, high backlift, full arm extension swinging the willow bat through the line, launching the leather ball high over long-on into the roaring 60,000-fan upper tier."
  },
  // 5. Square Cut / Late Cut
  {
    id: "square_cut",
    category: "batting",
    name: "Square Cut / Late Cut",
    biomechanicalPrompt: "Hero batsman shifting weight quickly to the back foot, arms extending wide, slashing the willow bat with open face to guide the bouncing ball through backward point and third man."
  },
  // 6. Wristy Flick / Whip off Pads
  {
    id: "flick_off_pads",
    category: "batting",
    name: "Wristy Flick / Whip off Pads",
    biomechanicalPrompt: "Hero batsman closing the face with supple wrist roll at the instant of impact, whipping the leather ball effortlessly off middle-and-leg stump toward the deep midwicket boundary."
  },
  // 7. Traditional Sweep / Slog Sweep
  {
    id: "sweep_shot",
    category: "batting",
    name: "Traditional Sweep / Slog Sweep",
    biomechanicalPrompt: "Hero batsman dropping low onto front knee on the turf, sweeping the willow bat in a ferocious horizontal arc across the spinning ball, depositing it over deep square leg."
  },
  // 8. Reverse Sweep / Switch Hit
  {
    id: "reverse_sweep",
    category: "batting",
    name: "Reverse Sweep / Switch Hit",
    biomechanicalPrompt: "Hero batsman swiftly reversing grip and stance, crouched low over the pitch, rolling the blade over the top of the spinning ball to guide it over short third man."
  },
  // 9. Ramp / Dilscoop / Upper Cut
  {
    id: "ramp_shot",
    category: "batting",
    name: "Ramp / Dilscoop / Upper Cut",
    biomechanicalPrompt: "Hero batsman sinking low or arching backward, using the fast bowler's high velocity to deflect the ball with angled willow blade directly over the wicketkeeper's helmet."
  },
  // 10. Classical Forward Defensive Block
  {
    id: "forward_defense",
    category: "batting",
    name: "Classical Forward Defensive Block",
    biomechanicalPrompt: "Hero batsman stretching forward with soft hands, vertical willow bat tucked securely beside the front pad, head directly over the ball, deadening the ball into the clay pitch."
  },
  // 11. Fast Bowler Explosive Delivery Stride & Release
  {
    id: "fast_bowler_release",
    category: "bowling",
    name: "Fast Bowler Explosive Overhead Delivery Stride",
    biomechanicalPrompt: "Pace bowler leaping high into the delivery stride at the bowling crease, front foot slamming down with chalk dust puff, right arm high at 12 o'clock, whipping the four-piece leather ball with visible backward seam rotation toward the 3 wooden stumps."
  },
  // 12. Outswing / Inswing Seam Mechanics
  {
    id: "swing_bowling",
    category: "bowling",
    name: "Outswing / Inswing Seam Mechanics",
    biomechanicalPrompt: "Close-up macro tracking of the four-piece leather ball in flight under floodlights, visible hand-stitched seam tilted at an angle, curving late in the air past the outside edge of the batsman's bat."
  },
  // 13. Hostile Short-Pitched Bouncer
  {
    id: "bouncer_delivery",
    category: "bowling",
    name: "Hostile Short-Pitched Bouncer",
    biomechanicalPrompt: "Fast bowler following through aggressively on turf as the leather ball rears up off the clay pitch chest-high towards the batter, testing the batsman's evasive reflexes."
  },
  // 14. Lethal Yorker / Stumps Shatter
  {
    id: "yorker_delivery",
    category: "bowling",
    name: "Lethal Yorker / Stumps Shatter",
    biomechanicalPrompt: "Fast bowler pitching laser-accurate delivery right at the base of the batsman's boots on the popping crease, crashing into off-stump and sending wooden bails spinning through the air under floodlights."
  },
  // 15. Wrist-Spin / Leg-Break Turn
  {
    id: "leg_spin",
    category: "bowling",
    name: "Wrist-Spin / Leg-Break Delivery",
    biomechanicalPrompt: "Leg-spinner cocking wrist and releasing ball with sharp revolutions, ball drifting in the air, gripping the dry pitch turf and spinning sharply away from the right-handed batsman."
  },
  // 16. Finger-Spin / Off-Break Turn
  {
    id: "off_spin",
    category: "bowling",
    name: "Finger-Spin / Off-Break Turn",
    biomechanicalPrompt: "Off-spinner turning fingers violently across the raised seam at release, ball gripping the rough clay surface outside off-stump and biting back viciously toward the stumps."
  },
  // 17. Wicketkeeper Airborne Diving Catch
  {
    id: "keeper_diving_catch",
    category: "fielding",
    name: "Wicketkeeper Airborne Diving Catch",
    biomechanicalPrompt: "Athletic wicketkeeper in padded gloves and helmet leaping horizontally across the slip cordon, grasping the flying leather ball inches above the green grass with outstretched webbed gloves."
  },
  // 18. Direct-Hit Precision Run-Out Throw
  {
    id: "run_out_throw",
    category: "fielding",
    name: "Direct-Hit Precision Run-Out Throw",
    biomechanicalPrompt: "Infield fielder swooping on the ball at extra cover, picking up cleanly in one fluid athletic motion, and releasing an arrow-straight throw that shatters the middle stump at the non-striker's end."
  },
  // 19. Boundary Rope Sliding Save / Relay Flick
  {
    id: "boundary_slide_save",
    category: "fielding",
    name: "Boundary Rope Sliding Save / Relay Flick",
    biomechanicalPrompt: "Outfielder sprinting at full tilt along the boundary foam cushions, sliding on knees across the grass to flick the ball back into play a split second before crossing the rope."
  },
  // 20. Slips Cordon Low Reflex Catch
  {
    id: "slip_reflex_catch",
    category: "fielding",
    name: "Slips Cordon Low Reflex Catch",
    biomechanicalPrompt: "First slip fielder crouching in sharp anticipation, eyes locked on the edge, reacting with split-second reflex to cup soft hands around the rapid traveling leather ball at knee height."
  },
  // 21. Batsman Century / Landmark Triumphant Celebration
  {
    id: "century_celebration",
    category: "celebration",
    name: "Batsman Century / Landmark Triumphant Celebration",
    biomechanicalPrompt: "Hero batsman removing helmet, raising the handcrafted English willow bat with both arms aloft toward 60,000 standing roaring fans under glowing floodlights, embracing batting partner mid-pitch in ecstatic victory."
  },
  // 22. Bowler Wicket Roar & Pitch-Center Team Huddle
  {
    id: "wicket_celebration_huddle",
    category: "celebration",
    name: "Bowler Wicket Roar & Pitch-Center Team Huddle",
    biomechanicalPrompt: "Fast bowler executing an explosive airborne leap with pumped fist and impassioned celebratory roar, as teammates in matching team jerseys rush in from cover and mid-off to mob him in a joyous huddle."
  }
];

export interface DynamicCricketParams {
  teamsDescription?: string;
  heroPlayersDNA?: string;
}

/**
 * Formats the 22 canonical actions for dynamic injection into the Director's Visual Bible.
 */
export function formatCricketActionsForPrompt(): string {
  return CRICKET_MAJOR_ACTIONS.map(
    (a, i) => `${i + 1}. [${a.name} (${a.category})]: ${a.biomechanicalPrompt}`
  ).join("\n");
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
      "Hero batsman in solid team kit leaning into a classical front-foot cover drive, high front elbow, wide flat blade of willow bat meeting ball crisply",
      "Pitch-center mid-pitch celebration huddle, hero batsman raising English willow bat to standing ovation from 60,000 cheering fans",
      "Close-up of hero cricketer raising helmet and English willow bat high in triumph, roaring crowd in background",
      "Fast bowler leaping in explosive overhead delivery stride at bowling crease releasing four-piece leather ball toward 3 wooden stumps",
      "Batsman pivoting on back foot executing powerful pull shot through midwicket, willow bat swinging horizontally under bright floodlights",
      "Textbook straight drive along the turf with vertical bat blade and high front elbow punch",
      "Lofted straight hit down-the-ground with batsman stepping out and launching leather ball over bowler's head into packed stands",
      "Late cut slicing behind point with angled blade of English willow bat",
      "Wristy flick off pads rolling wrists to guide ball through midwicket boundary",
      "Wicketkeeper in padded gloves and helmet leaping in airborne dive to pouch edge inches off the grass",
      "Direct-hit run-out throw from cover shattering middle stump with bails flying under floodlights",
      "Boundary rope sliding save with fielder flicking ball back inside rope before colliding with foam cushions",
      "Dugout players leaping onto boundary cushions in wild celebration under confetti and pyrotechnic stadium haze",
      "Lush green outfield boundary rope perimeter with foam triangular cushions and towering floodlights shining over packed stands"
    ],

    latentTrapsToBan: CRICKET_LATENT_TRAPS,

    characterGrammar:
      `Authentic athletic cricket cinematography: (1) Hero Character Visual DNA: ${heroDNA}. (2) Real-Action Cricket Repertoire (Visuals MUST actively depict one of the 22 canonical actions matching commentary; never passive crowd pans or disconnected balls floating in sky):\n${formatCricketActionsForPrompt()}\n(3) Team Kits: All players must wear team-authentic solid athletic jerseys (India: Royal Indian Blue athletic jersey and matching blue trousers; opposition in solid dark team kit). Strictly ZERO gym vests, sleeveless tank tops, civilian clothes, or yellow/black random kits on Indian players. (4) Electric Stadium & Fan Invariant: Packed cheering grandstands with 60,000+ roaring spectators and waving team flags under floodlights. (5) Bilateral Celebration Standard: Batsman taking off helmet and raising flat English willow bat toward the standing roaring crowd; passionate fist-pumping celebration with batting partner mid-pitch; team dugout rushing onto boundary cushions. Strictly ZERO Champions League or giant football trophies. (6) 100% Genuine Cricket Equipment: Handcrafted flat-faced English willow bat with arched rear spine and rubber cane handle (never round baseball bats or rolling pins); exactly three vertical wooden Ash stumps firmly anchored into the pitch with two wooden bails (never 4+ stumps or floating wickets); four-piece leather ball with visible hand-stitched seam.`,

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
