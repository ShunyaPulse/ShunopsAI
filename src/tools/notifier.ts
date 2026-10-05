import nodemailer from "nodemailer";
import * as path from "node:path";
import * as fs from "node:fs";

export interface VideoNotificationDetails {
  title: string;
  videoUrl: string;
  studioUrl: string;
  topic: string;
  category?: string | undefined;
  valueHook?: string | undefined;
  thumbnailPath?: string | undefined;
  chapters?: { title: string; start_scene: number }[] | undefined;
  durationSec?: number | undefined;
  engine?: string | undefined;
}

/**
 * Sends a rich HTML email notification to the reviewer with the private YouTube URL.
 */
export async function sendVideoReadyEmail(details: VideoNotificationDetails): Promise<boolean> {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER || "techanics6174@gmail.com";
  const pass = process.env.SMTP_PASS;
  const to = process.env.EMAIL_FROM || process.env.SMTP_USER || "techanics6174@gmail.com";

  if (!pass) {
    console.warn("[Notifier] Warning: SMTP_PASS is missing in .env. Skipping email notification.");
    return false;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const hasThumbnail = Boolean(details.thumbnailPath && fs.existsSync(details.thumbnailPath));
  const durationMin = details.durationSec ? `${(details.durationSec / 60).toFixed(1)} mins` : "3.0 mins";
  const chaptersHtml = (details.chapters || [])
    .map((c, i) => `<li style="margin-bottom: 4px;"><strong>Scene ${c.start_scene + 1}:</strong> ${c.title}</li>`)
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Video Ready: ${details.title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 620px; margin: 0 auto; background-color: #1e293b; border-radius: 12px; overflow: hidden; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); padding: 24px 30px; text-align: center;">
      <h1 style="margin: 0; font-size: 22px; color: #ffffff; letter-spacing: 0.5px;">🎬 Autonomous Video Autopilot</h1>
      <p style="margin: 6px 0 0 0; font-size: 14px; color: #e2e8f0;">Daily Trending Video Ready for Review</p>
    </div>

    <!-- Content -->
    <div style="padding: 28px 30px;">

      ${
        hasThumbnail
          ? `<img src="cid:thumbnailImage" alt="Video thumbnail" style="width: 100%; border-radius: 8px; margin-bottom: 20px; display: block;" />`
          : ""
      }

      <div style="background-color: #0f172a; border-left: 4px solid #38bdf8; padding: 14px 16px; border-radius: 6px; margin-bottom: 20px;">
        <span style="font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 1px;">Trend Category: ${details.category || "General Curiosity"}</span>
        <h2 style="margin: 6px 0 0 0; font-size: 18px; color: #f8fafc; line-height: 1.4;">${details.title}</h2>
      </div>

      ${
        details.valueHook
          ? `<p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 20px;">
              <strong>💡 Value Addition:</strong> ${details.valueHook}
             </p>`
          : ""
      }

      <div style="background-color: #0f172a; padding: 16px; border-radius: 8px; margin-bottom: 24px; font-size: 13px; color: #94a3b8;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0;"><strong>Language:</strong> Hindi (hi-IN-MadhurNeural)</td>
            <td style="padding: 4px 0;"><strong>Visibility:</strong> <span style="color: #4ade80;">Private</span></td>
          </tr>
          <tr>
            <td style="padding: 4px 0;"><strong>Length:</strong> ${durationMin}</td>
            <td style="padding: 4px 0;"><strong>AI Disclosure:</strong> Yes</td>
          </tr>
          <tr>
            <td style="padding: 4px 0;"><strong>Likes Visible:</strong> Off</td>
            <td style="padding: 4px 0;"><strong>Engine:</strong> ${details.engine || "Wan2.1 DiT + RIFE"}</td>
          </tr>
        </table>
      </div>

      <!-- Action Buttons -->
      <div style="text-align: center; margin: 30px 0 24px 0;">
        <a href="${details.videoUrl}" style="background-color: #ef4444; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block; margin-right: 12px; box-shadow: 0 4px 12px rgba(239,68,68,0.4);">
          ▶️ Watch on YouTube (Private)
        </a>
        <a href="${details.studioUrl}" style="background-color: #3b82f6; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">
          ⚙️ Edit in YouTube Studio
        </a>
      </div>

      ${
        chaptersHtml
          ? `<div style="margin-top: 24px; border-top: 1px solid #334155; padding-top: 16px;">
              <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">Video Chapters:</h4>
              <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #cbd5e1;">${chaptersHtml}</ul>
             </div>`
          : ""
      }
    </div>

    <!-- Footer -->
    <div style="background-color: #0f172a; padding: 16px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #334155;">
      Autonomous AI Pipeline • Zero-Cost Cloud Infrastructure • SaralGati & AA
    </div>
  </div>
</body>
</html>
`;

  try {
    const attachments: any[] = [];
    if (hasThumbnail && details.thumbnailPath) {
      attachments.push({
        filename: path.basename(details.thumbnailPath),
        path: details.thumbnailPath,
        cid: "thumbnailImage",
      });
    }

    const info = await transporter.sendMail({
      from: `"Autonomous Video Bot" <${user}>`,
      to,
      subject: `🎬 [Private Review Ready] ${details.title}`,
      html,
      attachments,
    });

    console.log(`[Notifier] ✅ Review email successfully sent to ${to}: ${info.messageId}`);
    return true;
  } catch (error: any) {
    console.error(`[Notifier] ❌ Failed to send review email: ${error.message}`);
    return false;
  }
}

export interface IncidentAlertDetails {
  title: string;
  service: string;
  status: "HEALED" | "DEGRADED" | "DOWN" | "WARNING" | "INFO";
  actionTaken?: string;
  details?: string;
  url?: string;
  timestamp?: string;
}

/**
 * Broadcast incident & self-healing alerts to Discord, Telegram, Slack, and Email
 */
export async function sendIncidentAlert(alert: IncidentAlertDetails): Promise<{
  discord: boolean;
  telegram: boolean;
  slack: boolean;
  email: boolean;
}> {
  const time = alert.timestamp || new Date().toISOString();
  const isOk = alert.status === "HEALED" || alert.status === "INFO";
  const icon = isOk ? "✅" : alert.status === "DOWN" ? "🚨" : "⚠️";
  const color = isOk ? 0x22c55e : alert.status === "DOWN" ? 0xef4444 : 0xf59e0b;

  const results = { discord: false, telegram: false, slack: false, email: false };

  // 1. Discord Webhook Broadcast
  const discordUrl = process.env.DISCORD_WEBHOOK_URL;
  if (discordUrl) {
    try {
      const res = await fetch(discordUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "ShunopsAI DevOps Sentinel",
          avatar_url: "https://raw.githubusercontent.com/ShunyaPulse/ShunopsAI/main/public/favicon.ico",
          embeds: [
            {
              title: `${icon} [${alert.status}] ${alert.title}`,
              color,
              fields: [
                { name: "Service", value: alert.service, inline: true },
                { name: "Status", value: alert.status, inline: true },
                { name: "Action Taken", value: alert.actionTaken || "Autonomous Diagnosis", inline: false },
                ...(alert.details ? [{ name: "Details", value: alert.details.slice(0, 1000), inline: false }] : []),
                ...(alert.url ? [{ name: "Endpoint", value: alert.url, inline: false }] : []),
              ],
              footer: { text: "ShunopsAI Autonomous Sentinel" },
              timestamp: time,
            },
          ],
        }),
      });
      results.discord = res.ok;
    } catch (e: any) {
      console.warn(`[Notifier] Discord alert notice: ${e.message}`);
    }
  }

  // 2. Telegram Bot Broadcast
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChatId) {
    try {
      const text = `${icon} *[ShunopsAI Sentinel Alert]*\n\n*Status:* \`${alert.status}\`\n*Service:* \`${alert.service}\`\n*Event:* ${alert.title}\n*Action:* ${alert.actionTaken || "Self-healing triggered"}\n${alert.details ? `*Details:* ${alert.details.slice(0, 300)}\n` : ""}${alert.url ? `*URL:* ${alert.url}\n` : ""}*Time:* \`${time}\``;
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgChatId,
          text,
          parse_mode: "Markdown",
        }),
      });
      results.telegram = res.ok;
    } catch (e: any) {
      console.warn(`[Notifier] Telegram alert notice: ${e.message}`);
    }
  }

  // 3. Slack Webhook Broadcast
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (slackUrl) {
    try {
      const res = await fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${icon} [${alert.status}] ${alert.service}: ${alert.title}`,
          attachments: [
            {
              color: isOk ? "good" : "danger",
              text: `${alert.actionTaken || "Autonomous Sentinel Response"}\n${alert.details || ""}`,
              ts: Math.floor(Date.now() / 1000),
            },
          ],
        }),
      });
      results.slack = res.ok;
    } catch (e: any) {
      console.warn(`[Notifier] Slack alert notice: ${e.message}`);
    }
  }

  // 4. Email Broadcast on Critical/Down
  const pass = process.env.SMTP_PASS;
  if (pass && (alert.status === "DOWN" || alert.status === "DEGRADED")) {
    try {
      const host = process.env.SMTP_HOST || "smtp.gmail.com";
      const port = parseInt(process.env.SMTP_PORT || "465", 10);
      const user = process.env.SMTP_USER || "techanics6174@gmail.com";
      const to = process.env.EMAIL_TO || process.env.SMTP_USER || "techanics6174@gmail.com";

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from: `"ShunopsAI Sentinel" <${user}>`,
        to,
        subject: `🚨 [SENTINEL ALERT] ${alert.service} is ${alert.status}`,
        html: `<h3>${icon} Incident Alert: ${alert.service}</h3><p><strong>Title:</strong> ${alert.title}</p><p><strong>Status:</strong> ${alert.status}</p><p><strong>Action Taken:</strong> ${alert.actionTaken || "Automated check"}</p><p><strong>Details:</strong> ${alert.details || "N/A"}</p><p><strong>Timestamp:</strong> ${time}</p>`,
      });
      results.email = true;
    } catch (e: any) {
      console.warn(`[Notifier] Email alert notice: ${e.message}`);
    }
  }

  return results;
}

