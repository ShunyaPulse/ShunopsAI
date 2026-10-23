/**
 * Normalize an unknown thrown value into a human-readable message, preserving
 * the `err.message` / `String(err)` fallback the callers rely on.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === "object" && err !== null && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message || String(err);
  }
  return String(err);
}
