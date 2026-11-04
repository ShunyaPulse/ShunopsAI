/**
 * ShunopsAI & SaralGati Unified Cloudflare Edge Cron Dispatcher
 *
 * Solves GitHub Actions' 5-7 hour cron queue delay:
 * - Triggers directly on Cloudflare global edge with 0ms delay
 * - Dispatches workflows via GitHub REST API (workflow_dispatch) in <2s
 * - Handles:
 *   1. "0 10 * * *" -> ShunopsAI generate-video.yml (Daily 3:30 PM IST)
 *   2. "23 * * * *" -> SaralGati self_learning_flywheel.yml (Hourly minute 23)
 */

async function triggerSaralGati(env) {
  const url =
    "https://api.github.com/repos/ShunyaPulse/SaralGati/actions/workflows/self_learning_flywheel.yml/dispatches";

  console.log("Triggering SaralGati Flywheel workflow at", new Date().toISOString());

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "Cloudflare-Cron-Worker/1.0",
    },
    body: JSON.stringify({
      ref: "main",
    }),
  });

  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text, target: "saralgati" };
}

async function triggerShunopsVideo(env) {
  const url =
    "https://api.github.com/repos/ShunyaPulse/ShunopsAI/actions/workflows/generate-video.yml/dispatches";

  console.log("Triggering ShunopsAI Video Pipeline at", new Date().toISOString());

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "Cloudflare-Cron-Worker/1.0",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        video_type: "trend",
        language: "Hindi",
        minutes: "3",
      },
    }),
  });

  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text, target: "shunops-video" };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const target = url.searchParams.get("target");

    let result;
    if (target === "video") {
      result = await triggerShunopsVideo(env);
    } else if (target === "saralgati") {
      result = await triggerSaralGati(env);
    } else {
      result = {
        video: await triggerShunopsVideo(env),
        saralgati: await triggerSaralGati(env),
      };
    }

    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },

  async scheduled(event, env, ctx) {
    console.log("Cloudflare Cron triggered with schedule:", event.cron);

    if (event.cron === "0 10 * * *") {
      const result = await triggerShunopsVideo(env);
      if (!result.ok) {
        console.error("Failed to trigger Shunops Video workflow. Status:", result.status, "Body:", result.body);
      } else {
        console.log("Successfully triggered ShunopsAI Video generate-video.yml!");
      }
    } else {
      const result = await triggerSaralGati(env);
      if (!result.ok) {
        console.error("Failed to trigger SaralGati workflow. Status:", result.status, "Body:", result.body);
      } else {
        console.log("Successfully triggered SaralGati self_learning_flywheel.yml!");
      }
    }
  },
};
