import { Type, type Static } from "@sinclair/typebox";

/**
 * Standardized Cloud Alert Envelope schema.
 * Normalizes alert payloads across GCP Cloud Run, UptimeRobot, GitHub, Cloudflare, and n8n.
 */
export const CloudAlertEnvelopeSchema = Type.Object({
  source: Type.Optional(
    Type.Union([
      Type.Literal("gcp"),
      Type.Literal("github"),
      Type.Literal("uptimerobot"),
      Type.Literal("betterstack"),
      Type.Literal("cloudflare"),
      Type.Literal("n8n"),
      Type.Literal("custom"),
    ])
  ),
  service: Type.Optional(
    Type.Union([
      Type.Literal("cloud_run"),
      Type.Literal("redis"),
      Type.Literal("neon"),
      Type.Literal("cloudflare_ai"),
      Type.Literal("kaggle"),
      Type.Literal("website"),
      Type.Literal("all"),
    ])
  ),
  severity: Type.Optional(
    Type.Union([
      Type.Literal("critical"),
      Type.Literal("warning"),
      Type.Literal("info"),
    ])
  ),
  targetUrl: Type.Optional(Type.String({ maxLength: 2048 })),
  message: Type.Optional(Type.String({ maxLength: 8000 })),
  rawAlert: Type.Optional(Type.Any()),
}, { additionalProperties: true });

export type CloudAlertEnvelope = Static<typeof CloudAlertEnvelopeSchema>;

export const TaskRequestSchema = Type.Object({
  goal: Type.Optional(Type.String({ maxLength: 8000 })),
  task: Type.Optional(Type.String({ maxLength: 8000 })),
  prompt: Type.Optional(Type.String({ maxLength: 8000 })),
  message: Type.Optional(Type.String({ maxLength: 8000 })),
  maxSteps: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
  context: Type.Optional(Type.String({ maxLength: 20000 })),
  async: Type.Optional(Type.Boolean()),
});

export type TaskRequest = Static<typeof TaskRequestSchema>;

export const ChatRequestSchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 4000 }),
  history: Type.Optional(Type.String({ maxLength: 8000 })),
});

export type ChatRequest = Static<typeof ChatRequestSchema>;

export const ApproveRequestSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  approved: Type.Boolean(),
});

export type ApproveRequest = Static<typeof ApproveRequestSchema>;
