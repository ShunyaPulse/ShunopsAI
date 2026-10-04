import * as http from "node:http";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import "dotenv/config";

const PORT = 8085;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
].join(" ");

async function main() {
  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("❌ Error: YOUTUBE_CLIENT_ID or GOOGLE_CLIENT_ID not found in .env");
    process.exit(1);
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(
    SCOPES
  )}&access_type=offline&prompt=consent`;

  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const handleAuthCode = async (code: string) => {
    try {
      console.log("\n[OAuth] Authorization code received. Exchanging for refresh token...");
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = (await tokenRes.json()) as any;
      if (!tokenRes.ok || !tokenData.refresh_token) {
        console.error("❌ Token exchange error:", JSON.stringify(tokenData, null, 2));
        return false;
      }

      const refreshToken = tokenData.refresh_token;
      console.log(`\n✅ YOUTUBE_REFRESH_TOKEN acquired: ${refreshToken.slice(0, 10)}...`);

      const envPath = path.resolve(process.cwd(), ".env");
      let envContent = await fs.readFile(envPath, "utf-8");
      if (/^YOUTUBE_REFRESH_TOKEN=/m.test(envContent)) {
        envContent = envContent.replace(/^YOUTUBE_REFRESH_TOKEN=.*$/m, `YOUTUBE_REFRESH_TOKEN=${refreshToken}`);
      } else {
        envContent += `\n# YouTube Auto-Publishing\nYOUTUBE_REFRESH_TOKEN=${refreshToken}\n`;
      }
      await fs.writeFile(envPath, envContent, "utf-8");
      console.log("💾 Saved YOUTUBE_REFRESH_TOKEN to .env");

      // Optional: mirror the token into a user-configured shared env file.
      const sharedEnvPath = process.env.SHARED_ENV_PATH;
      if (sharedEnvPath) {
        try {
          let shared = await fs.readFile(sharedEnvPath, "utf-8");
          if (/^YOUTUBE_REFRESH_TOKEN=/m.test(shared)) {
            shared = shared.replace(/^YOUTUBE_REFRESH_TOKEN=.*$/m, `YOUTUBE_REFRESH_TOKEN=${refreshToken}`);
          } else {
            shared += `\n# YouTube Auto-Publishing\nYOUTUBE_REFRESH_TOKEN=${refreshToken}\n`;
          }
          await fs.writeFile(sharedEnvPath, shared, "utf-8");
          console.log(`💾 Saved YOUTUBE_REFRESH_TOKEN to ${sharedEnvPath}`);
        } catch {}
      }

      server.close();
      rl.close();
      console.log("\n🚀 Setup complete! You are ready to upload private YouTube videos directly.");
      process.exit(0);
    } catch (err: any) {
      console.error("Error during token exchange:", err.message);
      return false;
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url || "/", `http://localhost:${PORT}`);
      if (parsedUrl.pathname === "/oauth2callback") {
        const code = parsedUrl.searchParams.get("code");
        const error = parsedUrl.searchParams.get("error");

        if (error) {
          const safeError = String(error).replace(/[&<>"']/g, "");
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<h1>❌ Authorization Failed</h1><p>${safeError}</p>`);
          server.close();
          rl.close();
          process.exit(1);
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <html>
              <body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 90vh; background: #0f172a; color: #f8fafc;">
                <div style="text-align: center; background: #1e293b; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
                  <h1 style="color: #4ade80;">✅ YouTube Authorization Successful!</h1>
                  <p style="font-size: 18px; margin-top: 15px;">Your YouTube credentials have been automatically linked and saved.</p>
                  <p style="color: #94a3b8;">You can now close this tab and return to the terminal.</p>
                </div>
              </body>
            </html>
          `);
          await handleAuthCode(code);
        }
      }
    } catch (e: any) {
      console.error("Server error:", e.message);
      res.writeHead(500);
      res.end("Internal error");
    }
  });

  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🔗 YouTube OAuth 2.0 Authorization`);
    console.log(`======================================================`);
    console.log(`Please authorize YouTube upload permissions by visiting:`);
    console.log(`\n${authUrl}\n`);
    console.log(`Waiting for browser authorization on http://localhost:${PORT}...`);
    console.log(`(Alternatively, paste the code or full redirect URL below if opened elsewhere)`);

    exec(`start "" "${authUrl}"`);

    rl.question("\nPaste code or redirect URL here: ", async (answer) => {
      let code = answer.trim();
      if (code.includes("code=")) {
        const match = code.match(/code=([^&]+)/);
        if (match && match[1]) code = decodeURIComponent(match[1]);
      }
      if (code) {
        await handleAuthCode(code);
      }
    });
  });
}

main().catch(console.error);
