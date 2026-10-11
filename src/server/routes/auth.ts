import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  findUserByUsername,
  findUserByEmail,
  createUser,
  createSession,
  deleteSession,
  findUserBySessionToken,
  upsertGoogleUser,
  upsertGithubUser,
  markEmailAsVerified,
  updateUserPassword,
  deleteUserAccount,
  exportUserData,
  revokeAllUserSessions,
} from "../db.js";
import { sendEmailOTP, verifyEmailOTP } from "../email-otp.js";
import { verifyCloudflareTurnstile } from "../middleware/bot-shield.js";
import { getClientIp, getClientSubnet, checkDistributedSubnetQuota } from "../middleware/ratelimit.js";

const COOKIE_NAME = "shunops_user_session";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // 1. Send OTP to Email (for registration verification or OTP login)
  app.post("/api/auth/email-otp/send", async (req: FastifyRequest, reply: FastifyReply) => {
    const { email, purpose, turnstileToken, hp_website } = (req.body as any) || {};

    if (hp_website) {
      reply.status(400);
      return { error: "Verification failed." };
    }

    if (!email || typeof email !== "string" || !email.includes("@")) {
      reply.status(400);
      return { error: "Valid email address is required." };
    }

    const cleanEmail = email.trim().toLowerCase();
    const clientIp = getClientIp(req);
    const clientSubnet = getClientSubnet(clientIp);

    // Rate-limit: 5 OTP sends per 5 minutes per subnet
    const quota = await checkDistributedSubnetQuota(`otp-send:${clientSubnet}`, 5, 300);
    if (!quota.allowed) {
      reply.status(429);
      return { error: "Too many OTP requests from this network. Please wait a few minutes." };
    }

    // Verify Cloudflare Turnstile if configured
    if (turnstileToken) {
      const isHuman = await verifyCloudflareTurnstile(turnstileToken, clientIp);
      if (!isHuman) {
        reply.status(403);
        return { error: "Security check failed. Please refresh the captcha and try again." };
      }
    }

    // If purpose is signup, verify account doesn't already exist
    if (purpose === "signup") {
      const existing = await findUserByEmail(cleanEmail);
      if (existing) {
        reply.status(409);
        return { error: "An account with this email already exists. Please sign in instead." };
      }
    }

    // If purpose is login, only send code if user exists, but return identical message to avoid enumeration
    if (purpose === "login") {
      const existing = await findUserByEmail(cleanEmail);
      if (!existing) {
        // Return uniform success response so attackers cannot probe valid accounts
        return { success: true, message: "If an account exists with this email, a 6-digit code has been sent." };
      }
    }

    const result = await sendEmailOTP(cleanEmail);
    if (!result.success) {
      reply.status(429);
      return { error: result.message };
    }

    return { success: true, message: "If an account exists with this email, a 6-digit code has been sent." };
  });

  // 2. Register New User (Requires valid Email OTP code)
  app.post("/api/auth/register", async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, email, password, emailOtp, turnstileToken, hp_website } = (req.body as any) || {};

    // Layer 1: Honeypot trap
    if (hp_website) {
      reply.status(400);
      return { error: "Registration rejected." };
    }

    const clientIp = getClientIp(req);
    const clientSubnet = getClientSubnet(clientIp);

    // Layer 2: Cloudflare Turnstile Verification
    if (turnstileToken) {
      const isHuman = await verifyCloudflareTurnstile(turnstileToken, clientIp);
      if (!isHuman) {
        reply.status(403);
        return { error: "Security verification failed. Please complete the captcha." };
      }
    }

    // Layer 3: Subnet Throttling (Max 5 signups per 15 minutes per subnet)
    const subnetQuota = await checkDistributedSubnetQuota(`reg:${clientSubnet}`, 5, 900);
    if (!subnetQuota.allowed) {
      reply.status(429);
      return { error: "High registration activity detected from your network. Please try again later." };
    }

    if (!username || typeof username !== "string" || username.trim().length < 3) {
      reply.status(400);
      return { error: "Username must be at least 3 characters." };
    }

    if (!email || typeof email !== "string" || !email.includes("@")) {
      reply.status(400);
      return { error: "Valid email address is required for account security." };
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      reply.status(400);
      return { error: "Password must be at least 8 characters." };
    }

    // Layer 4: Email OTP Verification (Guarantees real inbox ownership)
    if (!emailOtp || typeof emailOtp !== "string" || emailOtp.trim().length !== 6) {
      reply.status(400);
      return { error: "Please enter the 6-digit verification code sent to your email." };
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    const otpCheck = await verifyEmailOTP(cleanEmail, emailOtp.trim());
    if (!otpCheck.success) {
      reply.status(400);
      return { error: otpCheck.message };
    }

    // Check duplicate username or email
    const existingUser = await findUserByUsername(cleanUsername);
    if (existingUser) {
      reply.status(409);
      return { error: "Username is already taken. Please choose another." };
    }

    const existingEmail = await findUserByEmail(cleanEmail);
    if (existingEmail) {
      reply.status(409);
      return { error: "An account with this email already exists. Please sign in." };
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const user = await createUser(cleanUsername, passwordHash, cleanEmail, true);

    // Create session
    const sessionToken = crypto.randomBytes(32).toString("hex");
    await createSession(user.id, sessionToken, 7);

    reply.setCookie(COOKIE_NAME, sessionToken, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
    });

    return {
      success: true,
      message: "Account created and email verified successfully!",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  });

  // 3. Login User (Supports Email/Username + Password, OR Email + OTP code)
  app.post("/api/auth/login", async (req: FastifyRequest, reply: FastifyReply) => {
    const { identifier, password, emailOtp, hp_website } = (req.body as any) || {};

    if (hp_website) {
      reply.status(400);
      return { error: "Login rejected." };
    }

    if (!identifier || typeof identifier !== "string") {
      reply.status(400);
      return { error: "Email or username is required." };
    }

    const cleanId = identifier.trim().toLowerCase();
    const clientIp = getClientIp(req);
    const clientSubnet = getClientSubnet(clientIp);

    // Rate limit: 10 login attempts per 5 minutes per subnet
    const quota = await checkDistributedSubnetQuota(`login:${clientSubnet}`, 10, 300);
    if (!quota.allowed) {
      reply.status(429);
      return { error: "Too many login attempts. Please wait a few minutes." };
    }

    let user = cleanId.includes("@")
      ? await findUserByEmail(cleanId)
      : await findUserByUsername(cleanId);

    // Flow A: Email + OTP Login
    if (emailOtp) {
      if (typeof emailOtp !== "string" || emailOtp.trim().length !== 6) {
        reply.status(400);
        return { error: "Invalid 6-digit OTP code." };
      }

      if (!user) {
        reply.status(404);
        return { error: "No account found with this email." };
      }

      const otpCheck = await verifyEmailOTP(user.email || cleanId, emailOtp.trim());
      if (!otpCheck.success) {
        reply.status(400);
        return { error: otpCheck.message };
      }

      // Mark email verified if wasn't
      if (user.email && !user.email_verified) {
        await markEmailAsVerified(user.email);
      }

      const sessionToken = crypto.randomBytes(32).toString("hex");
      await createSession(user.id, sessionToken, 7);

      reply.setCookie(COOKIE_NAME, sessionToken, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60,
      });

      return {
        success: true,
        message: "Logged in via Email OTP successfully!",
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      };
    }

    // Flow B: Email/Username + Password Login
    if (!password) {
      reply.status(400);
      return { error: "Password is required." };
    }

    if (!user || !user.password_hash) {
      reply.status(401);
      return { error: "Invalid credentials." };
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      reply.status(401);
      return { error: "Invalid credentials." };
    }

    const sessionToken = crypto.randomBytes(32).toString("hex");
    await createSession(user.id, sessionToken, 7);

    reply.setCookie(COOKIE_NAME, sessionToken, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
    });

    return {
      success: true,
      message: "Logged in successfully!",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  });

  // 4. Google One-Tap / OAuth Callback (Token Verification via official Google API)
  app.post("/api/auth/google", async (req: FastifyRequest, reply: FastifyReply) => {
    const { credential, hp_website } = (req.body as any) || {};

    if (hp_website || !credential) {
      reply.status(400);
      return { error: "Invalid Google authentication token." };
    }

    try {
      // Verify Google ID Token against Google's public tokeninfo endpoint
      const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!googleRes.ok) {
        reply.status(401);
        return { error: "Google authentication failed. Please try again." };
      }

      const googleData = (await googleRes.json()) as {
        sub: string;
        aud?: string;
        email?: string;
        email_verified?: string | boolean;
        name?: string;
        picture?: string;
      };

      if (!googleData.sub || !googleData.email) {
        reply.status(400);
        return { error: "Google account missing verified email." };
      }

      // Security Invariant (Item 2): Verify token audience matches our Google Client ID
      const expectedClientId =
        process.env.GOOGLE_CLIENT_ID ||
        "685823552970-phqjqt3cc613h69kat0rljbaikf8k6kd.apps.googleusercontent.com";
      if (googleData.aud !== expectedClientId) {
        reply.status(401);
        return { error: "Google token audience mismatch. Unauthorized OAuth client." };
      }

      // Verify email is verified by Google
      const isEmailVerified =
        googleData.email_verified === true ||
        googleData.email_verified === "true";
      if (!isEmailVerified) {
        reply.status(403);
        return { error: "Google email address is not verified. Please verify your email with Google first." };
      }

      // Upsert user in Neon Postgres
      const user = await upsertGoogleUser(googleData.sub, googleData.email, googleData.name);

      const sessionToken = crypto.randomBytes(32).toString("hex");
      await createSession(user.id, sessionToken, 7);

      reply.setCookie(COOKIE_NAME, sessionToken, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60,
      });

      return {
        success: true,
        message: "Google login successful!",
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      };
    } catch (err: any) {
      console.error("[Google Auth Error]: [REDACTED]");
      reply.status(500);
      return { error: "Failed to authenticate with Google." };
    }
  });

  // 5. GitHub OAuth: Initiate Authorization Redirect
  app.get("/api/auth/github", async (req: FastifyRequest, reply: FastifyReply) => {
    const clientId = process.env.GITHUB_CLIENT_ID || process.env.GH_CLIENT_ID;
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
    reply.setCookie("gh_oauth_state", state, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
    });

    const host = req.headers.host || "shunopsai-685823552970.asia-south1.run.app";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const redirectUri = `${protocol}://${host}/api/auth/github/callback`;

    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
    return reply.redirect(githubAuthUrl);
  });

  // 6. GitHub OAuth: Callback & Token Exchange
  app.get("/api/auth/github/callback", async (req: FastifyRequest, reply: FastifyReply) => {
    const { code, state, error: ghError } = (req.query as any) || {};

    if (ghError) {
      return reply.redirect("/login?error=" + encodeURIComponent("GitHub authorization was cancelled."));
    }

    const savedState = (req.cookies as any)?.gh_oauth_state;
    if (!state || !savedState || state !== savedState) {
      return reply.redirect("/login?error=" + encodeURIComponent("Invalid GitHub OAuth state. Possible CSRF."));
    }
    reply.clearCookie("gh_oauth_state", { path: "/" });

    if (!code) {
      return reply.redirect("/login?error=" + encodeURIComponent("Missing authorization code from GitHub."));
    }

    const clientId = process.env.GITHUB_CLIENT_ID || process.env.GH_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.GH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return reply.redirect("/login?error=" + encodeURIComponent("GitHub OAuth not fully configured on server."));
    }

    try {
      // Exchange code for access_token
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (!tokenData.access_token) {
        console.error("[GitHub OAuth Token Error]: [REDACTED]");
        return reply.redirect("/login?error=" + encodeURIComponent("Failed to exchange GitHub authorization code."));
      }

      // Fetch user profile from GitHub
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "User-Agent": "ShunopsAI-Auth",
        },
      });

      if (!userRes.ok) {
        return reply.redirect("/login?error=" + encodeURIComponent("Failed to fetch GitHub profile."));
      }

      const ghUser = (await userRes.json()) as {
        id: number | string;
        login: string;
        name?: string;
        email?: string;
        avatar_url?: string;
      };

      let email = ghUser.email;

      // If profile email is hidden, fetch from /user/emails
      if (!email) {
        try {
          const emailsRes = await fetch("https://api.github.com/user/emails", {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              "User-Agent": "ShunopsAI-Auth",
            },
          });
          if (emailsRes.ok) {
            const emails = (await emailsRes.json()) as Array<{
              email: string;
              primary: boolean;
              verified: boolean;
            }>;
            const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails[0];
            if (primary) email = primary.email;
          }
        } catch {}
      }

      if (!email) {
        email = `${ghUser.login.toLowerCase()}@users.noreply.github.com`;
      }

      // Upsert user in database with Canonical Account Linking
      const user = await upsertGithubUser(ghUser.id.toString(), email, ghUser.login, ghUser.name);

      // Create session and set cookie
      const sessionToken = crypto.randomBytes(32).toString("hex");
      await createSession(user.id, sessionToken, 7);

      reply.setCookie(COOKIE_NAME, sessionToken, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.redirect("/workspace");
    } catch (err: any) {
      console.error("[GitHub OAuth Callback Error]: [REDACTED]");
      return reply.redirect("/login?error=" + encodeURIComponent("Authentication with GitHub failed."));
    }
  });

  // 7. Current User Session Check
  app.get("/api/auth/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.cookies as any)?.[COOKIE_NAME];
    if (!token) {
      reply.status(401);
      return { authenticated: false };
    }

    const user = await findUserBySessionToken(token);
    if (!user) {
      reply.status(401);
      return { authenticated: false };
    }

    return {
      authenticated: true,
      user,
    };
  });

  // 6. Logout User
  app.post("/api/auth/logout", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.cookies as any)?.[COOKIE_NAME];
    if (token) {
      await deleteSession(token);
    }
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { success: true, message: "Logged out." };
  });

  // 7. Password Reset via Email OTP
  app.post("/api/auth/reset-password", async (req: FastifyRequest, reply: FastifyReply) => {
    const { email, emailOtp, newPassword, turnstileToken, hp_website } = (req.body as any) || {};

    if (hp_website) {
      reply.status(400);
      return { error: "Validation failed." };
    }

    if (!email || !emailOtp || !newPassword) {
      reply.status(400);
      return { error: "Email, 6-digit OTP code, and new password are required." };
    }

    if (typeof newPassword !== "string" || newPassword.length < 8) {
      reply.status(400);
      return { error: "New password must be at least 8 characters long." };
    }

    const clientIp = getClientIp(req);
    if (turnstileToken) {
      const isHuman = await verifyCloudflareTurnstile(turnstileToken, clientIp);
      if (!isHuman) {
        reply.status(403);
        return { error: "Security captcha check failed. Please refresh and try again." };
      }
    }

    const cleanEmail = email.trim().toLowerCase();
    const otpValid = await verifyEmailOTP(cleanEmail, emailOtp.toString().trim());
    if (!otpValid) {
      reply.status(400);
      return { error: "Invalid or expired verification code. Please request a new code." };
    }

    const user = await findUserByEmail(cleanEmail);
    if (!user) {
      reply.status(404);
      return { error: "No account found with this email." };
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await updateUserPassword(user.id, newHash);
    await revokeAllUserSessions(user.id);

    return { success: true, message: "Password reset successfully. Please log in with your new password." };
  });

  // 8. Change Password (Authenticated session)
  app.post("/api/auth/change-password", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.cookies as any)?.[COOKIE_NAME];
    if (!token) {
      reply.status(401);
      return { error: "Authentication required." };
    }

    const user = await findUserBySessionToken(token);
    if (!user) {
      reply.status(401);
      return { error: "Authentication required." };
    }

    const { currentPassword, newPassword } = (req.body as any) || {};
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      reply.status(400);
      return { error: "New password must be at least 8 characters." };
    }

    // Verify existing password if one was set
    const userRecord = await findUserByUsername(user.username);
    if (userRecord?.password_hash) {
      if (!currentPassword) {
        reply.status(400);
        return { error: "Current password is required." };
      }
      const match = await bcrypt.compare(currentPassword, userRecord.password_hash);
      if (!match) {
        reply.status(400);
        return { error: "Incorrect current password." };
      }
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await updateUserPassword(user.id, newHash);
    return { success: true, message: "Password updated successfully." };
  });

  // 9. Export Account Data (GDPR compliance)
  app.get("/api/auth/account/export", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.cookies as any)?.[COOKIE_NAME];
    if (!token) {
      reply.status(401);
      return { error: "Authentication required." };
    }

    const user = await findUserBySessionToken(token);
    if (!user) {
      reply.status(401);
      return { error: "Authentication required." };
    }

    const data = await exportUserData(user.id);
    reply.header("Content-Disposition", `attachment; filename="shunops_user_export_${user.username}.json"`);
    return data;
  });

  // 10. Delete Account (Permanently delete user, workspace, tasks, sessions)
  app.delete("/api/auth/account", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.cookies as any)?.[COOKIE_NAME];
    if (!token) {
      reply.status(401);
      return { error: "Authentication required." };
    }

    const user = await findUserBySessionToken(token);
    if (!user) {
      reply.status(401);
      return { error: "Authentication required." };
    }

    await deleteUserAccount(user.id);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { success: true, message: "Account and associated data deleted permanently." };
  });
}
