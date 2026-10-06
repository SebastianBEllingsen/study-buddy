import { sql } from "drizzle-orm";
import { sqliteDb } from "@/lib/db/sqlite";
import { copyLocalToPostgres } from "@/lib/db/migrateToPostgres";
import { createPostgresDb, type PostgresDb } from "@/lib/db/postgres";

// One-time copy of the local SQLite database into a Postgres (Supabase)
// database — always local-file -> connectionString, regardless of which
// backend happens to be active right now, since this exists specifically to
// seed a new cloud database from existing local data. Does not touch
// data/storage-config.json: switching the active mode is a separate,
// explicit save (see ../route.ts's POST) so a failed or partial migration
// never leaves the app pointed at an empty cloud database.
//
// What is copied, and how, is in lib/db/migrateToPostgres.ts: every table,
// in one transaction, as upserts — so it's safe to run again, and a failure
// leaves the cloud database as it was. It is a one-way "local wins" push, not
// a merge: running it from a machine with older data would overwrite newer
// cloud rows with stale local ones, so only run it from whichever machine has
// the data you want to keep.

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const connectionString =
    typeof body?.connectionString === "string" ? body.connectionString.trim() : "";
  if (!connectionString) {
    return Response.json({ error: "connectionString is required" }, { status: 400 });
  }

  let pgDb: PostgresDb;
  let client: Awaited<ReturnType<typeof createPostgresDb>>["client"];
  try {
    ({ db: pgDb, client } = await createPostgresDb(connectionString));
  } catch (err) {
    return Response.json(
      {
        error: `Couldn't connect to that database: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 }
    );
  }

  // This connection is only for the duration of this one migration — always
  // close it afterward instead of leaking a pool per migrate click.
  try {
    // "Local wins" overwrites whatever the cloud database already holds (see
    // the top of this file). Into an empty database that's the whole point;
    // into one already in use it would silently roll newer work back to the
    // local copy — so that needs an explicit go-ahead.
    if (body?.overwrite !== true) {
      const existing = await cloudContents(pgDb);
      if (existing.courses > 0 || existing.generatedItems > 0 || existing.notes > 0) {
        return Response.json(
          {
            error:
              `That database already has ${existing.courses} course(s), ${existing.generatedItems} generated item(s) ` +
              `and ${existing.notes} note(s). Migrating would overwrite them with this computer's local copy.`,
            needsOverwrite: true,
            existing,
          },
          { status: 409 }
        );
      }
    }
    return await runMigration(pgDb);
  } finally {
    await client.end();
  }
}

async function cloudContents(pgDb: PostgresDb): Promise<{ courses: number; generatedItems: number; notes: number }> {
  const count = async (table: string) => {
    const rows = await pgDb.execute(sql.raw(`select count(*)::int as n from ${table}`));
    return Number((rows as unknown as { n: number }[])[0]?.n ?? 0);
  };
  const [courses, generatedItems, notes] = await Promise.all([count("courses"), count("generated_items"), count("notes")]);
  return { courses, generatedItems, notes };
}

async function runMigration(pgDb: PostgresDb): Promise<Response> {
  try {
    const migrated = await copyLocalToPostgres(sqliteDb, pgDb);
    return Response.json({ ok: true, migrated });
  } catch (err) {
    return Response.json(
      { error: `Migration failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
