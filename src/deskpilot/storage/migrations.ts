import type { Database } from "bun:sqlite";

interface DeskPilotMigration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: readonly DeskPilotMigration[] = [
  {
    version: 1,
    name: "initial-deskpilot-schema",
    sql: `
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        workspace_id TEXT,
        status TEXT NOT NULL CHECK (
          status IN (
            'Pending',
            'Running',
            'WaitingApproval',
            'WaitingTool',
            'Completed',
            'Failed',
            'Cancelled'
          )
        ),
        description TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        result_json TEXT,
        error TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK (transport IN ('stdio', 'streamable-http', 'tunnel')),
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
      );

      CREATE TABLE tool_permissions (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL UNIQUE,
        permission_level INTEGER NOT NULL CHECK (permission_level BETWEEN 0 AND 5),
        approval_required INTEGER NOT NULL CHECK (approval_required IN (0, 1))
      );

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Denied', 'Expired')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE activity_logs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_tasks_conversation_created
        ON tasks(conversation_id, created_at DESC);
      CREATE INDEX idx_approvals_task_created
        ON approvals(task_id, created_at DESC);
      CREATE INDEX idx_activity_logs_task_created
        ON activity_logs(task_id, created_at ASC);
    `,
  },
  {
    version: 2,
    name: "workspace-records",
    sql: `
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        canonical_root_path TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_workspaces_created
        ON workspaces(created_at DESC);
    `,
  },
  {
    version: 3,
    name: "workspace-file-change-history",
    sql: `
      CREATE TABLE file_changes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        path TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('create', 'overwrite', 'delete')),
        bytes_before INTEGER,
        bytes_after INTEGER,
        content_hash_before TEXT,
        content_hash_after TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_file_changes_workspace_created
        ON file_changes(workspace_id, created_at DESC);
      CREATE INDEX idx_file_changes_task_created
        ON file_changes(task_id, created_at ASC);
    `,
  },
] as const;

export const DESKPILOT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

export function currentDeskPilotSchemaVersion(database: Database): number {
  const table = database
    .query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { present: number } | null;
  if (!table) return 0;

  const row = database
    .query("SELECT MAX(version) AS version FROM schema_migrations")
    .get() as { version: number | null } | null;
  return row?.version ?? 0;
}

export function migrateDeskPilotDatabase(database: Database): number {
  let currentVersion = currentDeskPilotSchemaVersion(database);
  if (currentVersion > DESKPILOT_SCHEMA_VERSION) {
    throw new Error(
      `DeskPilot database schema ${currentVersion} is newer than supported schema ${DESKPILOT_SCHEMA_VERSION}`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);
      database.exec(migration.sql);
      database
        .query("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT");
      currentVersion = migration.version;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return currentVersion;
}
