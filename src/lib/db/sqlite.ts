import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.sqlite";
import { bootstrapSqliteDatabase } from "./sqliteBootstrap";

// Structural guard, not just a convention: this module opens this app's
// real data/study_buddy.db on import (see createConnection below), and
// db/index.ts unconditionally imports it at its own top level regardless of
// which storage backend is configured (it's the fallback path even in
// Supabase mode). A test file that transitively pulls in db/index.ts
// without mocking it — one stray non-`import type` reference away, as
// happened once already this session — would otherwise silently start
// mutating the developer's real local database, or (worse, in Supabase
// mode) reach the credentialed production connection in
// data/storage-config.json through here. Vitest sets process.env.VITEST for
// every test run, so this fails loudly and immediately at import time
// instead of connecting to anything real. See src/lib/db/testHarness.ts for
// the in-memory equivalent every DB-touching test should use instead.
if (process.env.VITEST) {
  throw new Error(
    "src/lib/db/sqlite.ts must never be imported during tests — it opens the real data/study_buddy.db file. " +
      "Mock the module that pulled this in (often ./db or ./models) instead — see src/lib/db/testHarness.ts."
  );
}

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "study_buddy.db");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

declare global {
  var __studyBuddySqlite: Database.Database | undefined;
}

function createConnection(): Database.Database {
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  bootstrapSqliteDatabase(database);
  return database;
}

// Reused across hot-reloads in dev so we don't reopen/re-migrate on every request.
const connection = globalThis.__studyBuddySqlite ?? createConnection();
if (process.env.NODE_ENV !== "production") {
  globalThis.__studyBuddySqlite = connection;
}

export const sqliteDb = drizzle(connection, { schema });
