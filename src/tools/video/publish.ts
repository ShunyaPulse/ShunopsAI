import * as fsSync from "node:fs";
import * as path from "node:path";
import { uploadToYouTube } from "../youtube.js";
import { JOBS_DIR } from "./job.js";
import type { VideoPrivacy } from "./types.js";

const THUMBNAIL_CANDIDATES = [
  "thumbnail.jpg",
  "thumbnail.png",
  "frame_30s.jpg",
  "frame_15s.jpg",
  "frame_03s.jpg",
  "frame_45s.jpg",
];

const THUMBNAIL_GEN_SCRIPT = `
import cv2, sys
from PIL import Image, ImageDraw
video_p, out_p = sys.argv[1], sys.argv[2]
cap = cv2.VideoCapture(video_p)
fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
cap.set(cv2.CAP_PROP_POS_FRAMES, int(fps * 15))
ret, frame = cap.read()
cap.release()
if ret:
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).resize((1280, 720), Image.Resampling.LANCZOS)
    overlay = Image.new('RGBA', (1280, 720), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for y in range(480, 720):
        odraw.line([(0, y), (1280, y)], fill=(0, 0, 0, int((y - 480) / 240 * 185)))
    img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
    img.save(out_p, quality=95)
`;

/** Resolve a job id or path to its output directory, refusing escapes from jobs/. */
function resolveJobOutputDir(jobDirOrId: string): string {
  const cleanInput = jobDirOrId.trim();
  const isDirect = path.isAbsolute(cleanInput) || cleanInput.includes("/") || cleanInput.includes("\\");
  const targetDir = isDirect
    ? path.resolve(JOBS_DIR, cleanInput)
    : path.resolve(JOBS_DIR, cleanInput.replace(/[^a-zA-Z0-9_-]/g, ""), "output");

  const relToJobs = path.relative(JOBS_DIR, targetDir);
  if (relToJobs.startsWith("..") || path.isAbsolute(relToJobs)) {
    throw new Error("Refused: target video job directory must reside inside the jobs directory.");
  }
  return targetDir;
}

function findThumbnail(targetDir: string): string | undefined {
  return THUMBNAIL_CANDIDATES.map((f) => path.join(targetDir, f)).find((f) => fsSync.existsSync(f));
}

/** Generate a thumbnail from the video when the job produced none. */
async function generateFallbackThumbnail(targetDir: string, videoPath: string): Promise<string | undefined> {
  if (!fsSync.existsSync(videoPath)) return undefined;
  try {
    const outThumbPath = path.join(targetDir, "thumbnail.jpg");
    const { execFileSync } = await import("node:child_process");
    execFileSync("python", ["-c", THUMBNAIL_GEN_SCRIPT, videoPath, outThumbPath]);
    return fsSync.existsSync(outThumbPath) ? outThumbPath : undefined;
  } catch (e: any) {
    console.warn(`[Video] Fallback thumbnail generation warning: ${e.message}`);
    return undefined;
  }
}

/**
 * Automatically publishes a rendered video job to YouTube with private visibility.
 */
export async function publishJobToYouTube(
  jobDirOrId: string,
  privacy: VideoPrivacy = "private"
): Promise<string> {
  const targetDir = resolveJobOutputDir(jobDirOrId);
  const videoPath = path.join(targetDir, "video.mp4");
  const metaPath = path.join(targetDir, "meta.json");

  const thumbnailPath =
    findThumbnail(targetDir) ?? (await generateFallbackThumbnail(targetDir, videoPath));

  const result = await uploadToYouTube({
    videoPath,
    metaPath,
    thumbnailPath,
    privacyStatus: privacy,
  });

  return JSON.stringify(result, null, 2);
}
