import type { VideoDomain } from "./types.js";

/**
 * Detects the intellectual domain of the topic to enforce strict authentic aesthetics,
 * prevent inappropriate cross-domain tropes (e.g. sports gear in science videos),
 * and calibrate narration tone and pacing.
 */
/**
 * Comprehensive detection for Cricket and Sports matchups, tournaments, teams, and stadiums.
 * Avoids single ambiguous words (e.g. "series", "final", "pitch", "target", "cup", bare country names)
 * that falsely trigger on space, tech, geopolitical, or business topics (GEMINI.md Rule 13).
 */
export function isSportsOrCricket(text: string, trendReason?: string): boolean {
  const combined = `${text} ${trendReason || ""}`.toLowerCase();

  // 1. Unambiguous sports & athletic nomenclature
  if (/\b(cricket|football|soccer|fifa|ipl|wpl|bcci|icc|scorecard|wicket|wickets|batsman|bowler|bowling|batting|stumps|bails|crease|cricket pitch|turf pitch|tri-series|super over|powerplay|champions trophy|world cup|olympics|athlete|athletics|badminton|formula 1|formula one|\bf1\b|grand prix|pole position|tennis court|wimbledon|us open|australian open|french open)\b/i.test(combined)) {
    return true;
  }

  // 2. Iconic sports teams, clubs, and sports arenas
  if (/\b(arsenal|chelsea|tottenham|liverpool|manchester united|manchester city|real madrid|barcelona|psg|bayern munich|wankhede|eden gardens|lords cricket ground|mcg|scg)\b/i.test(combined)) {
    return true;
  }

  // 3. Iconic sports stars (full names or unambiguous sports entities)
  if (/\b(cristiano ronaldo|messi|mbappe|haaland|virat kohli|rohit sharma|ms dhoni|jasprit bumrah|shubman gill|hardik pandya|rishabh pant|babar azam|rashid khan|max verstappen|lewis hamilton)\b/i.test(combined)) {
    return true;
  }

  // 4. Head-to-head match patterns: e.g. "India vs Pakistan", "Arsenal vs Chelsea"
  if (/\b(vs|v\/s)\b/i.test(combined) && /\b(match|game|final|trophy|cup|series|derby|clash)\b/i.test(combined)) {
    return true;
  }

  return false;
}

export function detectVideoDomain(topic: string, trendReason?: string): VideoDomain {
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

  // Sports pattern
  if (isSportsOrCricket(topic, trendReason)) {
    return "sports";
  }

  // Nature / Earth pattern
  if (/\b(ocean|deep sea|abyss|marianas trench|volcano|earthquake|wildlife|glacier|antarctica|ecosystem|biodiversity|forest|coral reef|species|amazon rainforest|geology)\b/i.test(combined)) {
    return "nature";
  }

  // History / Archaeology pattern
  if (/\b(history|ancient|civilization|archaeology|excavation|dynasty|temple|pyramid|empire|monument|ruins|century|medieval|bronze age|indus valley|harappa|mohenjo|sculpture|inscriptions)\b/i.test(combined)) {
    return "history";
  }

  return "general";
}

const SCIENCE_TECH_DIRECTIVES = (_domain: VideoDomain): string => `CRITICAL DOMAIN DIRECTIVES (INTELLECTUAL DOCUMENTARY):
- AUTHENTIC REAL-WORLD VENUE FIDELITY (MANDATORY — LET THE TOPIC DETERMINE THE SETTING):
  * Ground ALL visual scenes in the authentic physical venue where this specific topic's events actually take place.
  * NEVER impose stereotyped settings: a corporate acquisition or billion-dollar business deal happens in boardrooms, trading floors, and glass-tower executive corridors — NOT in silicon cleanrooms.
  * Semiconductor fabrication topics happen in ISO cleanrooms. Business mergers happen in boardrooms. Policy debates happen in legislative chambers. Space missions happen at launch pads and mission control. Let the topic determine the setting.
- MANDATORY HARD SCIENTIFIC AND FACTUAL METRICS (CONCRETE NUMBERS):
  * Spoken narration MUST state concrete, real-world measurements and facts rather than vague descriptions: exact distances, dollar amounts, percentages, dates, company names, and verified milestones.
  * STRICTLY BAN vague fluff ("bohot bada tha", "bahut bada deal tha"); anchor every scene with real, verifiable facts and numbers.
- STRICT BAN ON SPORTS, ATHLETICS & CARTOONS:
  * ABSOLUTELY ZERO sports footage, cricket bats, balls, pads, wickets, footballs, athletic jerseys, referee uniforms, scoreboards, or stadium crowds.
  * ABSOLUTELY ZERO anime, cartoon, manga, or comic caricature characters.
- ZERO AI TEXT IN DIFFUSION RULE (MANDATORY):
  * Diffusion models must NEVER attempt to render legible text, letters, numerals, words, or pseudocode in the image.
  * Every monitor, screen, or display MUST be described as: "unlabeled glowing abstract telemetry monitors, ambient volumetric HUD glow with zero text, zero letters, zero numbers".
- CINEMATIC REALISM & VISUAL QUALITY:
  * Modern digital documentary cinematography: authentic textures, natural cinematic lighting, balanced composition, 35mm lens depth of field.
  * NEVER grotesque, violent, or horror depictions. Focus on the authentic physical reality of this specific topic.
- ELIMINATION OF CHARACTER WARPING & FACE MORPHING:
  * For science and space documentaries, NEVER generate recurring human face close-ups across cuts (which causes horrific AI face warping).
  * Keep visuals focused on the physical phenomenon, instruments, or researchers seen from wide angles or silhouettes.
- AUDIO TONE, CADENCE & INTELLIGENT ENERGY:
  * Voiceover tone must be measured, cerebral, awe-inspiring, and authoritative (in the style of Cosmos / Veritasium / Think School / Brian Cox).
  * NOT screaming sports commentary or shallow reel hype. Deliver intellectual insight with dynamic pitch variation.`;

