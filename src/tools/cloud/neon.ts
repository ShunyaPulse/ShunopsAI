import { neon } from "@neondatabase/serverless";

/**
 * Neon / Supabase Postgres query tool (HTTP driver, no pooled socket).
 */
export async function executeNeonSql(
  query: string,
  /** Per-user connection string. When present it is the ONLY database touched. */
  opts: { connectionString?: string } = {}
): Promise<string> {
  const dbUrl =
    opts.connectionString ||
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.SARALGATI_DATABASE_URL;
  if (!dbUrl) {
    return "Error: Neither DATABASE_URL nor NEON_DATABASE_URL is set in .env. Please configure your Postgres connection string.";
  }

  try {
    const sql = neon(dbUrl);
    const rows = await (sql as any).query(query);
    return `Neon SQL Result (${rows.length} rows):\n${JSON.stringify(rows, null, 2)}`;
  } catch (error: any) {
    return `Neon SQL Error: ${error.message}`;
  }
}
