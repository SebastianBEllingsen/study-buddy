import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema.pg";

// Applies the Drizzle-Kit-generated migrations (drizzle/pg/) to whatever
// Postgres database the connection string points at — a brand-new Supabase
// project gets its schema created automatically on first connect, the same
// way schema.sql bootstraps a fresh local SQLite file. Safe to call every
// time: already-applied migrations are recorded in the target DB and skipped.
export async function createPostgresDb(connectionString: string) {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle", "pg") });
  // Both returned so callers can `.end()` the raw client later — needed to
  // close the connection pool cleanly when switching away from Postgres
  // (see db/index.ts's reconnect()).
  return { db, client };
}

export type PostgresDb = Awaited<ReturnType<typeof createPostgresDb>>["db"];
