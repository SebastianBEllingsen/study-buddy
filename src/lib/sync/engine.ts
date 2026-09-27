import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { enqueue } from "../db/operationQueue";
import { replaceDatabaseContents, writeSnapshot } from "../backup/snapshot";
import * as pgSchema from "../db/schema.pg";
import {
  applyingRemote,
  clearOutboxThrough,
  dropPending,
  getSyncState,
  pendingChangeAt,
  readOutbox,
  recordConflict,
  setSyncState,
} from "./local";
import { changesSince, latestChangeSeq, prunedThrough, rowsOf, touchDevice, type CloudDb } from "./cloud";
import type { IdAllocator } from "./ids";
import { syncTable, type SyncTable } from "./tables";

// Moving changes between this computer's database and the cloud. Pull
// first (so conflicts are seen before anything is overwritten), then push.
//
// Conflicts — a row changed here and in the cloud since the last sync,
// which only happens when a computer worked offline while another was used
// — go to whichever change is newer, except notes and canvases, where the
// older version is kept as a "conflicted copy" so no writing is ever lost.

export interface SyncContext {
  conn: Database.Database; // this computer's SQLite connection
  local: LocalDb; // Drizzle over it (unwrapped — ids are explicit here)
  cloud: CloudDb & CloudDrizzle;
  deviceId: string;
  ids: IdAllocator;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle's builders are
   typed per dialect/table; sync handles every table generically. */
type LocalDb = { select: any; insert: any; delete: any };
type CloudDrizzle = { select: any; insert: any; delete: any };
/* eslint-enable @typescript-eslint/no-explicit-any */

const KEEP_BOTH = new Set(["notes", "canvases"]);

// Keys are JSON arrays of the key values; SQLite and Postgres space them
// differently.
export function canonicalKey(key: string): string {
  return JSON.stringify(JSON.parse(key));
}

function column(table: SyncTable, side: "sqlite" | "pg", name: string) {
  return (table[side] as unknown as Record<string, never>)[name];
}

function keyCondition(table: SyncTable, side: "sqlite" | "pg", values: unknown[]): SQL {
  return and(...table.key.map((c, i) => eq(column(table, side, c), values[i] as never))) as SQL;
}

function withoutNulBytes(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "string" && v.includes("\0") ? v.replace(/\0/g, "") : v;
  return out;
}

function nonKeySet(table: SyncTable, side: "sqlite" | "pg", row: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const name of Object.keys(row)) {
    if (!table.key.includes(name)) set[name] = sql.raw(`excluded."${name}"`);
  }
  return set;
}

// ---- Push -----------------------------------------------------------------

// Changes go up in batches. A batch can hold a row whose parent is only in
// a later one (foreign keys are checked at commit) — then everything
// waiting goes up together instead; the parent exists locally, so it's in
// that set or already in the cloud.
export const PUSH_BATCH = 5000;

export async function push(ctx: SyncContext, batchSize = PUSH_BATCH): Promise<number> {
  try {
    return await pushBatch(ctx, batchSize);
  } catch (err) {
    if (pgErrorCode(err) !== "23503" || batchSize === Infinity) throw err;
    return pushBatch(ctx, Infinity);
  }
}

