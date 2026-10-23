import { computeDeterministicEmbedding } from "../../server/db/knowledge.js";
import { getSql } from "../../server/db/store.js";
import {
  type ClientAgenticSnapshot,
  getOrCreateFileMap,
  getOrCreateMemoryMap,
  getOrCreateScheduleState,
  getOrCreateTaskState,
  getTenantAgenticSnapshot,
} from "./store.js";

/**
 * Durable persistence for the agentic stores.
 *
 * The in-memory maps are the working set; Neon is the durable copy that keeps a
 * serverless cold start or a second instance from losing a tenant's workspace.
 * Persistence is best-effort: the tool result must never fail because the
 * optional database is unreachable.
 */

let agenticStateTableReady = false;
const hydratedTenants = new Set<string>();

async function ensureAgenticStateTable(sql: any): Promise<void> {
  if (agenticStateTableReady || !sql) return;
  try {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS shunops_agentic_state (
        tenant_key VARCHAR(64) PRIMARY KEY,
        state_json JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    agenticStateTableReady = true;
  } catch {}
}

/**
 * Hydrate in-memory stores from Neon if this container instance has not loaded
 * the tenant yet, merging non-destructively so neither side loses records.
 */
export async function hydrateTenantAgenticState(tenantKey: string, force = false): Promise<void> {
  if (!tenantKey || (hydratedTenants.has(tenantKey) && !force)) return;
  hydratedTenants.add(tenantKey);
  const sql = getSql() as any;
  if (!sql) return;
  try {
    await ensureAgenticStateTable(sql);
    const rows = await sql.query(
      `SELECT state_json FROM shunops_agentic_state WHERE tenant_key = $1 LIMIT 1;`,
      [tenantKey]
    );
    const raw = rows?.[0]?.state_json;
    if (!raw) return;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    mergeSnapshotIntoStores(tenantKey, parsed, false);
  } catch {}
}

/**
 * Write the current tenant snapshot to Neon so cold starts and multi-instance
 * routing never reset workspace records.
 */
export async function persistTenantAgenticState(tenantKey: string): Promise<void> {
  if (!tenantKey) return;
  const sql = getSql() as any;
  if (!sql) return;
  try {
    await ensureAgenticStateTable(sql);
    const snap = getTenantAgenticSnapshot(tenantKey);
    await sql.query(
      `INSERT INTO shunops_agentic_state (tenant_key, state_json, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_key) DO UPDATE
       SET state_json = EXCLUDED.state_json,
           updated_at = CURRENT_TIMESTAMP;`,
      [tenantKey, JSON.stringify(snap)]
    );
  } catch {}
}

function mergeFiles(
  tenantKey: string,
  files: NonNullable<ClientAgenticSnapshot["files"]>,
  overwriteExisting: boolean
): void {
  const fileMap = getOrCreateFileMap(tenantKey);
  for (const f of files) {
    if (!f || typeof f.name !== "string" || !f.name.trim()) continue;
    if (!overwriteExisting && fileMap.has(f.name)) continue;
    const contentStr = String(f.content ?? "");
    fileMap.set(f.name, {
      name: f.name,
      content: contentStr,
      sizeBytes:
        typeof f.sizeBytes === "number" ? f.sizeBytes : Buffer.byteLength(contentStr, "utf8"),
      updatedAt: f.updatedAt || new Date().toISOString(),
    });
  }
}

function mergeTasks(
  tenantKey: string,
  tasks: NonNullable<ClientAgenticSnapshot["tasks"]>,
  overwriteExisting: boolean
): void {
  const taskState = getOrCreateTaskState(tenantKey);
  for (const t of tasks) {
    if (!t || typeof t.title !== "string" || !t.title.trim()) continue;
    const id = Number(t.id) > 0 ? Number(t.id) : taskState.nextId++;
    if (id >= taskState.nextId) taskState.nextId = id + 1;
    if (!overwriteExisting && taskState.tasks.has(id)) continue;
    taskState.tasks.set(id, {
      id,
      title: t.title,
      status: t.status === "completed" || t.status === "in_progress" ? t.status : "pending",
      priority: t.priority === "high" || t.priority === "low" ? t.priority : "medium",
      ...(t.notes ? { notes: String(t.notes) } : {}),
      createdAt: t.createdAt || new Date().toISOString(),
      updatedAt: t.updatedAt || new Date().toISOString(),
    });
  }
}

function mergeMemories(
  tenantKey: string,
  memories: NonNullable<ClientAgenticSnapshot["memories"]>,
  overwriteExisting: boolean
): void {
  const memMap = getOrCreateMemoryMap(tenantKey);
  for (const m of memories) {
    if (!m || typeof m.key !== "string" || !m.key.trim() || typeof m.fact !== "string") continue;
    if (!overwriteExisting && memMap.has(m.key)) continue;
    memMap.set(m.key, {
      key: m.key,
      fact: m.fact,
      tags: Array.isArray(m.tags) ? m.tags : [],
      embedding: computeDeterministicEmbedding(`${m.key} ${m.fact}`),
      updatedAt: m.updatedAt || new Date().toISOString(),
    });
  }
}

function mergeSchedules(
  tenantKey: string,
  schedules: NonNullable<ClientAgenticSnapshot["schedules"]>,
  overwriteExisting: boolean
): void {
  const schedState = getOrCreateScheduleState(tenantKey);
  for (const s of schedules) {
    if (!s || typeof s.name !== "string" || !s.name.trim()) continue;
    const id = Number(s.id) > 0 ? Number(s.id) : schedState.nextId++;
    if (id >= schedState.nextId) schedState.nextId = id + 1;
    if (overwriteExisting || !schedState.schedules.has(id)) {
      schedState.schedules.set(id, { ...s, id });
    }
  }
}

/**
 * Merge a snapshot (from the database or a client cache) into the in-memory
 * stores without wiping existing records. Purely synchronous — this must never
 * re-enter hydration.
 */
export function mergeSnapshotIntoStores(
  tenantKey: string,
  snap: ClientAgenticSnapshot,
  overwriteExisting = false
): void {
  if (!snap || typeof snap !== "object") return;

  if (Array.isArray(snap.files) && snap.files.length > 0) {
    mergeFiles(tenantKey, snap.files, overwriteExisting);
  }
  if (Array.isArray(snap.tasks) && snap.tasks.length > 0) {
    mergeTasks(tenantKey, snap.tasks, overwriteExisting);
  }
  if (Array.isArray(snap.memories) && snap.memories.length > 0) {
    mergeMemories(tenantKey, snap.memories, overwriteExisting);
  }
  if (Array.isArray(snap.schedules) && snap.schedules.length > 0) {
    mergeSchedules(tenantKey, snap.schedules, overwriteExisting);
  }
}

/**
 * Full non-destructive sync: hydrate from the database, fold in client-cached
 * state (needed after a cold start), persist the union and return it.
 */
export async function syncTenantAgenticState(
  tenantKey: string,
  clientSnapshot?: ClientAgenticSnapshot
) {
  await hydrateTenantAgenticState(tenantKey, true);
  if (clientSnapshot) {
    mergeSnapshotIntoStores(tenantKey, clientSnapshot, false);
  }
  await persistTenantAgenticState(tenantKey);
  return getTenantAgenticSnapshot(tenantKey);
}
