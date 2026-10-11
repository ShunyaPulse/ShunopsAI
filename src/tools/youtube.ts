import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";

interface YouTubeUploadOptions {
  videoPath: string;
  metaPath?: string | undefined;
  thumbnailPath?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  privacyStatus?: "private" | "unlisted" | "public" | undefined;
  categoryId?: string | undefined;
  language?: string | undefined;
}

interface YouTubeUploadResult {
  ok: boolean;
  videoId?: string | undefined;
  videoUrl?: string | undefined;
  studioUrl?: string | undefined;
  title?: string | undefined;
  privacyStatus?: string | undefined;
  thumbnailSet?: boolean | undefined;
  error?: string | undefined;
}

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Exchange refresh_token for a fresh Google OAuth2 access_token.
 */
export async function getYouTubeAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && tokenExpiresAt > now + 60000) {
    return cachedAccessToken;
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    throw new Error("Missing YOUTUBE_CLIENT_ID or GOOGLE_CLIENT_ID in environment.");
  }
  if (!refreshToken) {
    throw new Error(
      "Missing YOUTUBE_REFRESH_TOKEN. Run 'npx tsx src/tools/youtube-auth.ts' once to authorize your YouTube channel."
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = (await res.json()) as any;
  if (!res.ok || !data.access_token) {
    throw new Error(`Failed to refresh YouTube access token: ${JSON.stringify(data)}`);
  }

  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedAccessToken as string;
}

/**
 * Uploads a custom thumbnail to a published/private YouTube video.
 */
export async function setYouTubeThumbnail(videoId: string, thumbnailPath: string, accessToken: string): Promise<boolean> {
  try {
    const fileBytes = await fs.readFile(thumbnailPath);
    const mimeType = thumbnailPath.endsWith(".png") ? "image/png" : "image/jpeg";

    const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mimeType,
      },
      body: fileBytes,
    });

    if (!res.ok) {
      console.warn("[YouTube] Warning: failed to set custom thumbnail: [REDACTED]");
      return false;
    }
    console.log(`[YouTube] Successfully set custom thumbnail for video ${videoId}`);
    return true;
  } catch {
    console.warn("[YouTube] Thumbnail error: [REDACTED]");
    return false;
  }
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Checks if a video with a matching title already exists on the user's YouTube channel.
 * Prevents accidental duplicate re-uploads.
 */
export async function findExistingVideoByTitle(
  candidateTitle: string,
  accessToken: string
): Promise<{ exists: boolean; videoId?: string; title?: string }> {
  try {
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/search?forMine=true&type=video&maxResults=50&part=snippet",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) return { exists: false };
    const data = (await res.json()) as any;
    const normTarget = normalizeTitle(candidateTitle);

    for (const item of data.items || []) {
      const existingTitle = item.snippet?.title || "";
      const existingNorm = normalizeTitle(existingTitle);
      const vid = item.id?.videoId;
      if (!vid) continue;

      if (
        normTarget === existingNorm ||
        (normTarget.length > 20 && existingNorm.length > 20 && (normTarget.includes(existingNorm) || existingNorm.includes(normTarget)))
      ) {
        return {
          exists: true,
          videoId: vid,
          title: existingTitle,
        };
      }
    }
  } catch (err: any) {
    console.warn(`[YouTube] Duplicate check warning: ${err?.message ? "[REDACTED]" : "none"}`);
  }
  return { exists: false };
}

/**
 * Uploads a video to YouTube using Resumable Upload protocol.
 * Defaults to private visibility for review before publishing.
 */
