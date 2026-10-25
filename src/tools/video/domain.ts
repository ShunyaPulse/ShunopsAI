import type { VideoDomain } from "./types.js";

/**
 * Detects the intellectual domain of the topic to enforce strict authentic aesthetics,
 * prevent inappropriate cross-domain tropes (e.g. sports gear in science videos),
 * and calibrate narration tone and pacing.
 */
/**
 * Comprehensive detection for Cricket and Sports matchups, tournaments, teams, and stadiums.
 * Guaranteed to catch multi-nation series, trophies, finals, and cricket-specific nomenclature.
 */
export function isSportsOrCricket(text: string, trendReason?: string): boolean {
  const combined = `${text} ${trendReason || ""}`.toLowerCase();
  return /\b(cricket|football|soccer|fifa|ipl|bcci|icc|match|matches|score|scorecard|wicket|wickets|batsman|bowler|bowling|batting|century|sixes|fours|overs|chase|target|innings|pitch|crease|stumps|bails|tri-series|series|tournament|championship|trophy|cup|league|final|finals|semi-final|semifinal|quarter-final|derby|stadium|arena|olympics|athlete|athletics|tennis|badminton|f1|formula 1|formula one|afghanistan|australia|england|pakistan|south africa|new zealand|sri lanka|west indies|bangladesh|zimbabwe|ireland|arsenal|chelsea|spurs|tottenham|everton|liverpool|manchester|real madrid|barcelona|psg|bayern|ronaldo|messi|mbappe|haaland|kohli|rohit|dhoni|bumrah|gill|hardik|pant|babar|rizwan|rashid khan|gurbaz|sharjah|wankhede|eden gardens|lords|mcg|scg)\b/i.test(combined);
}

export function detectVideoDomain(topic: string, trendReason?: string): VideoDomain {
  if (isSportsOrCricket(topic, trendReason)) {
    return "sports";
  }

  const combined = `${topic} ${trendReason || ""}`.toLowerCase();

  // Space pattern
  if (/\b(space|isro|nasa|jwst|james webb|telescope|black hole|astronomy|galaxy|nebula|pulsar|supernova|exoplanet|mars|moon|chandrayaan|artemis|voyager|spacex|cosmos|orbit|interstellar|asteroid|meteor|comet)\b/i.test(combined)) {
    return "space";
  }

  // Science / Physics / Biology pattern
  if (/\b(science|physics|quantum|particle|atom|molecule|biology|dna|gene|crispr|genetics|vaccine|virus|chemistry|laboratory|microscope|fusion|cern|hadron|nobel|gravitational wave|relativity|evolution|neuroscience)\b/i.test(combined)) {
    return "science";
  }

  // Technology / Engineering pattern
  if (/\b(semiconductor|microchip|gpu|nvidia|robot|robotics|artificial intelligence|\bai\b|llm|supercomputer|algorithm|cyber|tunnel|bridge|megaproject|battery|lithium|ev\b|nuclear reactor|engine|photolithography|fab\b|nanometer)\b/i.test(combined)) {
    return "technology";
  }

  // Nature / Earth pattern
  if (/\b(ocean|deep sea|abyss|marianas trench|volcano|earthquake|wildlife|glacier|antarctica|ecosystem|biodiversity|forest|coral reef|species|amazon rainforest|geology)\b/i.test(combined)) {
    return "nature";
  }

  // History / Archaeology pattern
  if (/\b(history|ancient|civilization|archaeology|excavation|dynasty|temple|kailash temple|pyramid|empire|monument|ruins|century|medieval|bronze age|indus valley|harappa|mohenjo|sculpture|inscriptions)\b/i.test(combined)) {
    return "history";
  }

  return "general";
}

