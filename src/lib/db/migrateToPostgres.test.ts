import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { is, sql } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as sqliteSchema from "./schema.sqlite";
import { createTestDb, type TestDb } from "./testHarness";
import {
  MAX_QUERY_PARAMS,
  camelCase,
  chunkRows,
  copyLocalToPostgres,
  maxId,
  migrationTables,
  parentsFirst,
  stripNulBytes,
  type CloudDatabase,
} from "./migrateToPostgres";

describe("chunkRows", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, text: "x" }));

  it("keeps every statement under postgres.js's parameter limit", () => {
    // review_logs: 10 columns, so 6,600 rows would be 66,000 parameters.
    const chunks = chunkRows(rows(20_000), 10);
    expect(chunks.flat()).toHaveLength(20_000);
    for (const chunk of chunks) expect(chunk.length * 10).toBeLessThan(MAX_QUERY_PARAMS + 1);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("allows fewer rows per statement for a table with more columns", () => {
    const wide = chunkRows(rows(3_000), 40, { rows: 10_000 });
    expect(Math.max(...wide.map((c) => c.length))).toBe(Math.floor(MAX_QUERY_PARAMS / 40));
  });

  it("caps the rows in one statement, whatever the column count", () => {
    expect(Math.max(...chunkRows(rows(10_000), 2).map((c) => c.length))).toBeLessThanOrEqual(2_000);
  });

  it("starts a new statement when the text would get too big, and lets a huge row go alone", () => {
    const big = (id: number, size: number) => ({ id, text: "x".repeat(size) });
    const chunks = chunkRows([big(1, 600), big(2, 600), big(3, 5_000), big(4, 10)], 2, { chars: 1_000 });
    expect(chunks.map((c) => c.map((r) => r.id))).toEqual([[1], [2], [3], [4]]);
  });

  it("returns nothing for no rows", () => {
    expect(chunkRows([], 5)).toEqual([]);
  });
});

describe("helpers", () => {
  it("strips NUL bytes only from strings, leaving other rows untouched", () => {
    const clean = { id: 1, text: "ok" };
    const [a, b] = stripNulBytes([{ id: 1, text: "a\0b", n: 3 }, clean]);
    expect(a).toEqual({ id: 1, text: "ab", n: 3 });
    expect(b).toBe(clean);
  });

  it("finds the highest id of a table too big for Math.max(...rows)", () => {
    const rows = Array.from({ length: 300_000 }, (_, i) => ({ id: i + 1 }));
    expect(() => Math.max(...rows.map((r) => r.id))).toThrow(RangeError);
    expect(maxId(rows)).toBe(300_000);
    expect(maxId([])).toBe(0);
  });

  it("puts a row after the row it points at", () => {
    const rows = [
      { id: 1, parent: 3 },
      { id: 2, parent: null },
      { id: 3, parent: 2 },
      { id: 4, parent: 1 },
      { id: 5, parent: 99 }, // parent isn't in this table: nothing to wait for
    ];
    const ids = parentsFirst(rows, "parent").map((r) => r.id);
    for (const [child, parent] of [[3, 2], [1, 3], [4, 1]]) expect(ids.indexOf(parent)).toBeLessThan(ids.indexOf(child));
    expect(ids).toHaveLength(5);
  });

  it("doesn't hang on rows that point at each other", () => {
    const ids = parentsFirst([{ id: 1, parent: 2 }, { id: 2, parent: 1 }], "parent").map((r) => r.id);
    expect(ids.sort()).toEqual([1, 2]);
  });

  it("names counts after the table in camelCase", () => {
    expect(camelCase("generated_items")).toBe("generatedItems");
    expect(camelCase("courses")).toBe("courses");
  });
});

describe("migrationTables", () => {
  const tables = migrationTables();

  it("covers every table in the schema, canvases included", () => {
    const inSchema = Object.values(sqliteSchema)
      .filter((value) => is(value, SQLiteTable))
      .map((value) => getTableConfig(value as SQLiteTable).name);
    expect(tables.map((t) => t.name).sort()).toEqual(inSchema.sort());
    expect(tables.map((t) => t.name)).toContain("canvases");
  });

  it("lists a table after the tables its foreign keys point at", () => {
    const position = (name: string) => tables.findIndex((t) => t.name === name);
    expect(position("courses")).toBeLessThan(position("folders"));
    expect(position("folders")).toBeLessThan(position("documents"));
    expect(position("study_plans")).toBeLessThan(position("study_plan_chapters"));
    expect(position("study_plan_chapters")).toBeLessThan(position("generated_items"));
    expect(position("generated_items")).toBeLessThan(position("review_items"));
    expect(position("review_items")).toBeLessThan(position("review_logs"));
    expect(position("courses")).toBeLessThan(position("canvases"));
  });

  it("knows folders point at themselves", () => {
    expect(tables.find((t) => t.name === "folders")?.selfReference).toBe("parent_folder_id");
  });
});

