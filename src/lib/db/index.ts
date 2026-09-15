import { sql } from "drizzle-orm";
import { sqliteDb } from "./sqlite";
import { createPostgresDb } from "./postgres";
import { resolveStorageConfig, type StorageConfig } from "./config";
import * as sqliteSchema from "./schema.sqlite";
import * as pgSchema from "./schema.pg";

type Schema = typeof sqliteSchema;
type PgClient = Awaited<ReturnType<typeof createPostgresDb>>["client"];

// The Postgres connection currently backing `db`, if any — kept so
// switching away from Supabase (or to a different project) can close it
// with `.end()` instead of leaking a connection pool.
let currentPgClient: PgClient | null = null;

// Set whenever resolve() falls back to local because a Supabase connection
// attempt failed; cleared on success. Surfaced through
// GET/POST /api/storage-settings so a failure is visible in the UI instead
// of only the server console.
export let lastConnectionError: string | null = null;

// Whether `db` is currently a real Postgres connection rather than the
// local SQLite file — see runTransaction() below, the one place this
// matters to callers outside this module.
export let usingPostgres = false;

// A bad/unreachable connection string must never brick the whole app — this
// runs at module load (and again on every reconnect()), so an uncaught
// throw here would 500 every route, including the Storage settings ones
// needed to fix it. Fall back to the local file (still fully usable) and
// record the failure instead.
async function resolve(config: StorageConfig): Promise<{ db: typeof sqliteDb; schema: Schema }> {
  if (config.mode !== "supabase") {
    lastConnectionError = null;
    usingPostgres = false;
    return { db: sqliteDb, schema: sqliteSchema };
  }
  try {
    const { db: pgDb, client } = await createPostgresDb(config.connectionString);
    currentPgClient = client;
    lastConnectionError = null;
    usingPostgres = true;
    return {
      db: pgDb as unknown as typeof sqliteDb,
      schema: pgSchema as unknown as Schema,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastConnectionError = message;
    usingPostgres = false;
    console.error(
      "Couldn't connect to the configured Supabase database — falling back to the local SQLite file.\n" +
        `Cause: ${message}`
    );
    return { db: sqliteDb, schema: sqliteSchema };
  }
}

// db and its matching table set are resolved together — before this,
// nothing in the app knows (or needs to know) whether it's talking to the
// local SQLite file or a Supabase Postgres database.
//
// The cast inside resolve() is the one deliberate seam where that dialect
// difference is papered over: at runtime, `db` and `schema` are always a
// genuinely matching pair (a real BetterSQLite3Database with schema.sqlite's
// tables, or a real PostgresJsDatabase with schema.pg's tables) — only
// their static TypeScript type is pinned to the SQLite shape, so models.ts's
// ~48 query functions can be written once against a single set of
// table/db types instead of threading a generic through every one of them.
// The two schemas are kept structurally identical (same table/column names)
// so this is safe: every query models.ts writes works unchanged against
// whichever real pair is behind this cast.
//
// These are `let`, not `const`: ES module named exports are live bindings,
// so reassigning them in reconnect() below is picked up by every importer
// (models.ts reads `db`/`courses`/etc. fresh on every call, never caching
// them at import time) with no other code changes needed to make a
// Storage-settings switch take effect immediately, no process restart.
const initial = await resolve(resolveStorageConfig());
export let db = initial.db;
export let courses = initial.schema.courses;
export let app_settings = initial.schema.app_settings;
export let folders = initial.schema.folders;
export let documents = initial.schema.documents;
export let generated_items = initial.schema.generated_items;
export let quiz_attempts = initial.schema.quiz_attempts;
export let flashcard_reviews = initial.schema.flashcard_reviews;
export let flashcard_schedule = initial.schema.flashcard_schedule;
export let calendar_feeds = initial.schema.calendar_feeds;
export let notes = initial.schema.notes;
export let completed_assignments = initial.schema.completed_assignments;
export let recent_views = initial.schema.recent_views;
export let uploaded_images = initial.schema.uploaded_images;
export let generation_notifications = initial.schema.generation_notifications;
export let chat_conversations = initial.schema.chat_conversations;
export let chat_messages = initial.schema.chat_messages;
export let quiz_generation_presets = initial.schema.quiz_generation_presets;

// Re-resolves the active backend from the current on-disk/env config and
// swaps every binding above in place. Called by
// POST /api/storage-settings right after saving, so switching backends
// takes effect immediately.
export async function reconnect(): Promise<{ ok: boolean; error: string | null }> {
  if (currentPgClient) {
    await currentPgClient.end();
    currentPgClient = null;
  }
  const next = await resolve(resolveStorageConfig());
  db = next.db;
  courses = next.schema.courses;
  app_settings = next.schema.app_settings;
  folders = next.schema.folders;
  documents = next.schema.documents;
  generated_items = next.schema.generated_items;
  quiz_attempts = next.schema.quiz_attempts;
  flashcard_reviews = next.schema.flashcard_reviews;
  flashcard_schedule = next.schema.flashcard_schedule;
  calendar_feeds = next.schema.calendar_feeds;
  notes = next.schema.notes;
  completed_assignments = next.schema.completed_assignments;
  recent_views = next.schema.recent_views;
  uploaded_images = next.schema.uploaded_images;
  generation_notifications = next.schema.generation_notifications;
  chat_conversations = next.schema.chat_conversations;
  chat_messages = next.schema.chat_messages;
  quiz_generation_presets = next.schema.quiz_generation_presets;
  return { ok: lastConnectionError === null, error: lastConnectionError };
}

// SQLite's manual BEGIN/COMMIT/ROLLBACK below (see runTransaction) runs
// against the single shared `db` handle, not a scoped transaction object —
// two concurrent callers could otherwise interleave their BEGINs into what
// was meant to be one atomic block. Chained onto this, each call waits for
// the previous one's commit/rollback before issuing its own BEGIN, so "one
// SQLite transaction at a time" — already this app's assumed usage model,
// per the comment below — actually holds instead of merely being assumed.
let sqliteTransactionQueue: Promise<void> = Promise.resolve();

// A second dialect seam, alongside the type cast above: postgres-js's
// driver needs a real async callback for `db.transaction()` (each query is
// genuine network I/O), but better-sqlite3's driver requires the opposite —
// it hands the callback straight to better-sqlite3's own transaction
// wrapper, which throws "Transaction function cannot return a promise" for
// any `async` function, no matter how fast its body runs. One shared
// `async (tx) => { await tx... }` callback (as every call site in
// models.ts already writes) can't satisfy both, so this picks the strategy
// at call time instead: real driver transactions on Postgres, manual
// BEGIN/COMMIT/ROLLBACK against the plain `db` handle on SQLite. The
// latter gives up SQLite-level nesting/savepoints, which this app never
// uses, and matches its existing one-device-at-a-time usage model.
export async function runTransaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  if (usingPostgres) {
    // db.transaction()'s real (Postgres) signature takes a PgTransaction,
    // not `typeof db` — its static type is pinned to the SQLite shape by
    // the cast in resolve() above, same seam, same reason. Cast the
    // argument, not the method itself — drizzle's transaction() reads
    // `this.session` internally, so extracting it as a standalone function
    // reference (as this used to do) calls it with `this` unbound and
    // throws "Cannot read properties of undefined (reading 'session')".
    // Stay a plain method call; only the type needs help.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.transaction(fn as any);
  }

  const previous = sqliteTransactionQueue;
  let release: () => void;
  sqliteTransactionQueue = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await db.run(sql`begin`);
    try {
      const result = await fn(db);
      await db.run(sql`commit`);
      return result;
    } catch (err) {
      await db.run(sql`rollback`);
      throw err;
    }
  } finally {
    release!();
  }
}