const SCIENCE_TECH_DIRECTIVES = (domain: VideoDomain): string => `CRITICAL DOMAIN DIRECTIVES (${domain.toUpperCase()} INTELLECTUAL DOCUMENTARY):
- MANDATORY HARD SCIENTIFIC METRICS & SCALE (CONCRETE NUMBERS):
  * Spoken narration MUST state concrete, real-world measurements rather than vague descriptions: exact distances (km, light years, astronomical units), wavelengths (infrared, X-ray), temperatures (Kelvin, Celsius), mirror/antenna diameters, speeds, or dates (e.g. "Dharti se 15 lakh kilometer door L2 orbit", "minus 233 degree Celsius", "6.5 meter ka beryllium mirror", "13.6 billion saal purani pehli galaxy").
  * STRICTLY BAN vague fluff ("bohot door tha", "bohot bada tha"); anchor every scene with real physical scale.
- STRICT BAN ON SPORTS, ATHLETICS & CARTOONS:
  * ABSOLUTELY ZERO sports footage, cricket bats, balls, pads, wickets, footballs, American football or baseball helmets, athletic jerseys, referee uniforms, scoreboards, or stadium crowds.
  * ABSOLUTELY ZERO anime, cartoon, manga, or comic caricature characters.
- CINEMATIC REALISM & VISUAL MOTIFS:
  * Visuals MUST authentically depict real physical science: ${domain === "space" ? "golden beryllium telescope mirrors (JWST style), radio telescope dishes pointing at the stars, deep cosmic nebulae with accurate gravitational lensing, orbital mechanics, planetary surfaces, solar flare magnetic loops" : domain === "technology" ? "sub-nanometer photolithography cleanrooms with deep ultraviolet illumination, silicon wafer inspection, superconducting quantum processor dilution refrigerators, sleek industrial robotics, high-speed fiber-optic data switches" : "particle collision tracks, cryogenic electron microscopy, laser interferometry, glowing plasma chambers, 3D molecular protein folding models, sterile laboratory cleanrooms"}.
- ELIMINATION OF CHARACTER WARPING & FACE MORPHING:
  * For science and space documentaries, NEVER generate recurring human face close-ups across cuts (which causes horrific AI face warping, eye distortion, and melting skin).
  * Keep visuals focused on the physical phenomenon, cosmic structures, instruments, cleanroom robots, or silhouetted researchers seen from a wide angle or from behind in cleanroom bunny suits.
- ZERO AI TEXT IN DIFFUSION RULE (MANDATORY):
  * Diffusion models must NEVER attempt to render legible text, letters, numerals, words, or pseudocode in the image (which creates gibberish distorted glyphs).
  * Every monitor, telemetry screen, or laboratory readout MUST be described as: "unlabeled glowing abstract cyan and amber telemetry monitors, clean holographic data visualization, ambient volumetric HUD glow with zero text, zero letters, zero numbers".
- AUDIO TONE, CADENCE & INTELLIGENT ENERGY:
  * Voiceover tone must be measured, cerebral, awe-inspiring, and authoritative (in the style of Cosmos / Veritasium / Think School / Brian Cox).
  * NOT screaming sports commentary or shallow reel hype. Deliver an intellectual thrill with dynamic pitch variation, thoughtful pauses before major revelations, and deep respect for the viewer's intelligence.`;

const SPORTS_DIRECTIVES = `CRITICAL DOMAIN DIRECTIVES (SPORTS DOCUMENTARY):
- STRICT CONCLUDED MATCH INVARIANT (ZERO LIVE / IN-PROGRESS SPECULATION):
  * Spoken narration must strictly cover a COMPLETED and CONCLUDED match where the final result, winner, and full scorecard are permanently recorded.
  * NEVER speculate on a live or currently ongoing match. If the match is in progress, do NOT invent a premature outcome.
- MANDATORY MATCH NUMBERS & SCORECARD CONTEXT (THE JOURNALISTIC ANCHOR):
  * Spoken narration MUST deliver the concrete real-world match figures, scoreboard situation, and individual statistics:
    1. Opponent's total score or target to chase (e.g. "Pakistan ne pehle batting karte hue 344 runs ka vishal score khada kiya").
    2. Exact match situation when player walked out to bat (e.g. "Sri Lanka ke 2 wickets sirf 28 run par gir chuke the").
    3. The player's exact individual milestone numbers (e.g. "Mendis ne sirf 77 gendon mein 122 run ki tabadtod paari kheli — jisme 14 chauke aur 6 chhakke shamil the").
    4. Required run rate, partnership numbers, and the ultimate match outcome.
  * STRICTLY BAN generic, abstract fluff ("unhone shandar paari kheli", "match bohot exciting tha") without backing it up with exact numbers, wickets, balls, and runs.
- STRICT SPORT ISOLATION & BAN ON UNRELATED SPORTS (CRICKET REALISM):
  * If the topic is Cricket (India team, BCCI, Gill, Iyer, Kohli, Rohit, IPL, Test/ODI/T20):
    - Visuals MUST accurately depict cricket-specific elements: 22-yard turf pitch, three upright wooden stumps with bails, red or white leather cricket ball, authentic wooden willow bat, batsman wearing protective leg pads and batting gloves, lush green oval stadium under towering floodlights.
    - ABSOLUTELY NEVER generate Baseball, baseball bats, baseball gloves, baseball diamonds, American football helmets/pads, Rugby balls, Tennis courts/rackets, running tracks, or basketball hoops.
- ORGANIC CRICKET SETTINGS & STRICT BAN ON RANDOM TECH/OFFICE SCENES:
  * Strategy and team planning scenes MUST be set in authentic cricket venues: team dugout benches, stadium dressing room / locker room with hung team jerseys and cricket kit bags, practice turf nets, or on-pitch team huddles.
  * ABSOLUTELY ZERO corporate glass cubicles, modern office meeting rooms, or CCTV security monitoring control rooms (which have zero organic relation to cricket).
- ELIMINATION OF ATHLETE FACE MORPHING & WARPED CELEBRITIES:
  * Diffusion models cannot render exact recognizable celebrity faces (e.g. Shubman Gill, Shreyas Iyer) without grotesque facial warping, melted eyes, and plastic skin.
  * MANDATORY FRAMING: Depict athletes in dynamic medium-to-wide action shots, over-the-shoulder perspectives, or dramatic silhouettes: e.g. batsman walking down pavilion stairs with bat under arm, adjusting batting gloves at the non-striker crease, team huddle seen from behind the captain's shoulder, or silhouetted against glowing stadium floodlights. NEVER prompt for macro facial portrait close-ups.
- AUTHENTIC ATHLETIC REALISM:
  * Visuals must accurately depict the specific sport being discussed. If cricket, depict green pitch, authentic cricket bats, red/white leather cricket ball, three wooden stumps. NEVER confuse cricket with baseball or American football helmets.
  * Ban cartoon/anime faces and distorted crowds. Use dynamic steadycam motion tracking athlete movements.
- ZERO AI TEXT IN DIFFUSION RULE:
  * NEVER render text on jerseys, scoreboards, or stadium hoardings. Describe them as: "unlabeled athletic team jerseys with clean solid color panels, glowing stadium floodlights, dynamic out-of-focus crowd with zero legible text or letters".
- HIGH ENERGY & PASSIONATE CADENCE:
  * Voiceover tone must be energetic, thrilling, and punchy, capturing the high-stakes drama of the match or tournament with rising pitch on clutch moments.`;

