import { describe, it, expect } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as sqliteSchema from "./schema.sqlite";
import * as pgSchema from "./schema.pg";

// db/index.ts's `resolve()` picks schema.sqlite.ts or schema.pg.ts at
// runtime and treats them as interchangeable (see its own long comment on
// the type-cast seam this relies on) — every one of models.ts's ~48 query
// functions is written once against a single set of table/column types and
// assumed to work unchanged against whichever real pair is behind it. That
// assumption has no other enforcement: nothing stops someone adding a
// column to one schema file and forgetting its sibling. Since this repo's
// actual deployed backend (per data/storage-config.json) is Postgres, the
// dangerous direction is a column that exists in schema.sqlite.ts but not
// schema.pg.ts — every other test in this suite runs against the SQLite
// test harness (testHarness.ts) and would pass regardless, while the real
// Supabase-backed app silently breaks on that field.
//
// This doesn't need a live Postgres connection (which this suite's import
// guards refuse to open anyway, see importGuard.test.ts) — schema.pg.ts's
// table definitions are plain objects, inspectable without a database.

type SchemaModule = typeof sqliteSchema | typeof pgSchema;

function tableExports(schema: SchemaModule): Record<string, object> {
  const tables: Record<string, object> = {};
  for (const [key, value] of Object.entries(schema)) {
    // Every table export in these two files is a drizzle Table object;
    // getTableName throws on anything else, which is exactly how this
    // filters out non-table exports without hardcoding a list to keep in
    // sync by hand.
    try {
      getTableName(value as never);
      tables[key] = value as object;
    } catch {
      // not a table export (e.g. a relations() helper, if one is ever added)
    }
  }
  return tables;
}

describe("schema.sqlite.ts / schema.pg.ts parity", () => {
  const sqliteTables = tableExports(sqliteSchema);
  const pgTables = tableExports(pgSchema);

  it("defines the exact same set of tables in both schema files", () => {
    expect(Object.keys(pgTables).sort()).toEqual(Object.keys(sqliteTables).sort());
  });

  it.each(Object.keys(sqliteTables))("table %s has the same columns in both schema files", (name) => {
    const pgTable = pgTables[name];
    expect(pgTable, `schema.pg.ts is missing the "${name}" table that schema.sqlite.ts defines`).toBeDefined();
    if (!pgTable) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqliteColumns = Object.keys(getTableColumns(sqliteTables[name] as any)).sort();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pgColumns = Object.keys(getTableColumns(pgTable as any)).sort();
    expect(pgColumns).toEqual(sqliteColumns);
  });
});
