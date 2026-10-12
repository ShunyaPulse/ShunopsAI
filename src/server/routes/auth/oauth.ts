import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "crypto";
import { upsertGoogleUser, upsertGithubUser } from "../../db.js";
import { timingSafeEqualStr } from "../../middleware/auth.js";
import { startUserSession, toPublicUser } from "./session.js";

const GITHUB_OAUTH_STATE_COOKIE = "gh_oauth_state";
const GITHUB_OAUTH_STATE_TTL_SECONDS = 600;

/** Response shape of Google's tokeninfo endpoint. */
interface GoogleTokenInfo {
  sub: string;
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
}

/** Response shape of GitHub's /user endpoint. */
interface GithubProfile {
  id: number | string;
  login: string;
  name?: string;
  email?: string;
  avatar_url?: string;
}

/** GitHub OAuth client credentials from the environment. */
function getGithubClientCredentials(): { clientId?: string | undefined; clientSecret?: string | undefined } {
  return {
    clientId: process.env.GITHUB_CLIENT_ID || process.env.GH_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET || process.env.GH_CLIENT_SECRET,
  };
}

/** Build the OAuth redirect URI from the incoming request's host and protocol. */
function resolveGithubRedirectUri(req: FastifyRequest): string {
  const host = req.headers.host || "shunopsai-685823552970.asia-south1.run.app";
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}/api/auth/github/callback`;
}

/** Fetch a GitHub profile's email, falling back to /user/emails then noreply. */
async function resolveGithubEmail(
  accessToken: string,
  profile: GithubProfile
): Promise<string> {
  if (profile.email) return profile.email;

  try {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "ShunopsAI-Auth",
      },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary =
        emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails[0];
      if (primary) return primary.email;
    }
  } catch {
    // Fall through to the noreply address below.
  }

  return `${profile.login.toLowerCase()}@users.noreply.github.com`;
}

/** 1. Google One-Tap / OAuth login (token verified via Google's tokeninfo API). */
async function handleGoogleLogin(req: FastifyRequest, reply: FastifyReply) {
  const { credential, hp_website } = (req.body as any) || {};

  if (hp_website || !credential) {
    reply.status(400);
    return { error: "Invalid Google authentication token." };
  }

  try {
    // Verify Google ID Token against Google's public tokeninfo endpoint
    const googleRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!googleRes.ok) {
      reply.status(401);
      return { error: "Google authentication failed. Please try again." };
    }

    const googleData = (await googleRes.json()) as GoogleTokenInfo;

    if (!googleData.sub || !googleData.email) {
      reply.status(400);
      return { error: "Google account missing verified email." };
    }

    // Security Invariant (Item 2): Verify the token audience matches our Google Client ID
    const expectedClientId =
      process.env.GOOGLE_CLIENT_ID ||
      "685823552970-phqjqt3cc613h69kat0rljbaikf8k6kd.apps.googleusercontent.com";
    if (googleData.aud !== expectedClientId) {
      reply.status(401);
      return { error: "Google token audience mismatch. Unauthorized OAuth client." };
    }

    // Verify the email is verified by Google
    const isEmailVerified = googleData.email_verified === true || googleData.email_verified === "true";
    if (!isEmailVerified) {
      reply.status(403);
      return { error: "Google email address is not verified. Please verify your email with Google first." };
    }

    // Upsert the user in Neon Postgres
    const user = await upsertGoogleUser(googleData.sub, googleData.email, googleData.name);
    await startUserSession(user.id, reply);

    return {
      success: true,
      message: "Google login successful!",
      user: toPublicUser(user),
    };
  } catch {
    console.error("[Google Auth Error]: [REDACTED]");
    reply.status(500);
    return { error: "Failed to authenticate with Google." };
  }
}

/** 2. GitHub OAuth: initiate the authorization redirect. */
async function handleGithubAuthorize(req: FastifyRequest, reply: FastifyReply) {
  const { clientId } = getGithubClientCredentials();
  if (!clientId) {
    reply.status(503);
    return reply.type("text/html").send(`
        <!DOCTYPE html><html><body style="background:#090d16;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:32px;max-width:480px;text-align:center;">
          <h2 style="color:#38bdf8;">GitHub OAuth Setup Required</h2>
          <p style="color:#94a3b8;font-size:14px;line-height:1.6;">GITHUB_CLIENT_ID is not configured in the environment yet.<br>Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.</p>
          <a href="/login" style="display:inline-block;margin-top:16px;color:#38bdf8;text-decoration:none;">← Back to Login</a>
        </div>
        </body></html>
      `);
  }

  const state = crypto.randomBytes(16).toString("hex");
  reply.setCookie(GITHUB_OAUTH_STATE_COOKIE, state, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: GITHUB_OAUTH_STATE_TTL_SECONDS,
  });

  const redirectUri = resolveGithubRedirectUri(req);
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
  return reply.redirect(githubAuthUrl);
}

/** Redirect back to login with a URL-encoded error message. */
function redirectWithLoginError(reply: FastifyReply, message: string) {
  return reply.redirect("/login?error=" + encodeURIComponent(message));
}

/** 3. GitHub OAuth: exchange the code, load the profile, and open a session. */
async function handleGithubCallback(req: FastifyRequest, reply: FastifyReply) {
  const { code, state, error: ghError } = (req.query as any) || {};

  if (ghError) {
    return redirectWithLoginError(reply, "GitHub authorization was cancelled.");
  }

  const savedState = (req.cookies as any)?.[GITHUB_OAUTH_STATE_COOKIE];
  if (!state || !savedState || !timingSafeEqualStr(String(state), String(savedState))) {
    return redirectWithLoginError(reply, "Invalid GitHub OAuth state. Possible CSRF.");
  }
  reply.clearCookie(GITHUB_OAUTH_STATE_COOKIE, { path: "/" });

  if (!code) {
    return redirectWithLoginError(reply, "Missing authorization code from GitHub.");
  }

  const { clientId, clientSecret } = getGithubClientCredentials();
  if (!clientId || !clientSecret) {
    return redirectWithLoginError(reply, "GitHub OAuth not fully configured on server.");
  }

  try {
    // Exchange the code for an access_token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      console.error("[GitHub OAuth Token Error]: [REDACTED]");
      return redirectWithLoginError(reply, "Failed to exchange GitHub authorization code.");
    }

    // Fetch the user profile from GitHub
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "ShunopsAI-Auth",
      },
    });

    if (!userRes.ok) {
      return redirectWithLoginError(reply, "Failed to fetch GitHub profile.");
    }

    const ghUser = (await userRes.json()) as GithubProfile;
    const email = await resolveGithubEmail(tokenData.access_token, ghUser);

    // Upsert the user with canonical account linking
    const user = await upsertGithubUser(ghUser.id.toString(), email, ghUser.login, ghUser.name);
    await startUserSession(user.id, reply);

    return reply.redirect("/workspace");
  } catch {
    console.error("[GitHub OAuth Callback Error]: [REDACTED]");
    return redirectWithLoginError(reply, "Authentication with GitHub failed.");
  }
}

/** Register the Google and GitHub OAuth auth endpoints. */
export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/google", handleGoogleLogin);
  app.get("/api/auth/github", handleGithubAuthorize);
  app.get("/api/auth/github/callback", handleGithubCallback);
}
