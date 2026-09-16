import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema.pg";
import { nowUtc } from "../time";

// Applies the Drizzle-Kit-generated migrations (drizzle/pg/) to whatever
// Postgres database the connection string points at — a brand-new Supabase
// project gets its schema created automatically on first connect, the same
// way schema.sql bootstraps a fresh local SQLite file. Safe to call every
// time: already-applied migrations are recorded in the target DB and skipped.
export async function createPostgresDb(connectionString: string) {
  // Defense in depth alongside sqlite.ts's own import-time guard: this is
  // the one place a real network connection gets opened using whatever
  // credentials are in data/storage-config.json (a real Supabase project's,
  // in this repo). db/index.ts is currently the only caller and already
  // can't be imported unmocked during a test (sqlite.ts throws first, since
  // it's imported unconditionally at db/index.ts's own top level) — this
  // guard exists so that stays true even if this function ever gets called
  // from somewhere else.
  if (process.env.VITEST) {
    throw new Error(
      "createPostgresDb must never run during tests — it opens a real network connection with " +
        "whatever credentials are in data/storage-config.json. Mock ./postgres or ./db instead."
    );
  }
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle", "pg") });
  // schema.sql seeds this same row for SQLite (`INSERT OR IGNORE INTO
  // app_settings ...`) at database-creation time — Drizzle-Kit's migrations
  // only create the table shape, not this singleton row, so a Postgres
  // database that was never populated via the local->Supabase migrate route
  // (e.g. DATABASE_URL pointed at a brand-new Supabase project from the
  // start) would otherwise have zero app_settings rows. Every setting
  // setter in models.ts does `UPDATE app_settings ... WHERE id = 1` with no
  // existence check, so against an empty table every save would silently
  // affect 0 rows while the API still reports success. Column defaults
  // (ai_provider, show_model_badge, etc.) fill in from the schema itself.
  await db
    .insert(schema.app_settings)
    .values({ id: 1, updated_at: nowUtc() })
    .onConflictDoNothing();
  // Both returned so callers can `.end()` the raw client later — needed to
  // close the connection pool cleanly when switching away from Postgres
  // (see db/index.ts's reconnect()).
  return { db, client };
}

export type PostgresDb = Awaited<ReturnType<typeof createPostgresDb>>["db"];