const HISTORY_DIRECTIVES = `CRITICAL DOMAIN DIRECTIVES (HISTORICAL INQUIRY):
- MANDATORY CHRONOLOGY & ARCHITECTURAL METRICS:
  * State exact centuries, dynasty names, estimated stone tonnages, and archaeological timelines (e.g. "8th century Rashtrakuta dynasty", "2 lakh ton basalt rock ko top-down kaat kar").
- AUTHENTIC ARCHITECTURAL & PERIOD REALISM:
  * Ancient stonework, weathered monolithic architecture, archaeological excavation trenches, atmospheric dust motes in stone corridors, warm volumetric sunlight.
  * Zero modern sports gear, zero plastic, zero cartoon aesthetics.
- ELIMINATION OF CHARACTER MORPHING:
  * Focus on monolithic structures, ancient tools, geological strata, carved stone relief without modern facial close-ups.
- ZERO AI TEXT IN DIFFUSION:
  * Abstract ancient chisel marks and weathered hieroglyphic silhouettes with zero modern legible letters or text.
- REVERENT, IMMERSIVE TONE:
  * Deep, resonant, captivating storytelling with deliberate pacing.`;

const NATURE_DIRECTIVES = `CRITICAL DOMAIN DIRECTIVES (NATURE & DEEP EARTH):
- NATURAL MAJESTY, REAL GEOGRAPHY & AUTHENTIC BIOME FIDELITY:
  * Strict Real-World Geography: The geographical region MUST match real-world geology and climate.
    - If Indian Peninsula/Deccan Traps/Western Ghats (e.g. Godavari, Krishna, Sahyadri): depict lush tropical monsoon foliage, dark volcanic basalt rocks, terraced emerald ghats, and fertile river basins. ABSOLUTELY ZERO red sandstone desert plateaus, Colorado canyons, Icelandic moss, or Martian rocks.
    - If Amazon: dense equatorial rainforest canopy, murky green river tributaries.
    - If Arctic/Antarctic: massive blue-ice glaciers, real snowpack physics.
  * Natural Fluid Dynamics & Water Physics:
    - Real fluid mechanics: turbulent foam, aerosol mist spray at the base of waterfalls, natural bow waves and wake displacement behind vessels, authentic water surface tension and light refraction.
    - Ban static extruded rubber water cylinders, unmoving wake decals, and vessels fused into dry riverbeds or cliff faces.
  * Zero sports gear, zero cartoon aesthetics, zero anime.
- ZERO TEXT & ZERO FAKE MAPS IN DIFFUSION:
  * ABSOLUTELY NEVER generate maps, cartographic lines, digital country outlines, or boundary plots in diffusion models (which hallucinates alien Balkan/Central Asian borders over Indian states).
  * Maps and satellite trajectory lines are added exclusively via clean GIS/vector graphics in post-production.
  * Visual prompts for terrain must depict authentic physical aerial drone shots of real landscapes, not computer screen maps.
- AWE-INSPIRING TONE:
  * Contemplative, immersive documentary narration.`;

