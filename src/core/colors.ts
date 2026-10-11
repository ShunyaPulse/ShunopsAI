/**
 * Shared ANSI colour palette for terminal output.
 *
 * Centralised here so the agent loop, consensus engine, and self-healing
 * tools all render logs with a single consistent style.
 */
export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
} as const;

export type Colors = typeof colors;
