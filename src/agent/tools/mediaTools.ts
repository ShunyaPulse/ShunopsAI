import { startVideoJob, manageKaggle, publishJobToYouTube } from "../../tools/video.js";
import type { ToolGroup } from "./types.js";

/** Long-form video pipeline tools backed by Gemini + Kaggle GPU kernels. */
export const mediaTools: ToolGroup<
  "produce_video" | "manage_kaggle" | "publish_to_youtube"
> = {
  produce_video: {
    schema: {
      type: "function",
      function: {
        name: "produce_video",
        description:
          "Starts the autonomous long-form YouTube video pipeline: Gemini writes a SEO script (title, description, tags, chapters, scenes), then a Kaggle GPU kernel renders narration (edge-tts), visuals, Ken Burns editing, and word-accurate captions into an MP4. Returns a kernel ref immediately; observe it with manage_kaggle.",
        parameters: {
          type: "object",
          properties: {
            topic: { type: "string", description: "Video topic / angle" },
            minutes: { type: "number", description: "Target length in minutes (4-10, default 5)" },
            language: { type: "string", description: "Narration language, e.g. 'English' or 'Hindi' (default English)" },
          },
          required: ["topic"],
        },
      },
    },
    execute: async (args: { topic: string; minutes?: number; language?: string }) => {
      const mins = Math.min(Math.max(args.minutes ?? 5, 1), 10);
      try {
        return await startVideoJob(args.topic, mins, args.language || "English");
      } catch (e: any) {
        return `produce_video failed: ${e.message}`;
      }
    },
  },

  manage_kaggle: {
    schema: {
      type: "function",
      function: {
        name: "manage_kaggle",
        description:
          "Observe Kaggle kernels (model training or video renders): list your kernels, check run status, or download output files and the execution log tail.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["list", "status", "output"], description: "list | status | output" },
            ref: { type: "string", description: "Kernel ref 'owner/slug' (required for status/output)" },
          },
          required: ["action"],
        },
      },
    },
    execute: async (args: { action: "list" | "status" | "output"; ref?: string }) => {
      return await manageKaggle(args.action, args.ref);
    },
  },

  publish_to_youtube: {
    schema: {
      type: "function",
      function: {
        name: "publish_to_youtube",
        description:
          "Uploads a rendered video job to YouTube with title, custom thumbnail, chapters, tags, SEO description, and private visibility.",
        parameters: {
          type: "object",
          properties: {
            jobIdOrPath: {
              type: "string",
              description: "Job ID (e.g. 'muthvnxq') or directory path containing video.mp4 and meta.json (e.g. 'output')",
            },
            privacy: {
              type: "string",
              enum: ["private", "unlisted", "public"],
              description: "Visibility status on YouTube (defaults to 'private')",
            },
          },
          required: ["jobIdOrPath"],
        },
      },
    },
    execute: async (args: { jobIdOrPath: string; privacy?: "private" | "unlisted" | "public" }) => {
      return await publishJobToYouTube(args.jobIdOrPath, args.privacy || "private");
    },
  },
};
