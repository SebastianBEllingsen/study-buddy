import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.sqlite";
import { bootstrapSqliteDatabase } from "./sqliteBootstrap";
import { enqueue } from "./operationQueue";

// Test-only infrastructure — never imported by any real app code (grep for
// "testHarness" if that ever stops being true). Builds a throwaway
// in-memory SQLite database, bootstrapped with the exact same schema.sql +
// migrate() sequence the real app applies to data/study_buddy.db (see
// sqliteBootstrap.ts) — so models.ts's queries run against a database
// shaped identically to production, just never touching that real file.
// See models.test.ts for how this gets wired in via vi.mock("./db", ...).

export type TestDrizzleDb = BetterSQLite3Database<typeof schema>;

export interface TestDb {
  db: TestDrizzleDb;
  schema: typeof schema;
  runTransaction: <T>(fn: (tx: TestDrizzleDb) => Promise<T>) => Promise<T>;
  close: () => void;
}

export function createTestDb(): TestDb {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  bootstrapSqliteDatabase(raw);
  const db = drizzle(raw, { schema });

  // Same manual BEGIN/COMMIT/ROLLBACK db/index.ts's runTransaction (SQLite
  // path) uses, serialized through that exact same FIFO queue (enqueue,
  // from ./operationQueue) rather than a parallel reimplementation of it —
  // a hand-rolled second queue here could silently diverge from the real
  // one and give false confidence (a test proving "this queue works"
  // instead of "the production queue works"). Without serialization at
  // all, two Promise.all'd calls into this (e.g. testing that concurrent
  // createDocument calls never land on the same position — the exact race
  // fixed this session) would interleave their BEGINs and hit SQLite's
  // "cannot start a transaction within a transaction" error, which would
  // be a false failure of this test harness, not of the code under test.
  async function runTransaction<T>(fn: (tx: TestDrizzleDb) => Promise<T>): Promise<T> {
    return enqueue(async () => {
      await db.run(sql`begin`);
      try {
        const result = await fn(db);
        await db.run(sql`commit`);
        return result;
      } catch (err) {
        await db.run(sql`rollback`);
        throw err;
      }
    });
  }

  return { db, schema, runTransaction, close: () => raw.close() };
}
