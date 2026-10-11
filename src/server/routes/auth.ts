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
} from "../db.js";

const COOKIE_NAME = "shunops_user_session";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // 1. Register New User
  app.post("/api/auth/register", async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, password, email, hp_website } = (req.body as any) || {};

    // Bot trap
    if (hp_website) {
      reply.status(400);
      return { error: "Registration rejected." };
    }

    if (!username || typeof username !== "string" || username.trim().length < 3) {
      reply.status(400);
      return { error: "Username must be at least 3 characters." };
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      reply.status(400);
      return { error: "Password must be at least 6 characters." };
    }

    const cleanUsername = username.trim();
    const existing = await findUserByUsername(cleanUsername);
    if (existing) {
      reply.status(409);
      return { error: "Username is already taken. Please choose another." };
    }

    if (email && typeof email === "string" && email.trim()) {
      const existingEmail = await findUserByEmail(email.trim());
      if (existingEmail) {
        reply.status(409);
        return { error: "Email is already registered." };
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const user = await createUser(cleanUsername, passwordHash, email?.trim());

    // Generate Session
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
      message: "Account created successfully!",
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  });

  // 2. Login User
  app.post("/api/auth/login", async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, password, hp_website } = (req.body as any) || {};

    if (hp_website) {
      reply.status(400);
      return { error: "Login rejected." };
    }

    if (!username || !password) {
      reply.status(400);
      return { error: "Username and password are required." };
    }

    const user = await findUserByUsername(username.trim());
    if (!user) {
      reply.status(401);
      return { error: "Invalid username or password." };
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      reply.status(401);
      return { error: "Invalid username or password." };
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
        role: user.role,
      },
    };
  });

  // 3. Current User Session Check
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

  // 4. Logout User
  app.post("/api/auth/logout", async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.cookies as any)?.[COOKIE_NAME];
    if (token) {
      await deleteSession(token);
    }
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { success: true, message: "Logged out." };
  });
}