// The real thing: a local SQLite database copied into an empty Postgres (an
// in-memory PGlite built from the same migrations a new Supabase project gets).
describe("copyLocalToPostgres", () => {
  let client: PGlite;
  let cloud: ReturnType<typeof drizzle>;
  let local: TestDb;
  // PGlite has no parameter limit of its own, so watch every query for the
  // one postgres.js has (65,534) — the cap this migration once ran into.
  let mostParams = 0;

  beforeAll(async () => {
    client = new PGlite();
    cloud = drizzle(client, {
      logger: {
        logQuery(_query: string, params: unknown[]) {
          mostParams = Math.max(mostParams, params.length);
        },
      },
    });
    await migrate(cloud, { migrationsFolder: path.join(process.cwd(), "drizzle", "pg") });
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  const count = async (table: string) =>
    Number((await client.query<{ n: number }>(`select count(*)::int as n from "${table}"`)).rows[0].n);

  async function emptyCloud() {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename not like '\\_\\_%'"
    );
    await client.exec(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  }

  // One row in every table. Foreign keys are switched off while seeding, and
  // every row has id 1, so each reference lands on a row that exists.
  function seedEveryTable(db: TestDb) {
    db.db.run(sql`pragma foreign_keys = off`);
    for (const value of Object.values(sqliteSchema)) {
      if (!is(value, SQLiteTable)) continue;
      const config = getTableConfig(value);
      const row: Record<string, unknown> = {};
      for (const column of config.columns) {
        row[column.name] = column.columnType === "SQLiteBoolean" ? true : column.columnType === "SQLiteReal" ? 1.5 : column.columnType === "SQLiteText" ? "x" : 1;
      }
      db.db.insert(value).values(row as never).onConflictDoNothing().run();
    }
  }

  it("copies a row of every table, so nothing in the schema is left behind", async () => {
    await emptyCloud();
    local = createTestDb();
    seedEveryTable(local);

    const counts = await copyLocalToPostgres(local.db, cloud as unknown as CloudDatabase);
    local.close();

    for (const table of migrationTables()) {
      expect(await count(table.name), table.name).toBe(1);
      expect(counts[camelCase(table.name)], table.name).toBe(1);
    }
  }, 60_000);

  it("copies canvases", async () => {
    await emptyCloud();
    local = createTestDb();
    local.db.run(sql`pragma foreign_keys = off`);
    local.db.run(sql`insert into courses (id, name, created_at) values (1, 'C', '2026-01-01 00:00:00')`);
    local.db.run(
      sql`insert into canvases (id, course_id, title, data, created_at, updated_at) values (1, 1, 'Board', '{"nodes":[],"edges":[]}', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`
    );
    await copyLocalToPostgres(local.db, cloud as unknown as CloudDatabase);
    local.close();
    const { rows } = await client.query<{ title: string; data: string }>("select title, data from canvases");
    expect(rows).toEqual([{ title: "Board", data: '{"nodes":[],"edges":[]}' }]);
  }, 60_000);

  it("copies a table far bigger than one statement can hold", async () => {
    await emptyCloud();
    local = createTestDb();
    local.db.run(sql`pragma foreign_keys = off`);
    const total = 7_000; // 70,000 parameters in one INSERT
    local.db.run(sql`insert into review_items (id, generated_item_id, kind, item_index, due_at, created_at) values (1, 1, 'card', 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
    local.db.run(sql`insert into courses (id, name, created_at) values (1, 'C', '2026-01-01 00:00:00')`);
    local.db.run(
      sql`insert into generated_items (id, course_id, mode, title, content_json, source_document_ids, created_at, updated_at) values (1, 1, 'flashcards', 'Deck', '{}', '[]', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`
    );
    local.db.run(sql`with recursive n(i) as (select 1 union all select i + 1 from n where i < ${total})
      insert into review_logs (id, review_item_id, rating, source, correct, reviewed_at, stability, difficulty, scheduled_days)
      select i, 1, 3, 'deck', 1, '2026-01-01 00:00:00', 1.0, 5.0, 3 from n`);

    mostParams = 0;
    const counts = await copyLocalToPostgres(local.db, cloud as unknown as CloudDatabase);
    local.close();
    expect(counts.reviewLogs).toBe(total);
    expect(await count("review_logs")).toBe(total);
    expect(mostParams).toBeGreaterThan(1_000);
    expect(mostParams).toBeLessThan(65_534);
  }, 120_000);

  it("copies subfolders even when a child comes before its parent", async () => {
    await emptyCloud();
    local = createTestDb();
    local.db.run(sql`pragma foreign_keys = off`);
    local.db.run(sql`insert into courses (id, name, created_at) values (1, 'C', '2026-01-01 00:00:00')`);
    // The child has the lower id, so it sorts first.
    local.db.run(sql`insert into folders (id, course_id, name, parent_folder_id, created_at) values (1, 1, 'Child', 2, '2026-01-01 00:00:00')`);
    local.db.run(sql`insert into folders (id, course_id, name, parent_folder_id, created_at) values (2, 1, 'Parent', null, '2026-01-01 00:00:00')`);
    await copyLocalToPostgres(local.db, cloud as unknown as CloudDatabase);
    local.close();
    expect(await count("folders")).toBe(2);
  }, 60_000);

  it("leaves the cloud database untouched when something fails part-way", async () => {
    await emptyCloud();
    local = createTestDb();
    local.db.run(sql`pragma foreign_keys = off`);
    local.db.run(sql`insert into courses (id, name, created_at) values (1, 'C', '2026-01-01 00:00:00')`);
    // A folder in a course that doesn't exist: Postgres will refuse it.
    local.db.run(sql`insert into folders (id, course_id, name, created_at) values (1, 99, 'Orphan', '2026-01-01 00:00:00')`);

    await expect(copyLocalToPostgres(local.db, cloud as unknown as CloudDatabase)).rejects.toThrow();
    local.close();
    expect(await count("courses")).toBe(0);
    expect(await count("folders")).toBe(0);
  }, 60_000);

  it("brings columns up to date when run again over existing rows", async () => {
    await emptyCloud();
    local = createTestDb();
    local.db.run(sql`pragma foreign_keys = off`);
    local.db.run(sql`insert into courses (id, name, created_at) values (1, 'C', '2026-01-01 00:00:00')`);
    local.db.run(sql`insert into documents (id, course_id, filename, file_path, status, created_at) values (1, 1, 'a.pdf', '/no/such/file', 'extracted', '2026-01-01 00:00:00')`);
    local.db.run(sql`insert into chat_conversations (id, title, created_at, updated_at) values (1, 'Chat', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`);
    await copyLocalToPostgres(local.db, cloud as unknown as CloudDatabase);

    // These are the columns the old hand-written list had fallen behind on.
    local.db.run(sql`update documents set transcribed_at = '2026-02-02 00:00:00' where id = 1`);
    local.db.run(sql`update chat_conversations set course_id = 1 where id = 1`);
    await copyLocalToPostgres(local.db, cloud as unknown as CloudDatabase);
    local.close();

    expect((await client.query("select transcribed_at from documents")).rows).toEqual([{ transcribed_at: "2026-02-02 00:00:00" }]);
    expect((await client.query("select course_id from chat_conversations")).rows).toEqual([{ course_id: 1 }]);
  }, 60_000);

  it("moves each id sequence past the highest id, so the next insert doesn't collide", async () => {
    await emptyCloud();
    local = createTestDb();
    local.db.run(sql`pragma foreign_keys = off`);
    local.db.run(sql`insert into courses (id, name, created_at) values (41, 'C', '2026-01-01 00:00:00')`);
    await copyLocalToPostgres(local.db, cloud as unknown as CloudDatabase);
    local.close();
    await client.exec(`insert into courses (name, created_at) values ('Next', '2026-01-01 00:00:00')`);
    expect((await client.query<{ id: number }>("select max(id)::int as id from courses")).rows[0].id).toBe(42);
  }, 60_000);

  it("doesn't move a sequence backwards when the cloud already holds higher ids", async () => {
    await emptyCloud();
    await client.exec(`insert into courses (id, name, created_at) values (500, 'Cloud', '2026-01-01 00:00:00')`);
    local = createTestDb();
    local.db.run(sql`pragma foreign_keys = off`);
    local.db.run(sql`insert into courses (id, name, created_at) values (3, 'Local', '2026-01-01 00:00:00')`);
    await copyLocalToPostgres(local.db, cloud as unknown as CloudDatabase);
    local.close();
    await client.exec(`insert into courses (name, created_at) values ('Next', '2026-01-01 00:00:00')`);
    expect((await client.query<{ id: number }>("select max(id)::int as id from courses")).rows[0].id).toBe(501);
  }, 60_000);
});
