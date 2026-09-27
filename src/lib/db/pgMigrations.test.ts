import { it, expect } from "vitest";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";

// A brand-new Supabase project gets its schema from these migrations alone
// (db/postgres.ts), so they must build the full schema from nothing — this
// once failed because 0012 (creating notes) was missing from the repo.
it("builds the whole schema from an empty Postgres", async () => {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle", "pg") });
  const { rows } = await client.query<{ n: number }>("select count(*)::int as n from pg_tables where schemaname = 'public'");
  expect(rows[0].n).toBeGreaterThanOrEqual(34);
  await db.execute(sql`select 1`);
  await client.close();
}, 60_000);
