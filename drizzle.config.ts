import type { Config } from "drizzle-kit";

// Only used to GENERATE migration SQL files (`drizzle-kit generate`) from
// schema.pg.ts — committed under drizzle/pg/ and applied at runtime by
// db/postgres.ts's own migrator, not by drizzle-kit against a live database.
// No DATABASE_URL is needed here since `generate` doesn't connect to anything.
export default {
  dialect: "postgresql",
  schema: "./src/lib/db/schema.pg.ts",
  out: "./drizzle/pg",
} satisfies Config;
