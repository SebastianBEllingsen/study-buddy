import fs from "node:fs/promises";
import { sql } from "drizzle-orm";
import { getTableConfig, PgTable, type PgDatabase } from "drizzle-orm/pg-core";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./schema.sqlite";
import { syncTables, type SyncTable } from "../sync/tables";

// One-time copy of the local SQLite database into a Postgres (Supabase)
// database: local file -> cloud, whichever backend is active right now.
//
// Every table is copied — the list is read from the two schemas, not written
// out here, so a table added later is migrated without anyone remembering to
// list it. Rows go in as upserts by primary key, so running it again later
// brings a cloud database up to date. It is one-way "local wins", not a
// merge: rows that already exist in Postgres are overwritten by the local
// version, so only run it from the machine whose data you want to keep.
//
// All of it happens in one transaction: a failure part-way leaves the cloud
// database as it was, not half-filled.

// postgres.js refuses a query with 65,534 or more parameters, and one
// multi-row INSERT uses (rows × columns) of them — so a big table has to go
// up in several statements.
export const MAX_QUERY_PARAMS = 60_000;
// Drizzle builds a multi-row INSERT with spread arguments, which runs out of
// stack somewhere in the thousands of rows.
export const MAX_ROWS_PER_QUERY = 2_000;
// Roughly how much text one statement may carry (document text and stored
// files are the big ones).
export const MAX_CHARS_PER_QUERY = 16 * 1024 * 1024;

type Row = Record<string, unknown>;

// Splits rows into groups that each fit one statement. A single row over the
// size limit still gets a statement of its own.
export function chunkRows<T extends Row>(
  rows: T[],
  columnCount: number,
  limits: { params?: number; rows?: number; chars?: number } = {}
): T[][] {
  const maxRows = Math.max(
    1,
    Math.min(limits.rows ?? MAX_ROWS_PER_QUERY, Math.floor((limits.params ?? MAX_QUERY_PARAMS) / Math.max(1, columnCount)))
  );
  const maxChars = limits.chars ?? MAX_CHARS_PER_QUERY;
  const chunks: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const row of rows) {
    const size = Object.values(row).reduce<number>((sum, v) => sum + (typeof v === "string" ? v.length : 8), 0);
    if (current.length > 0 && (current.length >= maxRows || chars + size > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(row);
    chars += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// Postgres text columns reject the NUL byte outright; SQLite doesn't, so old
// rows can carry one for years and then abort a whole migration. Strip it
// from every string field rather than trusting the source data is clean.
export function stripNulBytes<T extends Row>(rows: T[]): T[] {
  return rows.map((row) => {
    let cleaned: T | null = null;
    for (const key of Object.keys(row)) {
      const value = row[key];
      if (typeof value === "string" && value.includes("\0")) {
        cleaned ??= { ...row };
        (cleaned as Row)[key] = value.replace(/\0/g, "");
      }
    }
    return cleaned ?? row;
  });
}

// Fills in a document's file for rows written before files were kept in the
// database, from the copy still on this computer. Best effort: without the
// file the document just stays without one (it falls back to its text).
export async function backfillFileBase64<T extends { file_path: string; file_base64: string | null }>(rows: T[]): Promise<T[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (row.file_base64) return row;
      try {
        return { ...row, file_base64: (await fs.readFile(row.file_path)).toString("base64") };
      } catch {
        return row;
      }
    })
  );
}

// The largest id in the rows — a loop, because Math.max(...rows) overflows
// the stack on a big table.
export function maxId(rows: { id: number }[]): number {
  let max = 0;
  for (const row of rows) if (row.id > max) max = row.id;
  return max;
}

// Rows that point at another row of the same table (a subfolder's parent)
// have to be inserted after it, or a chunk boundary can put the child first.
export function parentsFirst<T extends Row>(rows: T[], column: string): T[] {
  const ids = new Set(rows.map((r) => r.id));
  const placed = new Set<unknown>();
  const ordered: T[] = [];
  let waiting = rows;
  while (waiting.length > 0) {
    const next: T[] = [];
    for (const row of waiting) {
      const parent = row[column];
      if (parent === null || parent === undefined || !ids.has(parent) || placed.has(parent)) {
        ordered.push(row);
        placed.add(row.id);
      } else {
        next.push(row);
      }
    }
    // A loop of rows pointing at each other can't be put in order; stop
    // rather than spin (the database will say what's wrong with it).
    if (next.length === waiting.length) return [...ordered, ...next];
    waiting = next;
  }
  return ordered;
}

