import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DESKPILOT_SCHEMA_VERSION,
  currentDeskPilotSchemaVersion,
  migrateDeskPilotDatabase,
} from "./migrations";
import {
  ActivityLogRepository,
  ApprovalRepository,
  ConversationRepository,
  McpServerRepository,
  TaskRepository,
  ToolPermissionRepository,
} from "./repositories";

export class DeskPilotStore {
  readonly conversations: ConversationRepository;
  readonly mcpServers: McpServerRepository;
  readonly toolPermissions: ToolPermissionRepository;
  readonly tasks: TaskRepository;
  readonly approvals: ApprovalRepository;
  readonly activityLogs: ActivityLogRepository;

  private constructor(private readonly database: Database) {
    this.conversations = new ConversationRepository(database);
    this.mcpServers = new McpServerRepository(database);
    this.toolPermissions = new ToolPermissionRepository(database);
    this.tasks = new TaskRepository(database);
    this.approvals = new ApprovalRepository(database);
    this.activityLogs = new ActivityLogRepository(database);
  }

  static open(databasePath: string): DeskPilotStore {
    const existingDatabase = databasePath !== ":memory:"
      && existsSync(databasePath)
      && statSync(databasePath).size > 0;
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    const database = new Database(databasePath, { create: true, strict: true });
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec("PRAGMA busy_timeout = 5000");
      assertDatabaseIntegrity(database);
      const schemaVersion = currentDeskPilotSchemaVersion(database);
      if (schemaVersion > DESKPILOT_SCHEMA_VERSION) {
        throw new Error(
          `DeskPilot database schema ${schemaVersion} is newer than supported schema ${DESKPILOT_SCHEMA_VERSION}`,
        );
      }
      if (existingDatabase && schemaVersion < DESKPILOT_SCHEMA_VERSION) {
        writeMigrationRecoveryPoint(databasePath, database.serialize(), schemaVersion);
      }
      migrateDeskPilotDatabase(database);
      assertDatabaseIntegrity(database);
      return new DeskPilotStore(database);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }
}

export function deskPilotMigrationBackupPath(databasePath: string, schemaVersion: number): string {
  return `${databasePath}.pre-migration-v${schemaVersion}.bak`;
}

function writeMigrationRecoveryPoint(databasePath: string, contents: Buffer, schemaVersion: number): void {
  const backupPath = deskPilotMigrationBackupPath(databasePath, schemaVersion);
  if (existsSync(backupPath)) return;
  const temporaryPath = `${backupPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, contents, { flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, backupPath);
    try { chmodSync(backupPath, 0o600); } catch {}
    writeFileSync(`${backupPath}.meta`, `${JSON.stringify({
      schemaVersion,
      createdAt: new Date().toISOString(),
    })}\n`, { mode: 0o600 });
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function assertDatabaseIntegrity(database: Database): void {
  const rows = database.query("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
  const messages = rows.flatMap((row) => Object.values(row)).map(String);
  if (messages.length !== 1 || messages[0] !== "ok") {
    throw new Error(`DeskPilot database integrity check failed: ${messages.join("; ") || "unknown error"}`);
  }
}
