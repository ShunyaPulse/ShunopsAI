import { getSql } from "./store.js";

export interface SchemaMigration {
  version: number;
  name: string;
  up: (sql: any) => Promise<void>;
}

export const MIGRATIONS: SchemaMigration[] = [
  {
    version: 1,
    name: "001_core_saas_tables",
    up: async (sql) => {
      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(64) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE,
          password_hash VARCHAR(255),
          google_id VARCHAR(255) UNIQUE,
          github_id VARCHAR(255) UNIQUE,
          email_verified BOOLEAN DEFAULT FALSE,
          role VARCHAR(32) DEFAULT 'user',
          plan VARCHAR(32) DEFAULT 'community',
          query_count INTEGER DEFAULT 0,
          input_tokens BIGINT DEFAULT 0,
          output_tokens BIGINT DEFAULT 0,
          total_tokens BIGINT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_email_otps (
          email VARCHAR(255) PRIMARY KEY,
          otp VARCHAR(10) NOT NULL,
          attempts INTEGER DEFAULT 0,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_sessions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES shunops_users(id) ON DELETE CASCADE,
          token VARCHAR(128) UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_user_workspaces (
          id SERIAL PRIMARY KEY,
          user_id INTEGER UNIQUE NOT NULL REFERENCES shunops_users(id) ON DELETE CASCADE,
          name VARCHAR(128) DEFAULT 'Default Workspace',
          settings JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_sessions_token ON shunops_sessions(token);`);
      await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_users_username ON shunops_users(username);`);
      await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_users_email ON shunops_users(email);`);
    },
  },
  {
    version: 2,
    name: "002_multi_tenant_tasks",
    up: async (sql) => {
      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_tasks (
          id VARCHAR(64) PRIMARY KEY,
          user_id INTEGER REFERENCES shunops_users(id) ON DELETE CASCADE,
          goal TEXT NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
          steps_taken INTEGER DEFAULT 0,
          final_answer TEXT,
          error TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMPTZ
        );
      `);
      await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_tasks_user_id ON shunops_tasks(user_id);`);
    },
  },
  {
    version: 3,
    name: "003_conversation_persistence",
    up: async (sql) => {
      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_chat_messages (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES shunops_users(id) ON DELETE CASCADE,
          role VARCHAR(16) NOT NULL,
          message TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_chat_messages_user ON shunops_chat_messages(user_id, created_at);`);
    },
  },
  {
    version: 4,
    name: "004_personal_api_keys",
    up: async (sql) => {
      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_api_keys (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES shunops_users(id) ON DELETE CASCADE,
          key_hash VARCHAR(128) UNIQUE NOT NULL,
          key_prefix VARCHAR(16) NOT NULL,
          name VARCHAR(128) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          last_used_at TIMESTAMPTZ
        );
      `);
      await (sql as any).query(`CREATE INDEX IF NOT EXISTS idx_shunops_api_keys_hash ON shunops_api_keys(key_hash);`);
    },
  },
  {
    version: 5,
    name: "005_metering_and_plans",
    up: async (sql) => {
      await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS plan VARCHAR(32) DEFAULT 'community';`);
      await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS query_count INTEGER DEFAULT 0;`);
      await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`);
    },
  },
  {
    version: 6,
    name: "006_token_metering",
    up: async (sql) => {
      await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS input_tokens BIGINT DEFAULT 0;`);
      await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS output_tokens BIGINT DEFAULT 0;`);
      await (sql as any).query(`ALTER TABLE shunops_users ADD COLUMN IF NOT EXISTS total_tokens BIGINT DEFAULT 0;`);
    },
  },
  {
    version: 7,
    name: "007_hybrid_knowledge_search",
    up: async (sql) => {
      // 1. Attempt to enable pgvector extension (Neon natively supports it)
      try {
        await (sql as any).query(`CREATE EXTENSION IF NOT EXISTS vector;`);
      } catch {}

      // 2. Knowledge documents table
      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_knowledge_documents (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          category VARCHAR(64) DEFAULT 'general',
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 3. Add full-text TSVECTOR column and GIN index
      try {
        await (sql as any).query(`
          ALTER TABLE shunops_knowledge_documents 
          ADD COLUMN IF NOT EXISTS tsv TSVECTOR 
          GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content)) STORED;
        `);
        await (sql as any).query(`
          CREATE INDEX IF NOT EXISTS idx_shunops_knowledge_tsv 
          ON shunops_knowledge_documents USING GIN(tsv);
        `);
      } catch {}

      // 4. Try adding vector embedding column if vector extension is active
      try {
        await (sql as any).query(`
          ALTER TABLE shunops_knowledge_documents 
          ADD COLUMN IF NOT EXISTS embedding vector(768);
        `);
      } catch {}
    },
  },
  {
    version: 8,
    name: "008_user_platform_credentials",
    up: async (sql) => {
      // One row per (user, platform): a user's OWN Neon/Redis/GitHub/Cloudflare
      // credential. Secrets are AES-256-GCM encrypted before they reach this
      // table, so a database dump alone cannot be replayed against a provider.
      await (sql as any).query(`
        CREATE TABLE IF NOT EXISTS shunops_user_platform_credentials (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES shunops_users(id) ON DELETE CASCADE,
          platform VARCHAR(32) NOT NULL,
          label VARCHAR(64),
          secret_hint VARCHAR(64),
          secret_payload TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, platform)
        );
      `);

      await (sql as any).query(
        `CREATE INDEX IF NOT EXISTS idx_shunops_platform_credentials_user ON shunops_user_platform_credentials(user_id);`
      );
    },
  },
];

/**
 * Execute versioned database migrations.
 */
export async function runDatabaseMigrations(): Promise<{ applied: string[]; currentVersion: number }> {
  const sql = getSql();
  if (!sql) {
    return { applied: [], currentVersion: MIGRATIONS.length };
  }

  await (sql as any).query(`
    CREATE TABLE IF NOT EXISTS shunops_schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedRows = await (sql as any).query(`SELECT version FROM shunops_schema_migrations;`);
  const appliedSet = new Set((appliedRows || []).map((r: any) => Number(r.version)));

  const appliedNow: string[] = [];
  for (const migration of MIGRATIONS) {
    if (!appliedSet.has(migration.version)) {
      await migration.up(sql);
      await (sql as any).query(
        `INSERT INTO shunops_schema_migrations (version, name) VALUES ($1, $2);`,
        [migration.version, migration.name]
      );
      appliedNow.push(migration.name);
    }
  }

  const latestRow = await (sql as any).query(`SELECT MAX(version) as current_version FROM shunops_schema_migrations;`);
  const currentVersion = Number(latestRow?.[0]?.current_version || 0);

  return { applied: appliedNow, currentVersion };
}

/**
 * Backward-compatible schema initializer that executes versioned migrations.
 */
export async function initDatabaseSchema(): Promise<void> {
  await runDatabaseMigrations();
}
