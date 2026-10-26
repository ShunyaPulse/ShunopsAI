import * as fs from "node:fs";
import * as path from "node:path";

const scriptPath = path.resolve("jobs", "mvp37a5f", "dataset", "script.json");
const script = JSON.parse(fs.readFileSync(scriptPath, "utf8"));

for (const sc of script.scenes) {
  // Replace the forced 35mm film live-action text with the 3D cinematic render style
  sc.visual_prompt = sc.visual_prompt
    .replace(
      /Cinematic 35mm film photograph, highly detailed photorealistic live-action historical drama, 8k resolution, authentic natural directional lighting, rich tactile textures, subtle 35mm film grain, hyper-realistic cinematography\.\s*/gi,
      "Cinematic 3D render, volumetric dramatic lighting, photorealistic textures, 8k resolution. "
    )
    .replace(/,\s*CGI 3D render/gi, "")
    .replace(/CGI 3D render,\s*/gi, "")
    .replace(/35mm film still/gi, "cinematic 3D render")
    .replace(/35mm film grain/gi, "volumetric lighting");
}

fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), "utf8");
console.log("Successfully reverted script.json to 3D cinematic style (strictly banning 2D/cartoon, preserving 3D).");

