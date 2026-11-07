/**
 * ShunopsAI - Inbound Email Review Poller (IMAP SSL).
 *
 * Checks for replies to video notification emails, parses user's subjective directions,
 * and passes them to the Autonomous Feedback Handler for Dual-Model Consensus healing.
 *
 * Zero-cost, runs on the 12-hour sentinel schedule or on demand.
 */

import "dotenv/config";
import * as tls from "node:tls";
import { handleVideoFeedback } from "../tools/video/feedback-handler.js";

interface EmailMessage {
  uid: string;
  subject: string;
  from: string;
  body: string;
}

/**
 * Execute basic IMAP commands over TLS socket.
 */
function sendImapCommand(socket: tls.TLSSocket, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let responseData = "";
    const onData = (data: Buffer) => {
      responseData += data.toString();
      if (responseData.includes("OK ") || responseData.includes("NO ") || responseData.includes("BAD ")) {
        socket.removeListener("data", onData);
        resolve(responseData);
      }
    };
    socket.on("data", onData);
    socket.write(cmd + "\r\n");
    setTimeout(() => {
      socket.removeListener("data", onData);
      resolve(responseData);
    }, 10000);
  });
}

/**
 * Poll inbox for video review replies.
 */
export async function pollVideoEmailReplies(): Promise<{ processed: number }> {
  const host = "imap.gmail.com";
  const port = 993;
  const user = process.env.SMTP_USER || "shunyapulse42@gmail.com";
  const pass = process.env.SMTP_PASS;

  if (!pass) {
    console.log("[Email Poller] SMTP_PASS not configured. Skipping IMAP poll.");
    return { processed: 0 };
  }

  console.log(`[Email Poller] Connecting to ${host}:${port} for ${user}...`);

  return new Promise((resolve) => {
    const socket = tls.connect(port, host, { rejectUnauthorized: true, minVersion: 'TLSv1.2' }, async () => {
      let processedCount = 0;
      try {
        // Step 1: Wait for greeting
        await new Promise((r) => setTimeout(r, 1000));

        // Step 2: Login
        const loginRes = await sendImapCommand(socket, `a1 LOGIN "${user}" "${pass}"`);
        if (!loginRes.includes("a1 OK")) {
          console.warn("[Email Poller] IMAP login failed:", loginRes.slice(0, 100));
          socket.end();
          return resolve({ processed: 0 });
        }

        // Step 3: Select INBOX
        await sendImapCommand(socket, "a2 SELECT INBOX");

        // Step 4: Search for unseen replies to Video Ready
        const searchRes = await sendImapCommand(socket, 'a3 SEARCH UNSEEN SUBJECT "Video Ready"');
        const match = searchRes.match(/\* SEARCH ([\d\s]+)/);
        const uids = match && match[1] ? match[1].trim().split(/\s+/).filter(Boolean) : [];

        console.log(`[Email Poller] Found ${uids.length} unseen video review message(s).`);

        for (const msgId of uids) {
          try {
            // Fetch header & body
            const fetchRes = await sendImapCommand(socket, `a4 FETCH ${msgId} (BODY[TEXT] BODY[HEADER.FIELDS (SUBJECT FROM)])`);

            // Extract Job ID
            const jobMatch = fetchRes.match(/\[job:([a-zA-Z0-9_-]+)\]/i);
            if (!jobMatch || !jobMatch[1]) {
              console.log(`[Email Poller] Message ${msgId} has no [job:<id>] tag. Skipping.`);
              continue;
            }

            const jobId = jobMatch[1];

            // Extract Body text (strip email headers and quote markers)
            let bodyText = fetchRes;
            const bodyIdx = bodyText.indexOf("\r\n\r\n");
            if (bodyIdx !== -1) {
              bodyText = bodyText.slice(bodyIdx).trim();
            }

            // Remove email reply quote markers (e.g. lines starting with ">" or On ... wrote:)
            const cleanLines = bodyText
              .split("\n")
              .filter((l) => !l.trim().startsWith(">") && !l.trim().startsWith("On ") && !l.includes("wrote:"))
              .join("\n")
              .trim();

            if (!cleanLines) {
              console.log(`[Email Poller] Message ${msgId} has empty feedback. Skipping.`);
              continue;
            }

            console.log(`[Email Poller] 🎯 Received feedback for job ${jobId}: "${cleanLines.slice(0, 100)}..."`);
            await handleVideoFeedback(jobId, cleanLines);
            processedCount++;

            // Mark as seen
            await sendImapCommand(socket, `a5 STORE ${msgId} +FLAGS (\\Seen)`);
          } catch (msgErr: any) {
            console.warn(`[Email Poller] Error processing message ${msgId}: ${msgErr?.message || msgErr}`);
          }
        }

        await sendImapCommand(socket, "a6 LOGOUT");
      } catch (err: any) {
        console.warn(`[Email Poller] IMAP error: ${err?.message || err}`);
      } finally {
        socket.end();
        resolve({ processed: processedCount });
      }
    });

    socket.on("error", (err) => {
      console.warn(`[Email Poller] Socket error: ${err.message}`);
      resolve({ processed: 0 });
    });
  });
}

// Direct execution CLI support
if (process.argv[1]?.endsWith("email-reply-poller.ts") || process.argv[1]?.endsWith("email-reply-poller.js")) {
  pollVideoEmailReplies().then((res) => {
    console.log(`[Email Poller] Finished. Processed ${res.processed} feedback item(s).`);
  });
}