const SPORTS_DIRECTIVES = `CRITICAL DOMAIN DIRECTIVES (SPORTS DOCUMENTARY):
- AUTHENTIC ATHLETIC VENUE FIDELITY (MANDATORY — LET THE TOPIC DETERMINE THE SETTING):
  * Ground ALL visual scenes strictly in the authentic athletic venue physically native to the specific sport being covered (e.g. football stadium and pitch for football; cricket oval and turf pitch for cricket; racing circuit and pit lane for motorsport; hard/clay court for tennis; athletics track or aquatics center for Olympic events).
  * NEVER cross-contaminate sports equipment: do NOT generate baseball bats or football helmets in cricket, nor tennis rackets on football pitches. Let the specific sport dictate equipment and apparel.
  * Contextual strategy scenes MUST take place in authentic venues native to the sport (team locker rooms, dugouts, pit garages, practice training grounds).
- STRICT CONCLUDED MATCH INVARIANT (GEMINI.md Rule 14 — ZERO LIVE SPECULATION):
  * Spoken narration must strictly cover a COMPLETED and CONCLUDED match or tournament where the final result, winner, and full scorecard are permanently recorded.
  * NEVER speculate on a live or in-progress match. If an event is underway, do NOT invent a premature outcome.
- MANDATORY MATCH METRICS & SCORECARD CONTEXT:
  * Spoken narration MUST deliver concrete real-world figures: final scores, run rates, times, goals, margins of victory, and individual player milestones.
  * STRICTLY BAN generic, abstract fluff ("unhone shandar paari kheli", "match bohot exciting tha") without concrete backing numbers.
- ELIMINATION OF ATHLETE FACE MORPHING & WARPED CELEBRITIES:
  * Diffusion models cannot render exact recognizable celebrity faces without grotesque facial warping.
  * MANDATORY FRAMING: Depict athletes in dynamic medium-to-wide action shots, over-the-shoulder perspectives, or dramatic silhouettes. NEVER prompt for macro facial portrait close-ups.
- ZERO AI TEXT IN DIFFUSION RULE:
  * NEVER render legible text on jerseys, scoreboards, or stadium hoardings. Describe them as: "unlabeled athletic team jerseys with clean solid color panels, glowing stadium floodlights, dynamic out-of-focus crowd with zero legible text or letters".
- HIGH ENERGY & BROADCAST CADENCE:
  * Voiceover tone must be energetic, thrilling, and punchy, capturing high-stakes athletic drama with rising pitch on clutch moments.`;

const HISTORY_DIRECTIVES = `CRITICAL DOMAIN DIRECTIVES (HISTORICAL INQUIRY):
- AUTHENTIC PERIOD & VENUE FIDELITY (MANDATORY — LET THE TOPIC DETERMINE THE SETTING AND ERA):
  * Ground ALL visual scenes in the authentic architecture, technology, materials, and geography native to the exact historical era and culture being covered.
  * NEVER stereotype all history into generic ancient stone excavations. Let the historical era dictate the setting:
    - Ancient & Classical: period-accurate stone masonry, terracotta, ancient colonnades, excavation trenches.
    - Medieval & Early Modern: timber-and-stone fortifications, royal court halls, guild workshops, period sailing vessels.
    - Industrial & Modern: 19th-century brick factories, iron foundries, archival legislative chambers, vintage dockyards.
- MANDATORY CHRONOLOGY & VERIFIED METRICS:
  * State exact centuries, calendar years, verified archaeological dates, documented figures, and architectural dimensions.
  * STRICTLY BAN vague historical fluff ("bohot purane zamane ki baat hai"); anchor every scene with real historical chronology.
- STRICT ELIMINATION OF ANACHRONISMS:
  * ABSOLUTELY ZERO modern synthetic materials (plastics, modern sports gear, wristwatches, modern corporate glass towers) in historical scenes unless the topic explicitly bridges past and present.
- ANTI-MORPHING FRAMING & TACTILE MATERIALS:
  * Focus on architectural scale, environmental panoramas, authentic period garments, tools, and weathered relief carvings. Avoid modern facial close-ups.
- ZERO AI TEXT & FAKE GLYPHS IN DIFFUSION:
  * Abstract weathered chisel marks, distressed parchment, or relief silhouettes with zero modern legible letters or pseudo-hieroglyphic text.
- REVERENT, IMMERSIVE TONE:
  * Deep, resonant, captivating storytelling with deliberate pacing and intellectual gravity.`;