export interface MigrationTable extends SyncTable {
  columns: string[];
  // Column of a foreign key to the table itself, if it has one.
  selfReference: string | null;
}

// Every table, parents before the tables that point at them.
export function migrationTables(): MigrationTable[] {
  const entries = syncTables().map((table) => {
    const config = getTableConfig(table.pg as PgTable);
    const parentName = (fk: (typeof config.foreignKeys)[number]) => getTableConfig(fk.reference().foreignTable as PgTable).name;
    const self = config.foreignKeys.find((fk) => parentName(fk) === config.name);
    const migrationTable: MigrationTable = {
      ...table,
      columns: config.columns.map((c) => c.name),
      selfReference: self ? self.reference().columns[0].name : null,
    };
    return { table: migrationTable, parents: new Set(config.foreignKeys.map(parentName).filter((name) => name !== config.name)) };
  });

  const ordered: MigrationTable[] = [];
  const placed = new Set<string>();
  let waiting = entries;
  while (waiting.length > 0) {
    const ready = waiting.filter((e) => [...e.parents].every((name) => placed.has(name)));
    if (ready.length === 0) {
      throw new Error(`Tables depend on each other in a loop: ${waiting.map((e) => e.table.name).join(", ")}`);
    }
    for (const e of ready) {
      ordered.push(e.table);
      placed.add(e.table.name);
    }
    waiting = waiting.filter((e) => !ready.includes(e));
  }
  return ordered;
}

export function camelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the cloud database is
   Postgres through postgres.js in the app and PGlite in tests; both are a
   PgDatabase, and every table is handled generically here. */
export type CloudDatabase = PgDatabase<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
export type LocalDatabase = Pick<BetterSQLite3Database<typeof sqliteSchema>, "select">;

// Rows copied per table, keyed by the table's name in camelCase
// (generatedItems, studyPlans, …).
export type MigrationCounts = Record<string, number>;

export async function copyLocalToPostgres(local: LocalDatabase, cloud: CloudDatabase): Promise<MigrationCounts> {
  const counts: MigrationCounts = {};
  const highestId = new Map<string, number>();
  const tables = migrationTables();

  await cloud.transaction(async (tx) => {
    for (const table of tables) {
      let rows = (await local.select().from(table.sqlite as never)) as Row[];
      counts[camelCase(table.name)] = rows.length;
      if (rows.length === 0) continue;
      if (table.autoId) highestId.set(table.name, maxId(rows as { id: number }[]));

      if (table.name === "documents") rows = await backfillFileBase64(rows as never);
      if (table.selfReference) rows = parentsFirst(rows, table.selfReference);

      const pgTable = table.pg as PgTable & Record<string, never>;
      const target = table.key.map((name) => pgTable[name]);
      const updatable = table.columns.filter((name) => !table.key.includes(name));

      for (const chunk of chunkRows(stripNulBytes(rows), table.columns.length)) {
        const insert = tx.insert(pgTable).values(chunk as never);
        if (updatable.length === 0) {
          await insert.onConflictDoNothing();
        } else {
          // Everything but the key, from the row proposed for insertion — so
          // a column added to the schema later is carried across too.
          const set = Object.fromEntries(updatable.map((name) => [name, sql.raw(`excluded."${name}"`)]));
          await insert.onConflictDoUpdate({ target: target as never, set });
        }
      }
    }

    // Explicit ids leave a table's id sequence where it started — move it
    // past the highest id, whichever of the two databases holds it, so the
    // next insert doesn't collide.
    for (const [name, highest] of highestId) {
      await tx.execute(
        sql.raw(`select setval(pg_get_serial_sequence('"${name}"', 'id'), greatest(${highest}, (select coalesce(max(id), 0) from "${name}")))`)
      );
    }
  });

  return counts;
}
