import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { kaggle } from "../../tools/video.js";
import { generateNCERTScript } from "./generate-ncert-script.js";

const EXPERIMENT_RENDER_SRC = path.resolve(process.cwd(), "src", "experiments", "ncert", "render-ncert.py");
const JOBS_DIR = path.resolve(process.cwd(), "jobs");

export async function launchNCERTJob(): Promise<{ jobId: string; kernel: string; title: string; scenes: number }> {
  const user = process.env.VIDEO_KAGGLE_USERNAME || process.env.KAGGLE_USERNAME || "shunyapulse";
  if (!user) throw new Error("KAGGLE_USERNAME is not set in environment.");

  console.log("[NCERT Launch] Generating authentic NCERT script with Gemini...");
  const script = await generateNCERTScript();

  const id = Date.now().toString(36);
  const jobDir = path.join(JOBS_DIR, id);
  const dsDir = path.join(jobDir, "dataset");
  const kDir = path.join(jobDir, "kernel");

  await fs.mkdir(dsDir, { recursive: true });
  await fs.mkdir(kDir, { recursive: true });

  await fs.writeFile(path.join(dsDir, "script.json"), JSON.stringify(script, null, 2));
  await fs.writeFile(
    path.join(dsDir, "dataset-metadata.json"),
    JSON.stringify({
      title: `ncert video job ${id}`,
      id: `${user}/video-job-${id}`,
      licenses: [{ name: "CC0-1.0" }],
      is_private: true,
    })
  );
  await fs.writeFile(
    path.join(dsDir, "config.json"),
    JSON.stringify({
      groq_api_key: process.env.GROQ_API_KEY || "",
      hf_token: process.env.HF_TOKEN || "",
    }, null, 2)
  );

  // Copy experimental renderer (leaving video/kernel/render.py completely untouched)
  await fs.copyFile(EXPERIMENT_RENDER_SRC, path.join(kDir, "render.py"));

  await fs.writeFile(
    path.join(kDir, "kernel-metadata.json"),
    JSON.stringify({
      id: `${user}/video-render-${id}`,
      title: `video render ${id}`,
      code_file: "render.py",
      language: "python",
      kernel_type: "script",
      is_private: true,
      enable_gpu: true,
      enable_internet: true,
      dataset_sources: [`${user}/video-job-${id}`],
    })
  );

  console.log(`[NCERT Launch] Uploading dataset to Kaggle (${user}/video-job-${id})...`);
  const dsRes = await kaggle(["datasets", "create", "-p", dsDir]);
  console.log("[NCERT Launch] Dataset create response:", dsRes);

  console.log("[NCERT Launch] Waiting 20s for Kaggle dataset provisioning...");
  await new Promise((r) => setTimeout(r, 20000));

  console.log(`[NCERT Launch] Pushing kernel ${user}/video-render-${id} to Kaggle GPU...`);
  const pushRes = await kaggle(["kernels", "push", "-p", kDir]);
  console.log("[NCERT Launch] Kernel push response:", pushRes);

  return {
    jobId: id,
    kernel: `${user}/video-render-${id}`,
    title: script.title,
    scenes: script.scenes.length,
  };
}

async function main() {
  const result = await launchNCERTJob();
  console.log("\n=======================================================");
  console.log("🚀 [NCERT Launch] Pilot Video Render Successfully Dispatched!");
  console.log(`Job ID: ${result.jobId}`);
  console.log(`Kernel: ${result.kernel}`);
  console.log(`Title: ${result.title}`);
  console.log(`Scenes: ${result.scenes}`);
  console.log("=======================================================\n");
}

const isCLI = process.argv[1]?.endsWith("launch-ncert-job.ts") || process.argv[1]?.endsWith("launch-ncert-job.js");
if (isCLI) {
  main().catch((err) => {
    console.error("[NCERT Launch Error]", err);
    process.exit(1);
  });
}

