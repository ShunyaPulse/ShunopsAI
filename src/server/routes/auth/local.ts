import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import {
  findUserByUsername,
  findUserByEmail,
  createUser,
  deleteSession,
  markEmailAsVerified,
  updateUserPassword,
  deleteUserAccount,
  exportUserData,
  revokeAllUserSessions,
} from "../../db.js";
import { sendEmailOTP, verifyEmailOTP } from "../../email-otp.js";
import { verifyCloudflareTurnstile } from "../../middleware/bot-shield.js";
import { getClientIp, getClientSubnet, checkDistributedSubnetQuota } from "../../middleware/ratelimit.js";
import { COOKIE_NAME, getSessionUser, requireSessionUser, startUserSession, toPublicUser } from "./session.js";

// Cost factor must match the cost used for stored password hashes (`genSalt(10)`).
const BCRYPT_COST = 10;
const DUMMY_PASSWORD_SEED = "shunops-timing-equalizer";

let dummyPasswordHash: string | null = null;

/**
 * A real, never-matching bcrypt hash to compare against when the account does
 * not exist or has no password, so a failed lookup costs the same ~bcrypt time
 * as a real password check. Without it, response timing distinguishes valid
 * usernames from invalid ones (user enumeration). Derived on first use so no
 * hash literal is committed to the repository.
 */
function getDummyPasswordHash(): string {
  if (!dummyPasswordHash) {
    dummyPasswordHash = bcrypt.hashSync(DUMMY_PASSWORD_SEED, BCRYPT_COST);
  }
  return dummyPasswordHash;
}

/** Body fields accepted by the OTP-send endpoint. */
interface SendOtpBody {
  email?: string;
  purpose?: string;
  turnstileToken?: string;
  hp_website?: string;
}

/** 1. Send a 6-digit OTP to an email for registration verification or OTP login. */
async function handleSendEmailOtp(req: FastifyRequest, reply: FastifyReply) {
  const { email, purpose, turnstileToken, hp_website } = (req.body as SendOtpBody) || {};

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
}

/** Body fields accepted by the registration endpoint. */
interface RegisterBody {
  username?: string;
  email?: string;
  password?: string;
  emailOtp?: string;
  turnstileToken?: string;
  hp_website?: string;
}

/** 2. Register a new user; requires a valid email OTP code. */
async function handleRegister(req: FastifyRequest, reply: FastifyReply) {
  const { username, email, password, emailOtp, turnstileToken, hp_website } = (req.body as RegisterBody) || {};

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

  const salt = await bcrypt.genSalt(BCRYPT_COST);
  const passwordHash = await bcrypt.hash(password, salt);
  const user = await createUser(cleanUsername, passwordHash, cleanEmail, true);

  await startUserSession(user.id, reply);

  return {
    success: true,
    message: "Account created and email verified successfully!",
    user: toPublicUser(user),
  };
}

/** Body fields accepted by the login endpoint. */
interface LoginBody {
  identifier?: string;
  password?: string;
  emailOtp?: string;
  hp_website?: string;
}

/** 3. Login via email/username + password, or email + OTP code. */
async function handleLogin(req: FastifyRequest, reply: FastifyReply) {
  const { identifier, password, emailOtp, hp_website } = (req.body as LoginBody) || {};

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

  const user = cleanId.includes("@")
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

    // Mark email verified if it wasn't already
    if (user.email && !user.email_verified) {
      await markEmailAsVerified(user.email);
    }

    await startUserSession(user.id, reply);

    return {
      success: true,
      message: "Logged in via Email OTP successfully!",
      user: toPublicUser(user),
    };
  }

  // Flow B: Email/Username + Password Login
  if (!password) {
    reply.status(400);
    return { error: "Password is required." };
  }

  // Always run bcrypt (against a dummy hash when the account is missing or has
  // no password) so timing does not reveal whether a username/email exists.
  const storedHash = user?.password_hash || getDummyPasswordHash();
  const match = await bcrypt.compare(password, storedHash);
  if (!user || !user.password_hash || !match) {
    reply.status(401);
    return { error: "Invalid credentials." };
  }

  await startUserSession(user.id, reply);

  return {
    success: true,
    message: "Logged in successfully!",
    user: toPublicUser(user),
  };
}