async function pushBatch(ctx: SyncContext, limit: number): Promise<number> {
  // Read under the same queue as the app's transactions, so a half-done
  // transaction's rows are never sent.
  const batch = await enqueue(async () => {
    const entries = readOutbox(ctx.conn, limit === Infinity ? -1 : limit);
    if (entries.length === 0) return null;
    const lastChange = new Map<string, string>();
    for (const entry of entries) lastChange.set(`${entry.table_name}:${entry.row_key}`, entry.changed_at);
    const seen = new Set<string>();
    const ops: { table: SyncTable; key: unknown[]; row: Record<string, unknown> | null; at: string }[] = [];
    for (const entry of entries) {
      const id = `${entry.table_name}:${entry.row_key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const table = syncTable(entry.table_name);
      if (!table) continue;
      const key = JSON.parse(entry.row_key) as unknown[];
      const [row] = await ctx.local.select().from(table.sqlite).where(keyCondition(table, "sqlite", key));
      ops.push({ table, key, row: row ?? null, at: lastChange.get(id)! });
    }
    return { ops, lastSeq: entries[entries.length - 1].seq };
  });
  if (!batch) return 0;

  await ctx.cloud.transaction(async (tx) => {
    const cloud = tx as CloudDb & CloudDrizzle;
    await cloud.execute(sql`select set_config('study_buddy.device', ${ctx.deviceId}, true)`);
    await cloud.execute(sql`set constraints all deferred`);
    for (const op of batch.ops) {
      await cloud.execute(sql`select set_config('study_buddy.changed_at', ${`${op.at}Z`}, true)`);
      if (op.row) await upsertToCloud(cloud, op.table, withoutNulBytes(op.row));
      else await cloud.delete(op.table.pg).where(keyCondition(op.table, "pg", op.key));
    }
  });
  await enqueue(async () => clearOutboxThrough(ctx.conn, batch.lastSeq));
  await touchDevice(ctx.cloud, ctx.deviceId, "push");
  return batch.ops.length;
}

// Postgres's error code — Drizzle wraps driver errors, keeping the
// original as `cause`.
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

// Upsert by key. A clash on another unique column (e.g. both computers
// set an exam date for the same course) is settled for the row being
// pushed — the one this computer just wrote.
async function upsertToCloud(cloud: CloudDb & CloudDrizzle, table: SyncTable, row: Record<string, unknown>) {
  const target = table.key.map((c) => column(table, "pg", c));
  const upsert = (db: CloudDrizzle) =>
    db.insert(table.pg).values(row).onConflictDoUpdate({ target, set: nonKeySet(table, "pg", row) });
  if (table.unique.length === 0) return upsert(cloud);
  try {
    await cloud.transaction(async (sp) => upsert(sp as CloudDb & CloudDrizzle));
  } catch (err) {
    if (pgErrorCode(err) !== "23505") throw err;
    for (const cols of table.unique) {
      await cloud
        .delete(table.pg)
        .where(and(...cols.map((c) => eq(column(table, "pg", c), row[c] as never))));
    }
    await upsert(cloud);
  }
}

// ---- Pull -----------------------------------------------------------------

export class NeedsFullRefresh extends Error {}

export async function pull(ctx: SyncContext): Promise<{ applied: number; conflicts: number }> {
  let last = Number(getSyncState(ctx.conn, "last_pulled_seq") ?? 0);
  if (last < (await prunedThrough(ctx.cloud))) throw new NeedsFullRefresh();
  let applied = 0;
  let conflicts = 0;
  for (;;) {
    const changes = await changesSince(ctx.cloud, last);
    if (changes.length === 0) break;
    const lastSeq = changes[changes.length - 1].seq;
    // Newest change per row, from other computers only.
    const latest = new Map<string, { table: SyncTable; key: string; at: string }>();
    for (const c of changes) {
      if (c.device === ctx.deviceId) continue;
      const table = syncTable(c.table_name);
      if (!table) continue;
      const key = canonicalKey(c.row_key);
      latest.set(`${c.table_name}:${key}`, { table, key, at: c.changed_at });
    }
    const rows = await fetchCloudRows(ctx, [...latest.values()]);
    const result = await enqueue(async () =>
      applyingRemote(ctx.conn, () => {
        let n = 0;
        let clashes = 0;
        for (const [id, change] of latest) {
          const remote = rows.get(id) ?? null;
          const pendingAt = pendingChangeAt(ctx.conn, change.table.name, change.key);
          if (pendingAt) {
            clashes++;
            resolveConflict(ctx, change.table, change.key, remote, pendingAt, change.at);
          } else if (!clashesWithNewerLocal(ctx, change.table, remote, change.at)) {
            applyLocally(ctx, change.table, change.key, remote);
          } else {
            clashes++;
          }
          n++;
        }
        repairOrphans(ctx.conn);
        setSyncState(ctx.conn, "last_pulled_seq", String(lastSeq));
        return { n, clashes };
      })
    );
    ctx.ids.reset();
    applied += result.n;
    conflicts += result.clashes;
    last = lastSeq;
  }
  await touchDevice(ctx.cloud, ctx.deviceId, "pull");
  return { applied, conflicts };
}

async function fetchCloudRows(
  ctx: SyncContext,
  wanted: { table: SyncTable; key: string }[]
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  const byTable = new Map<SyncTable, unknown[][]>();
  for (const w of wanted) byTable.set(w.table, [...(byTable.get(w.table) ?? []), JSON.parse(w.key) as unknown[]]);
  for (const [table, keys] of byTable) {
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      const rows: Record<string, unknown>[] = await ctx.cloud
        .select()
        .from(table.pg)
        .where(or(...chunk.map((k) => keyCondition(table, "pg", k))));
      for (const row of rows) {
        const key = JSON.stringify(table.key.map((c) => row[c]));
        found.set(`${table.name}:${key}`, row);
      }
    }
  }
  return found;
}

// A pulled row can clash with a different local row on a one-per-something
// column (e.g. both computers set an exam date for the same course). The
// newer one wins: a newer local row stays (and replaces the other in the
// cloud when pushed); an older one makes way.
function clashesWithNewerLocal(ctx: SyncContext, table: SyncTable, remote: Record<string, unknown> | null, remoteAt: string): boolean {
  if (!remote) return false;
  const remoteKey = JSON.stringify(table.key.map((c) => remote[c]));
  for (const cols of table.unique) {
    const clashing = ctx.local
      .select()
      .from(table.sqlite)
      .where(and(...cols.map((c) => eq(column(table, "sqlite", c), remote[c] as never))))
      .all() as Record<string, unknown>[];
    for (const row of clashing) {
      const key = JSON.stringify(table.key.map((c) => row[c]));
      if (key === remoteKey) continue;
      const localAt = pendingChangeAt(ctx.conn, table.name, key);
      if (localAt && localAt > remoteAt) {
        recordConflict(ctx.conn, table.name, key, "this computer's newer change was kept");
        return true;
      }
      ctx.local.delete(table.sqlite).where(keyCondition(table, "sqlite", JSON.parse(key))).run();
      dropPending(ctx.conn, table.name, key);
      if (localAt) recordConflict(ctx.conn, table.name, key, "the other computer's newer change was kept");
    }
  }
  return false;
}

function applyLocally(ctx: SyncContext, table: SyncTable, key: string, remote: Record<string, unknown> | null) {
  if (remote) {
    const target = table.key.map((c) => column(table, "sqlite", c));
    ctx.local.insert(table.sqlite).values(remote).onConflictDoUpdate({ target, set: nonKeySet(table, "sqlite", remote) }).run();
  } else {
    ctx.local.delete(table.sqlite).where(keyCondition(table, "sqlite", JSON.parse(key))).run();
  }
}

function resolveConflict(
  ctx: SyncContext,
  table: SyncTable,
  key: string,
  remote: Record<string, unknown> | null,
  localAt: string,
  remoteAt: string
) {
  // Notes and canvases edited here are never lost to a delete made
  // elsewhere: the edit wins, and the row comes back in the cloud.
  const remoteWins = remoteAt > localAt && !(KEEP_BOTH.has(table.name) && remote === null);
  const [local] = ctx.local.select().from(table.sqlite).where(keyCondition(table, "sqlite", JSON.parse(key))).all() as Record<
    string,
    unknown
  >[];
  if (KEEP_BOTH.has(table.name) && local && remote && JSON.stringify(local) !== JSON.stringify(remote)) {
    // The losing version survives as a copy — a new row, sent like any
    // local change (the outbox is off while applying, so it's added here).
    const loser = remoteWins ? local : remote;
    const copy = { ...loser, id: ctx.ids.allocate(table.name), title: `${String(loser.title ?? "Untitled")} (conflicted copy)` };
    ctx.local.insert(table.sqlite).values(copy).run();
    ctx.conn
      .prepare(`INSERT INTO sync_outbox (table_name, row_key, changed_at) VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))`)
      .run(table.name, JSON.stringify([copy.id]));
    recordConflict(ctx.conn, table.name, key, `kept both — the ${remoteWins ? "other computer's" : "this computer's"} version is newer`);
  } else {
    recordConflict(ctx.conn, table.name, key, remoteWins ? "the other computer's newer change was kept" : "this computer's newer change was kept");
  }
  if (remoteWins) {
    applyLocally(ctx, table, key, remote);
    dropPending(ctx.conn, table.name, key);
  }
}

// A row pulled or kept can point at something the other computer deleted
// (e.g. a card made here, offline, in a deck deleted there). Settled the
// way the foreign key says: cascade deletes the row, set null clears it.
function repairOrphans(conn: Database.Database) {
  for (let pass = 0; pass < 10; pass++) {
    const broken = conn.prepare("PRAGMA foreign_key_check").all() as { table: string; rowid: number; fkid: number }[];
    if (broken.length === 0) return;
    for (const b of broken) {
      const fk = (conn.prepare(`PRAGMA foreign_key_list("${b.table}")`).all() as { id: number; from: string; on_delete: string }[]).filter(
        (f) => f.id === b.fkid
      );
      if (fk[0]?.on_delete === "SET NULL") {
        for (const f of fk) conn.prepare(`UPDATE "${b.table}" SET "${f.from}" = NULL WHERE rowid = ?`).run(b.rowid);
      } else {
        conn.prepare(`DELETE FROM "${b.table}" WHERE rowid = ?`).run(b.rowid);
      }
    }
  }
}

// ---- Full refresh ---------------------------------------------------------

// Replaces this computer's database with the cloud's — on first set-up, or
// when it's been away so long the change log no longer covers the gap.
// Anything not yet pushed must be pushed first.
export async function fullRefresh(ctx: SyncContext, previousBackup: string | null): Promise<void> {
  const startSeq = await latestChangeSeq(ctx.cloud);
  const tmp = path.join(os.tmpdir(), `study-buddy-refresh-${process.pid}-${Date.now()}.db`);
  try {
    await writeSnapshot({ source: { db: ctx.cloud, tables: pgSchema }, targetPath: tmp, previousPath: previousBackup });
    await enqueue(async () => {
      ctx.conn.prepare("UPDATE sync_control SET applying = 1 WHERE id = 1").run();
      try {
        replaceDatabaseContents(ctx.conn, tmp);
      } finally {
        ctx.conn.prepare("UPDATE sync_control SET applying = 0 WHERE id = 1").run();
      }
      ctx.conn.prepare("DELETE FROM sync_outbox").run();
      setSyncState(ctx.conn, "last_pulled_seq", String(startSeq));
    });
    ctx.ids.reset();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function recentConflicts(conn: Database.Database): { table_name: string; resolution: string; at: string }[] {
  return conn.prepare("SELECT table_name, resolution, at FROM sync_conflicts ORDER BY id DESC LIMIT 20").all() as {
    table_name: string;
    resolution: string;
    at: string;
  }[];
}

export { rowsOf };
