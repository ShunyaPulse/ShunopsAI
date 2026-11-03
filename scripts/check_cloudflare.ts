/**
 * Fast Cloudflare Workers AI Quota & Reset Status Checker
 * Conforms strictly to GEMINI.md Rule 20 (Uses micro-weight @cf/meta/llama-3.2-1b-instruct)
 * Zero token cost, ~0 neurons consumed.
 */
import * as dotenv from "dotenv";

dotenv.config();

const MODEL = "@cf/meta/llama-3.2-1b-instruct";

interface AccountTarget {
  name: string;
  accountId: string;
  apiToken: string;
}

async function checkAccount(target: AccountTarget) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/ai/run/${MODEL}`;
  const start = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${target.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Ping",
        max_tokens: 4,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const elapsed = Date.now() - start;
    const data = (await res.json()) as any;

    console.log(`\n------------------------------------------------------------`);
    console.log(`📡 [${target.name}] Account ID: [REDACTED] (${elapsed}ms)`);

    if (res.status === 200 && data.success) {
      console.log(`✅ Status: 🟢 RESET / OPERATIONAL`);
      console.log(`🎉 Daily free neuron quota is available! Ready for FLUX.1-schnell keyframe generation.`);
      return true;
    }

    if (res.status === 429 || (data.errors && data.errors.some((e: any) => e.code === 4006 || String(e.message).includes("10,000 neurons")))) {
      console.log(`⚠️ Status: 🔴 QUOTA EXHAUSTED (HTTP ${res.status})`);
      const errorMsg = data.errors?.[0]?.message || "Daily free allocation of 10,000 neurons used up.";
      console.log(`❌ Message: [REDACTED]`);
      console.log(`ℹ️ Quota resets daily at 00:00 UTC (05:30 AM IST).`);
      return false;
    }

    console.log(`⚠️ Status: 🟡 UNEXPECTED HTTP ${res.status}`);
    console.log('Details: [REDACTED]');
    return false;
  } catch (err: any) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`📡 [${target.name}] Account ID: ${target.accountId.slice(0, 8)}...`);
    console.log(`❌ Connection Error: [REDACTED]`);
    return false;
  }
}

async function main() {
  console.log(`\n🔍 Checking Cloudflare Workers AI Daily Limit Status...`);
  console.log(`📌 Probe Model: ${MODEL} (Minimal ~0 neurons probe)`);

  const accounts: AccountTarget[] = [];

  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    accounts.push({
      name: "PRIMARY (Video Pipeline)",
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
    });
  }

  if (
    process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID &&
    process.env.SARALGATI_CLOUDFLARE_API_TOKEN &&
    process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID !== process.env.CLOUDFLARE_ACCOUNT_ID
  ) {
    accounts.push({
      name: "SARALGATI (Isolated)",
      accountId: process.env.SARALGATI_CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.SARALGATI_CLOUDFLARE_API_TOKEN,
    });
  }

  if (accounts.length === 0) {
    console.error("❌ No CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN configured in .env.");
    process.exit(1);
  }

  for (const acc of accounts) {
    await checkAccount(acc);
  }

  console.log(`\n------------------------------------------------------------\n`);
}

main().catch((err) => {
  console.error("Unexpected error:", err.message);
});

