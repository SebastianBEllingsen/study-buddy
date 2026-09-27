import { is, type Table } from "drizzle-orm";
import { getTableConfig as sqliteTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import * as sqliteSchema from "../db/schema.sqlite";
import * as pgSchema from "../db/schema.pg";

// What sync needs to know about each table, read from the two schemas (which
// mirror each other table for table) so a table added later syncs without
// being listed anywhere.

export interface SyncTable {
  name: string; // SQL name, the same on both sides
  sqlite: Table;
  pg: Table;
  // Primary key columns by JS property name (same as the SQL name here).
  key: string[];
  // A single auto-assigned integer id — handed out per device in sync mode
  // (see ids.ts) so two computers never create the same one.
  autoId: boolean;
  // Unique constraints other than the key, as column name lists — a row
  // created on both computers can clash on these (e.g. one exam date per
  // course), which pushing resolves in favour of the row being pushed.
  unique: string[][];
}

let cached: SyncTable[] | null = null;

export function syncTables(): SyncTable[] {
  if (cached) return cached;
  cached = Object.entries(sqliteSchema)
    .filter(([, value]) => is(value, SQLiteTable))
    .map(([exportName, value]) => {
      const sqlite = value as SQLiteTable;
      const pg = (pgSchema as Record<string, unknown>)[exportName] as Table;
      const config = sqliteTableConfig(sqlite);
      const composite = config.primaryKeys[0]?.columns.map((c) => c.name);
      const single = config.columns.filter((c) => c.primary).map((c) => c.name);
      const key = composite?.length ? composite : single;
      const idColumn = config.columns.find((c) => c.name === "id");
      const pgConfig = pgTableConfig(pg as never);
      const unique = [
        ...pgConfig.columns.filter((c) => c.isUnique && !c.primary).map((c) => [c.name]),
        ...pgConfig.uniqueConstraints.map((u) => u.columns.map((c) => c.name)),
        ...pgConfig.indexes
          .filter((i) => i.config.unique)
          .map((i) => i.config.columns.map((c) => (c as { name: string }).name)),
      ];
      return {
        name: config.name,
        sqlite,
        pg,
        key,
        autoId: key.length === 1 && key[0] === "id" && idColumn?.columnType === "SQLiteInteger" && config.name !== "app_settings",
        unique,
      };
    });
  return cached;
}

export function syncTable(name: string): SyncTable | undefined {
  return syncTables().find((t) => t.name === name);
}
