import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { GoogleAuth } from "google-auth-library";

const DEFAULT_GCS_BUCKET = process.env.GCS_ASSETS_BUCKET || process.env.GCS_BUCKET || "shunops-bgm-assets-422513";

let cachedAuth: GoogleAuth | null = null;

function getGoogleAuth(): GoogleAuth | null {
  if (cachedAuth) return cachedAuth;
  const credsJson = process.env.GCP_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsJson) return null;

  try {
    const credentials = typeof credsJson === "string" && credsJson.trim().startsWith("{")
      ? JSON.parse(credsJson)
      : JSON.parse(Buffer.from(credsJson, "base64").toString("utf-8"));
    cachedAuth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
    });
    return cachedAuth;
  } catch (err: any) {
    console.warn(`[GCS Vault] Warning: Failed to parse GCP credentials: ${err.message}`);
    return null;
  }
}

/**
 * Computes a deterministic topic hash for stable asset caching
 */
export function getTopicHash(topic: string, language = "Hindi"): string {
  return crypto
    .createHash("sha256")
    .update(`${topic.trim().toLowerCase()}_${language.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Checks if a remote GCS asset exists via fast public or authenticated HEAD request
 */
export async function gcsAssetExists(remotePath: string, bucket = DEFAULT_GCS_BUCKET): Promise<boolean> {
  const publicUrl = `https://storage.googleapis.com/${bucket}/${encodeURI(remotePath)}`;
  try {
    const headRes = await fetch(publicUrl, { method: "HEAD", signal: AbortSignal.timeout(4000) });
    if (headRes.ok) return true;
  } catch {
    // Public fetch failed or bucket is private; fall back to authenticated check
  }

  const auth = getGoogleAuth();
  if (!auth) return false;

  try {
    const client = await auth.getClient();
    const apiUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(remotePath)}`;
    const res = await client.request({ url: apiUrl, method: "GET" });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Downloads an asset from GCS to local disk
 */
export async function downloadFromGCS(
  remotePath: string,
  localFilePath: string,
  bucket = DEFAULT_GCS_BUCKET
): Promise<boolean> {
  await fs.mkdir(path.dirname(localFilePath), { recursive: true });

  // Try fast direct CDN download first
  const publicUrl = `https://storage.googleapis.com/${bucket}/${encodeURI(remotePath)}`;
  try {
    const res = await fetch(publicUrl, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 500) {
        await fs.writeFile(localFilePath, buf);
        return true;
      }
    }
  } catch {
    // fallback to authenticated download
  }

  const auth = getGoogleAuth();
  if (!auth) return false;

  try {
    const client = await auth.getClient();
    const apiUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(remotePath)}?alt=media`;
    const res = await client.request<ArrayBuffer>({
      url: apiUrl,
      method: "GET",
      responseType: "arraybuffer",
    });
    if (res.status === 200 && res.data) {
      const buf = Buffer.from(res.data);
      await fs.writeFile(localFilePath, buf);
      return true;
    }
  } catch (err: any) {
    console.warn(`[GCS Vault] Failed to download ${remotePath}: ${err.message}`);
  }

  return false;
}

let lifecycleChecked = false;

/**
 * Ensures a 3-day deletion lifecycle rule exists on the bucket for temporary video assets (video-vault/),
 * preserving permanent assets (BGM, sound effects) while auto-purging temporary keyframes and audio after 3 days.
 */
export async function ensureVaultLifecyclePolicy(
  bucket = DEFAULT_GCS_BUCKET,
  days = 3,
  prefix = "video-vault/"
): Promise<boolean> {
  if (lifecycleChecked) return true;
  lifecycleChecked = true;

  const auth = getGoogleAuth();
  if (!auth) return false;

  try {
    const client = await auth.getClient();
    const getUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}?fields=lifecycle`;
    const res = await client.request<any>({ url: getUrl, method: "GET" });
    const existingRules: any[] = res.data?.lifecycle?.rule || [];

    const hasRule = existingRules.some(
      (r) =>
        r.action?.type === "Delete" &&
        r.condition?.age === days &&
        Array.isArray(r.condition?.matchesPrefix) &&
        r.condition.matchesPrefix.includes(prefix)
    );

    if (hasRule) {
      return true;
    }

    const newRules = [
      ...existingRules,
      {
        action: { type: "Delete" },
        condition: {
          age: days,
          matchesPrefix: [prefix],
        },
      },
    ];

    const patchUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}`;
    await client.request({
      url: patchUrl,
      method: "PATCH",
      data: {
        lifecycle: {
          rule: newRules,
        },
      },
    });

    console.log(`[GCS Vault] Successfully verified/updated 3-day deletion lifecycle rule for prefix '${prefix}' on bucket '${bucket}'.`);
    return true;
  } catch (err: any) {
    // Non-fatal if service account has read/write permissions but not storage.buckets.update
    console.warn(`[GCS Vault] Notice: Bucket lifecycle policy check skipped: ${err.message}`);
    return false;
  }
}

/**
 * Uploads an asset from local disk to GCS
 */
export async function uploadToGCS(
  localFilePath: string,
  remotePath: string,
  contentType = "application/octet-stream",
  bucket = DEFAULT_GCS_BUCKET
): Promise<boolean> {
  if (!fsSync.existsSync(localFilePath)) return false;
  const fileBytes = await fs.readFile(localFilePath);
  if (fileBytes.length === 0) return false;

  const auth = getGoogleAuth();
  if (!auth) return false;

  // Lazily ensure 3-day deletion lifecycle rule on the bucket
  if (!lifecycleChecked) {
    ensureVaultLifecyclePolicy(bucket, 3, "video-vault/").catch(() => {});
  }

  try {
    const client = await auth.getClient();
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(remotePath)}`;
    const res = await client.request({
      url: uploadUrl,
      method: "POST",
      headers: {
        "Content-Type": contentType,
      },
      body: fileBytes,
    });
    return res.status === 200;
  } catch (err: any) {
    console.warn(`[GCS Vault] Failed to upload ${remotePath}: ${err.message}`);
    return false;
  }
}