/** 4. Current user session check. */
async function handleCurrentUser(req: FastifyRequest, reply: FastifyReply) {
  const user = await getSessionUser(req);
  if (!user) {
    reply.status(401);
    return { authenticated: false };
  }

  return {
    authenticated: true,
    user,
  };
}

/** 5. Log out: revoke the session and clear the cookie. */
async function handleLogout(req: FastifyRequest, reply: FastifyReply) {
  const token = (req.cookies as any)?.[COOKIE_NAME];
  if (token) {
    await deleteSession(token);
  }
  reply.clearCookie(COOKIE_NAME, { path: "/" });
  return { success: true, message: "Logged out." };
}

/** Body fields accepted by the password-reset endpoint. */
interface ResetPasswordBody {
  email?: string;
  emailOtp?: string;
  newPassword?: string;
  turnstileToken?: string;
  hp_website?: string;
}

/** 6. Reset a forgotten password via email OTP. */
async function handleResetPassword(req: FastifyRequest, reply: FastifyReply) {
  const { email, emailOtp, newPassword, turnstileToken, hp_website } =
    (req.body as ResetPasswordBody) || {};

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

  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await updateUserPassword(user.id, newHash);
  await revokeAllUserSessions(user.id);

  return { success: true, message: "Password reset successfully. Please log in with your new password." };
}

/** Body fields accepted by the change-password endpoint. */
interface ChangePasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

/** 7. Change the password of the signed-in user and invalidate old sessions. */
async function handleChangePassword(req: FastifyRequest, reply: FastifyReply) {
  const user = await requireSessionUser(req, reply);
  if (!user) return { error: "Authentication required." };

  const { currentPassword, newPassword } = (req.body as ChangePasswordBody) || {};
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    reply.status(400);
    return { error: "New password must be at least 8 characters." };
  }

  // Verify the existing password if one was set
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

  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await updateUserPassword(user.id, newHash);

  // A password change must invalidate every existing session: otherwise a
  // cookie stolen before the change stays valid for its full 7-day lifetime.
  // The device performing the change immediately gets a fresh session so the
  // legitimate user is not signed out of the page they are on.
  await revokeAllUserSessions(user.id);
  await startUserSession(user.id, reply);

  return { success: true, message: "Password updated successfully. All other sessions were signed out." };
}

/** 8. Export all account data (GDPR compliance). */
async function handleExportAccount(req: FastifyRequest, reply: FastifyReply) {
  const user = await requireSessionUser(req, reply);
  if (!user) return { error: "Authentication required." };

  const data = await exportUserData(user.id);
  reply.header("Content-Disposition", `attachment; filename="shunops_user_export_${user.username}.json"`);
  return data;
}

/** 9. Permanently delete the account, workspace, tasks, and sessions. */
async function handleDeleteAccount(req: FastifyRequest, reply: FastifyReply) {
  const user = await requireSessionUser(req, reply);
  if (!user) return { error: "Authentication required." };

  await deleteUserAccount(user.id);
  reply.clearCookie(COOKIE_NAME, { path: "/" });
  return { success: true, message: "Account and associated data deleted permanently." };
}

/** Register the password/OTP/account-management (non-OAuth) auth endpoints. */
export async function registerLocalAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/email-otp/send", handleSendEmailOtp);
  app.post("/api/auth/register", handleRegister);
  app.post("/api/auth/login", handleLogin);
  app.get("/api/auth/me", handleCurrentUser);
  app.post("/api/auth/logout", handleLogout);
  app.post("/api/auth/reset-password", handleResetPassword);
  app.post("/api/auth/change-password", handleChangePassword);
  app.get("/api/auth/account/export", handleExportAccount);
  app.delete("/api/auth/account", handleDeleteAccount);
}