const NATURE_DIRECTIVES = `CRITICAL DOMAIN DIRECTIVES (NATURE & DEEP EARTH):
- AUTHENTIC BIOME & GEOGRAPHICAL FIDELITY (MANDATORY — LET THE TOPIC DETERMINE THE SETTING AND BIOME):
  * Ground all landscapes and ecological scenes strictly in the native biome, topography, and climate of the specific geographic region.
  * NEVER cross-contaminate disparate biomes: do NOT depict desert sandstone plateaus in tropical river basins; do NOT depict alpine pine forests in equatorial savannahs; do NOT introduce alien geology. Let the topic's true geography determine the environment.
- NATURAL FLUID DYNAMICS & PHYSICAL REALISM:
  * Real fluid mechanics: turbulent foam and aerosol mist spray at waterfalls, natural bow waves and wake displacement behind vessels, authentic water surface tension and light refraction.
  * Animals and natural elements must behave naturally in their organic habitat with realistic physical gravity.
- ZERO DIFFUSION MAPS RULE:
  * ABSOLUTELY NEVER generate maps, cartographic lines, digital country outlines, or boundary plots in diffusion models (which hallucinates alien/distorted borders).
  * Visual prompts for terrain must depict authentic physical aerial drone/satellite photography of real topography. Maps belong exclusively in post-production graphics.
- ZERO CROSS-DOMAIN CONTAMINATION:
  * ABSOLUTELY ZERO sports gear, zero modern plastic litter, zero cartoon or anime aesthetics.
- AWE-INSPIRING TONE:
  * Contemplative, immersive documentary narration with deep reverence for the natural world.`;

const GENERAL_DIRECTIVES = `CRITICAL DOMAIN DIRECTIVES (GEOPOLITICAL & GENERAL DOCUMENTARY):
- AUTHENTIC REAL-WORLD VENUE & PHYSICAL REALISM (MANDATORY — LET THE TOPIC DETERMINE THE SETTING):
  * Ground ALL scenes in the authentic physical venue native to the subject. Let the topic dictate the setting:
    - Diplomatic & geopolitical summits: formal international assembly halls, multilateral conference tables, diplomatic corridors.
    - Corporate & financial developments: executive boardrooms, modern financial trading floors, minimalist corporate atriums.
    - Civil transportation & aviation: grounded flat concrete runways on terra firma, modern glass-and-steel airport terminals. NEVER fabricate impossible structures (like runways on oceanic stilts or bridges vanishing mid-air).
    - Maritime & logistics: ships floating naturally in open waters or industrial shipping harbors with realistic wake dynamics. NEVER place maritime vessels in inland terrain.
    - Cultural & traditional heritage: authentic local architecture, traditional period-appropriate attire, and dignified cultural ceremonies native to the specific tradition.
- PHYSICAL & STRUCTURAL ENGINEERING LOGIC:
  * Infrastructure (bridges, towers, runways) must be firmly anchored to bedrock or ground foundations; zero detached floating roadways or impossible physics.
- ZERO AI TEXT & GIBBERISH UI IN DIFFUSION:
  * ABSOLUTELY NEVER generate legible text on monitors, flight boards, market tickers, price tags, or presentation slides.
  * Specify: "unlabeled glowing displays, abstract clean data visualization, ambient volumetric HUD glow with zero text, zero letters, zero numbers, zero pseudocode".
- ANATOMICAL FIDELITY & NO GHOSTING:
  * Natural anatomical proportions (separated fingers, natural posture, rigid eyewear distinct from facial tissue). Avoid walking ghost trails and morphing faces.
- CINEMATIC REALISM & BALANCED COMPOSITION:
  * Modern digital documentary cinematography, authentic tactile textures, balanced natural lighting, 35mm lens depth of field.
  * Zero sports gear unless the topic is sports; zero cartoon/anime aesthetics.
- ENGAGING, DYNAMIC TONE:
  * Clear, authoritative, intelligent pacing that respects the viewer's intelligence.`;

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