const GENERAL_DIRECTIVES = `CRITICAL DOMAIN DIRECTIVES (GEOPOLITICAL & GENERAL DOCUMENTARY):
- AUTHENTIC ARCHITECTURAL & VENUE FIDELITY:
  * Real-World Venues & Assemblies: If depicting historical or diplomatic venues (e.g. UN Security Council, Geneva, Supreme Court):
    - Replicate iconic architectural layouts: UNSC must feature the famous Per Krohg mural, circular delegate table with central horseshoe layout, and retro blue acoustic wall panels. Never substitute with generic curved corporate boardrooms.
- AIRPORT RUNWAY & TRANSPORT CIVIL REALISM:
  * Airport runways (including coastal airports like Trivandrum TRV) MUST strictly be depicted as grounded, flat asphalt or concrete runways on solid terra firma mainland, flanked by green tropical palm vegetation, airport perimeter fencing, and taxiway guidance lights.
  * ABSOLUTELY NEVER generate airport runways as suspension bridges, oceanic piers, elevated stilts over water, or sea bridges.
  * Flight Information Display Systems (FIDS), departure boards, and gate displays must NEVER attempt to render legible flight numbers or letters (which creates corrupt alien text). Specify: "unlabeled architectural glass airport terminal, illuminated abstract amber status indicator lights, silhouettes of passengers with luggage looking through glass at taxiing aircraft, zero text, zero letters, zero numbers".
- SACRED PROCESSIONS & CEREMONIAL TRADITIONS (PHYSICS & ANATOMY FIDELITY):
  * When depicting temple processions (e.g. Arattu, Rath Yatra, royal palanquins):
    - Frame in wide cinematic angles with slow majestic steadicam push-in, warm evening golden-hour or flaming torchlight (Mashaal) illumination, devotees wearing traditional ivory/gold Kerala Kasavu garments on solid ground.
    - BAN dynamic flailing swords, floating drums, or rubbery wheels. Keep temple drums (Chenda) and sacred umbrellas naturally resting or carried steadily on solid ground.
- SHIP, HARBOR & STRUCTURAL PHYSICS FIDELITY:
  * Physical Spatial Logic: Ships and marine vessels MUST strictly float in navigable waterways, open seas, or harbor basins with realistic bow wakes.
  * ABSOLUTELY NEVER place cargo ships or port container cranes in inland agricultural wheat fields, dry dirt, or wedged inside sheer cliff walls.
  * Bridge and infrastructure structures must be structurally anchored into bedrock or concrete piers; zero disconnected floating pillars or roadways vanishing mid-air into water.
- ANATOMICAL FIDELITY & NO GHOSTING/WARPING:
  * Hand and Typing Realism: In close-up shots of keyboards or machinery, fingers must be naturally separated and press keys mechanically. Ban fused finger joints, rubber hands, or hands merging into rocks/tools.
  * Face & Head Stability: When characters wear headphones or glasses, frames and headbands must stay rigid and distinct from ear tissue and hair. Ban face morphing and walking ghost trails.
- ZERO AI TEXT & GIBBERISH UI IN DIFFUSION:
  * ABSOLUTELY NEVER generate text on screen monitors, price tags, navigation dashboards, market boards, or presentation slides.
  * Specify: "unlabeled glowing navigation instruments, abstract clean radar rings, ambient volumetric HUD glow with zero text, zero letters, zero numbers, zero pseudocode".
- AUTHENTIC CINEMATIC REALISM:
  * Modern digital documentary cinematography, authentic textures, balanced natural lighting.
  * Zero sports gear unless the topic is sports; zero cartoon/anime aesthetics.
- ENGAGING, DYNAMIC TONE:
  * Clear, authoritative, intelligent pacing.`;

/**
 * Returns strict visual and tonal prompt directives tailored to the domain.
 */
export function getDomainPromptDirectives(domain: VideoDomain): string {
  switch (domain) {
    case "science":
    case "space":
    case "technology":
      return SCIENCE_TECH_DIRECTIVES(domain);
    case "sports":
      return SPORTS_DIRECTIVES;
    case "history":
      return HISTORY_DIRECTIVES;
    case "nature":
      return NATURE_DIRECTIVES;
    default:
      return GENERAL_DIRECTIVES;
  }
}
