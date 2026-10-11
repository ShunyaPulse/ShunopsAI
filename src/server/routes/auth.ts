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
  markEmailAsVerified,
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

    // If purpose is login, verify account exists
    if (purpose === "login") {
      const existing = await findUserByEmail(cleanEmail);
      if (!existing) {
        reply.status(404);
        return { error: "No account found with this email. Please sign up first." };
      }
    }

    const result = await sendEmailOTP(cleanEmail);
    if (!result.success) {
      reply.status(429);
      return { error: result.message };
    }

    return { success: true, message: "6-digit verification code sent to your email." };
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
        email?: string;
        email_verified?: string | boolean;
        name?: string;
        picture?: string;
      };

      if (!googleData.sub || !googleData.email) {
        reply.status(400);
        return { error: "Google account missing verified email." };
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

  // 5. Current User Session Check
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
}
