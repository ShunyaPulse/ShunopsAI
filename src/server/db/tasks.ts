import { getSql, memStore } from "./store.js";

// ==========================================
// MULTI-TENANT TASKS PERSISTENCE & ISOLATION
// ==========================================

export interface TaskRecordInput {
  id: string;
  userId?: number | undefined;
  goal: string;
  status: string;
  stepsTaken?: number | undefined;
  finalAnswer?: string | undefined;
  error?: string | undefined;
  createdAt?: string | undefined;
  completedAt?: string | undefined;
}

export async function saveTaskRecord(task: TaskRecordInput): Promise<void> {
  const sql = getSql();
  if (!sql) {
    memStore.tasks.set(task.id, {
      ...task,
      user_id: task.userId,
      steps_taken: task.stepsTaken || 0,
      final_answer: task.finalAnswer,
      created_at: task.createdAt || new Date().toISOString(),
      completed_at: task.completedAt,
    });
    return;
  }

  await (sql as any).query(
    `INSERT INTO shunops_tasks (id, user_id, goal, status, steps_taken, final_answer, error, created_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       steps_taken = EXCLUDED.steps_taken,
       final_answer = EXCLUDED.final_answer,
       error = EXCLUDED.error,
       completed_at = EXCLUDED.completed_at;`,
    [
      task.id,
      task.userId || null,
      task.goal,
      task.status,
      task.stepsTaken || 0,
      task.finalAnswer || null,
      task.error || null,
      task.createdAt ? new Date(task.createdAt) : new Date(),
      task.completedAt ? new Date(task.completedAt) : null,
    ]
  );
}

export async function getTaskRecord(taskId: string): Promise<any | null> {
  const sql = getSql();
  if (!sql) {
    return memStore.tasks.get(taskId) || null;
  }
  const rows = await (sql as any).query(
    `SELECT id, user_id, goal, status, steps_taken, final_answer, error, created_at, completed_at FROM shunops_tasks WHERE id = $1 LIMIT 1;`,
    [taskId]
  );
  return rows[0] || null;
}

export async function listUserTasks(
  userId: number,
  limit = 50,
  options: { isAdmin?: boolean } = {}
): Promise<any[]> {
  const sql = getSql();
  if (!sql) {
    return Array.from(memStore.tasks.values())
      .filter((t) => {
        if (options.isAdmin && userId <= 0) return true;
        if (options.isAdmin) return t.user_id === userId || !t.user_id;
        return t.user_id === userId;
      })
      .slice(-limit)
      .reverse();
  }
  if (options.isAdmin && userId <= 0) {
    const rows = await (sql as any).query(
      `SELECT id, user_id, goal, status, steps_taken, final_answer, error, created_at, completed_at
       FROM shunops_tasks ORDER BY created_at DESC LIMIT $1;`,
      [limit]
    );
    return rows || [];
  }
  if (options.isAdmin) {
    const rows = await (sql as any).query(
      `SELECT id, user_id, goal, status, steps_taken, final_answer, error, created_at, completed_at
       FROM shunops_tasks WHERE user_id = $1 OR user_id IS NULL ORDER BY created_at DESC LIMIT $2;`,
      [userId, limit]
    );
    return rows || [];
  }
  const rows = await (sql as any).query(
    `SELECT id, user_id, goal, status, steps_taken, final_answer, error, created_at, completed_at
     FROM shunops_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2;`,
    [userId, limit]
  );
  return rows || [];
}
