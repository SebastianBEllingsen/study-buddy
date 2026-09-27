import type Database from "better-sqlite3";
import { syncTables, type SyncTable } from "./tables";

// The local (SQLite) half of sync: an outbox of rows changed on this
// computer, filled by triggers on every table, plus a little state. Rows
// written while applying changes pulled from the cloud don't go into the
// outbox (sync_control.applying), or they'd be pushed straight back.

export function ensureLocalSyncTables(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS sync_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_key TEXT NOT NULL,
      changed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_key ON sync_outbox(table_name, row_key);
    CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_control (id INTEGER PRIMARY KEY CHECK (id = 1), applying INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO sync_control (id, applying) VALUES (1, 0);
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_key TEXT NOT NULL,
      resolution TEXT NOT NULL,
      at TEXT NOT NULL
    );
  `);
}

// A row's key as stored in the outbox and the cloud change log: a JSON
// array of its primary key values, in key column order.
function keySql(table: SyncTable, row: "NEW" | "OLD"): string {
  return `json_array(${table.key.map((c) => `${row}."${c}"`).join(", ")})`;
}

const NOW = `strftime('%Y-%m-%d %H:%M:%f', 'now')`;

export function installTriggers(conn: Database.Database): void {
  ensureLocalSyncTables(conn);
  const statements: string[] = [];
  for (const table of syncTables()) {
    const when = `WHEN (SELECT applying FROM sync_control WHERE id = 1) = 0`;
    const insert = (row: "NEW" | "OLD") =>
      `INSERT INTO sync_outbox (table_name, row_key, changed_at) VALUES ('${table.name}', ${keySql(table, row)}, ${NOW});`;
    for (const [op, row] of [["INSERT", "NEW"], ["UPDATE", "NEW"], ["DELETE", "OLD"]] as const) {
      statements.push(
        `CREATE TRIGGER IF NOT EXISTS "sync_${table.name}_${op.toLowerCase()}" AFTER ${op} ON "${table.name}" ${when} BEGIN ${insert(row)} END;`
      );
    }
    // An update that changes the key itself also leaves the old key behind.
    statements.push(
      `CREATE TRIGGER IF NOT EXISTS "sync_${table.name}_rekey" AFTER UPDATE ON "${table.name}" ${when} AND ${keySql(table, "OLD")} <> ${keySql(table, "NEW")} BEGIN ${insert("OLD")} END;`
    );
  }
  conn.exec(statements.join("\n"));
}

export function removeTriggers(conn: Database.Database): void {
  const triggers = conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync\\_%' ESCAPE '\\'")
    .all() as { name: string }[];
  for (const { name } of triggers) conn.exec(`DROP TRIGGER IF EXISTS "${name}"`);
}

export function getSyncState(conn: Database.Database, key: string): string | null {
  const row = conn.prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSyncState(conn: Database.Database, key: string, value: string): void {
  conn.prepare("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// Runs `fn` with change capture off (and foreign keys unchecked, since
// pulled rows can arrive children-first), in one transaction.
export function applyingRemote<T>(conn: Database.Database, fn: () => T): T {
  conn.pragma("foreign_keys = OFF");
  try {
    return conn.transaction(() => {
      conn.prepare("UPDATE sync_control SET applying = 1 WHERE id = 1").run();
      try {
        return fn();
      } finally {
        conn.prepare("UPDATE sync_control SET applying = 0 WHERE id = 1").run();
      }
    })();
  } finally {
    conn.pragma("foreign_keys = ON");
  }
}

export interface OutboxEntry {
  seq: number;
  table_name: string;
  row_key: string;
  changed_at: string;
}

export function readOutbox(conn: Database.Database, limit = 5000): OutboxEntry[] {
  return conn.prepare("SELECT seq, table_name, row_key, changed_at FROM sync_outbox ORDER BY seq LIMIT ?").all(limit) as OutboxEntry[];
}

export function outboxCount(conn: Database.Database): number {
  return (conn.prepare("SELECT count(*) AS n FROM sync_outbox").get() as { n: number }).n;
}

export function clearOutboxThrough(conn: Database.Database, seq: number): void {
  conn.prepare("DELETE FROM sync_outbox WHERE seq <= ?").run(seq);
}

// The newest local change to a row still waiting to be pushed, if any.
export function pendingChangeAt(conn: Database.Database, table: string, rowKey: string): string | null {
  const row = conn
    .prepare("SELECT max(changed_at) AS at FROM sync_outbox WHERE table_name = ? AND row_key = ?")
    .get(table, rowKey) as { at: string | null };
  return row.at;
}

export function dropPending(conn: Database.Database, table: string, rowKey: string): void {
  conn.prepare("DELETE FROM sync_outbox WHERE table_name = ? AND row_key = ?").run(table, rowKey);
}

export function recordConflict(conn: Database.Database, table: string, rowKey: string, resolution: string): void {
  conn
    .prepare(`INSERT INTO sync_conflicts (table_name, row_key, resolution, at) VALUES (?, ?, ?, ${NOW})`)
    .run(table, rowKey, resolution);
  conn.prepare("DELETE FROM sync_conflicts WHERE id NOT IN (SELECT id FROM sync_conflicts ORDER BY id DESC LIMIT 50)").run();
}