export async function uploadToYouTube(options: YouTubeUploadOptions): Promise<YouTubeUploadResult> {
  try {
    const { videoPath, metaPath, thumbnailPath } = options;
    const privacyStatus = options.privacyStatus || "private";

    if (!fsSync.existsSync(videoPath)) {
      return { ok: false, error: `Video file not found at: ${videoPath}` };
    }

    let title = options.title;
    let description = options.description;
    let tags = options.tags || [];

    let language = options.language;

    // Load metadata if available
    if (metaPath && fsSync.existsSync(metaPath)) {
      try {
        const raw = await fs.readFile(metaPath, "utf-8");
        const meta = JSON.parse(raw);
        title = title || meta.title;
        description = description || meta.description;
        language = language || meta.language;
        if (!tags.length && Array.isArray(meta.tags)) {
          tags = meta.tags;
        }
      } catch {
        console.warn("[YouTube] Could not parse meta.json: [REDACTED]");
      }
    }

    const langCode = (/hindi/i.test(language || "") || /^hi/i.test(language || "")) ? "hi" : "en";
    title = (title || path.basename(videoPath, path.extname(videoPath))).slice(0, 100);
    description = description || `Uploaded automatically by Autonomous AI Video Agent.\n\n#AI #Technology #Documentary`;
    const categoryId = options.categoryId || "28"; // 28 = Science & Technology, 27 = Education

    const accessToken = await getYouTubeAccessToken();

    // Guardrail: Ensure video is not already present on channel
    const duplicate = await findExistingVideoByTitle(title, accessToken);
    if (duplicate.exists && duplicate.videoId) {
      console.log(`[YouTube] 🛑 Duplicate prevented: Video with matching title already exists on channel: "${duplicate.title}" (ID: ${duplicate.videoId}). Skipping upload.`);
      return {
        ok: true,
        videoId: duplicate.videoId,
        videoUrl: `https://youtu.be/${duplicate.videoId}`,
        studioUrl: `https://studio.youtube.com/video/${duplicate.videoId}/edit`,
        title: duplicate.title,
        privacyStatus: "existing",
        thumbnailSet: false,
      };
    }

    const stats = await fs.stat(videoPath);
    const fileSize = stats.size;

    console.log('[YouTube] Initiating resumable upload for "[REDACTED]" (' + (fileSize / 1024 / 1024).toFixed(1) + ' MB)...');
    console.log(`[YouTube] Privacy status: ${privacyStatus.toUpperCase()} | Language: ${langCode} | AI Use: YES | Likes Public: NO`);

    // Step 1: Initiate resumable session (inherits user's YouTube Studio Upload Defaults)
    const snippet = {
      title,
      description,
      tags: tags.slice(0, 20),
      categoryId,
    };

    const metadata = {
      snippet,
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
        publicStatsViewable: false, // Turn OFF extended stats
        containsSyntheticMedia: true, // Always "YES" for AI use disclosure
      },
      paidProductPlacementDetails: {
        hasPaidProductPlacement: false, // Paid promotion: ALWAYS NO
      },
    };

    let videoId = "";
    const maxAttempts = 3;
    let lastError = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`[YouTube] Retry attempt ${attempt}/${maxAttempts} after transient network reset...`);
          await new Promise((r) => setTimeout(r, 4000 * attempt));
        }

        const currentToken = await getYouTubeAccessToken();
        const initRes = await fetch(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status,paidProductPlacementDetails",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${currentToken}`,
              "Content-Type": "application/json; charset=UTF-8",
              "X-Upload-Content-Length": String(fileSize),
              "X-Upload-Content-Type": "video/mp4",
            },
            body: JSON.stringify(metadata),
          }
        );

        if (!initRes.ok) {
          const errText = await initRes.text();
          lastError = `Failed to initiate YouTube upload: ${errText}`;
          continue;
        }

        const uploadUrl = initRes.headers.get("Location") || initRes.headers.get("location");
        if (!uploadUrl) {
          lastError = "YouTube did not return a resumable Location upload URL.";
          continue;
        }

        // Step 2: Upload the video file binary
        console.log(`[YouTube] Uploading video content (${(fileSize / 1024 / 1024).toFixed(1)} MB)...`);
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);

        const { stdout, stderr } = await execFileAsync(
          "curl",
          [
            "-sS",
            "--http1.1",
            "-X",
            "PUT",
            "-T",
            videoPath,
            "-H",
            "Content-Type: video/mp4",
            "-H",
            `Content-Length: ${fileSize}`,
            uploadUrl,
          ],
          { maxBuffer: 20 * 1024 * 1024, timeout: 900000 }
        );

        let uploadData: any;
        try {
          uploadData = JSON.parse(stdout);
        } catch {
          lastError = `YouTube upload failed: ${stdout || stderr}`;
          continue;
        }

        if (uploadData.id) {
          videoId = uploadData.id;
          break;
        } else {
          lastError = `YouTube upload completed but video ID was not returned: ${JSON.stringify(uploadData)}`;
        }
      } catch (uploadErr: any) {
        lastError = uploadErr.message;
        console.warn(`[YouTube] Upload attempt ${attempt} warning: [REDACTED]`);
      }
    }

    if (!videoId) {
      return { ok: false, error: lastError || "YouTube upload failed after multiple attempts." };
    }

    const videoUrl = `https://youtu.be/${videoId}`;
    const studioUrl = `https://studio.youtube.com/video/${videoId}/edit`;
    console.log(`[YouTube] ✅ Video upload SUCCESSFUL!`);
    console.log(`[YouTube] Video ID: ${videoId}`);
    console.log(`[YouTube] Private URL: ${videoUrl}`);
    console.log(`[YouTube] Studio Editor: ${studioUrl}`);

    // Step 3: Set custom thumbnail if provided
    let thumbnailSet = false;
    let targetThumbnail = thumbnailPath;
    if (!targetThumbnail && metaPath) {
      // Auto-detect sibling frame thumbnails
      const dir = path.dirname(metaPath);
      const candidates = ["thumbnail.jpg", "thumbnail.png", "frame_30s.jpg", "frame_15s.jpg", "frame_03s.jpg"];
      for (const c of candidates) {
        const p = path.join(dir, c);
        if (fsSync.existsSync(p)) {
          targetThumbnail = p;
          break;
        }
      }
    }

    if (targetThumbnail && fsSync.existsSync(targetThumbnail)) {
      console.log('[YouTube] Uploading custom thumbnail: [REDACTED]...');
      thumbnailSet = await setYouTubeThumbnail(videoId, targetThumbnail, accessToken);
    }

    return {
      ok: true,
      videoId,
      videoUrl,
      studioUrl,
      title,
      privacyStatus,
      thumbnailSet,
    };
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
}
