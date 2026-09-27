import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, sql } from "drizzle-orm";
import * as sqliteSchema from "../db/schema.sqlite";
import * as pgSchema from "../db/schema.pg";
import { bootstrapSqliteDatabase } from "../db/sqliteBootstrap";
import { ensureCloudSync, registerDevice, type CloudDb } from "./cloud";
import { installTriggers, outboxCount, setSyncState } from "./local";
import { IdAllocator, withDeviceIds } from "./ids";
import { fullRefresh, pull, push, recentConflicts, type SyncContext } from "./engine";
import { replaceDatabaseContents, writeSnapshot } from "../backup/snapshot";
import os from "node:os";
import fs from "node:fs";

// Two computers syncing through one Postgres (PGlite, in memory), the way
// computers in sync mode sync through Supabase.

let cloud: CloudDb & ReturnType<typeof drizzlePg>;

beforeAll(async () => {
  const pg = new PGlite();
  cloud = drizzlePg(pg, { schema: pgSchema }) as never;
  await migrate(cloud as never, { migrationsFolder: path.join(process.cwd(), "drizzle", "pg") });
  await ensureCloudSync(cloud);
}, 120_000);

const tick = () => new Promise((r) => setTimeout(r, 5));

async function computer(name: string) {
  const conn = new Database(":memory:");
  bootstrapSqliteDatabase(conn);
  installTriggers(conn);
  const local = drizzle(conn, { schema: sqliteSchema });
  const device = await registerDevice(cloud, name, name);
  const ids = new IdAllocator(conn, device.idBase);
  const app = withDeviceIds(local, ids);
  setSyncState(conn, "last_pulled_seq", "0");
  const ctx: SyncContext = { conn, local, cloud: cloud as never, deviceId: name, ids };
  const sync = async () => {
    const pulled = await pull(ctx);
    await push(ctx);
    return pulled;
  };
  return { conn, local, app, ctx, sync, ids, idBase: device.idBase };
}

const now = "2026-09-26 12:00:00";
const course = (name: string) => ({ name, created_at: now });

describe("sync between two computers", () => {
  it("gives each computer its own ids, so offline work never collides", async () => {
    const a = await computer("pc-a1");
    const b = await computer("pc-b1");
    const [ca] = await a.app.insert(sqliteSchema.courses).values(course("Made on A")).returning();
    const [cb] = await b.app.insert(sqliteSchema.courses).values(course("Made on B")).returning();
    expect(ca.id).toBe(a.idBase + 1);
    expect(cb.id).toBe(b.idBase + 1);

    await a.sync();
    await b.sync();
    await a.sync();
    const names = (db: typeof a.local) => db.select().from(sqliteSchema.courses).all().map((c) => c.name).sort();
    expect(names(a.local)).toEqual(expect.arrayContaining(["Made on A", "Made on B"]));
    expect(names(b.local)).toEqual(names(a.local));
    expect(outboxCount(a.conn)).toBe(0);
  });

  it("brings over whole trees (course → folder → note) and later edits and deletes", async () => {
    const a = await computer("pc-a2");
    const b = await computer("pc-b2");
    const [c] = await a.app.insert(sqliteSchema.courses).values(course("Physics")).returning();
    const [f] = await a.app.insert(sqliteSchema.folders).values({ course_id: c.id, name: "Week 1", created_at: now }).returning();
    await a.app
      .insert(sqliteSchema.notes)
      .values({ course_id: c.id, folder_id: f.id, title: "Forces", markdown: "F = ma", created_at: now, updated_at: now });
    await a.sync();
    await b.sync();
    expect(b.local.select().from(sqliteSchema.notes).where(eq(sqliteSchema.notes.title, "Forces")).all()).toHaveLength(1);

    b.local.update(sqliteSchema.courses).set({ name: "Physics 101" }).where(eq(sqliteSchema.courses.id, c.id)).run();
    await b.sync();
    await a.sync();
    expect(a.local.select().from(sqliteSchema.courses).where(eq(sqliteSchema.courses.id, c.id)).get()?.name).toBe("Physics 101");

    a.local.delete(sqliteSchema.courses).where(eq(sqliteSchema.courses.id, c.id)).run(); // cascades locally
    await a.sync();
    await b.sync();
    expect(b.local.select().from(sqliteSchema.folders).where(eq(sqliteSchema.folders.id, f.id)).all()).toHaveLength(0);
  });

  it("settles an edit made on both computers in favour of the newer one", async () => {
    const a = await computer("pc-a3");
    const b = await computer("pc-b3");
    const [c] = await a.app.insert(sqliteSchema.courses).values(course("Original")).returning();
    await a.sync();
    await b.sync();
    a.local.update(sqliteSchema.courses).set({ name: "A's name (older)" }).where(eq(sqliteSchema.courses.id, c.id)).run();
    await tick();
    b.local.update(sqliteSchema.courses).set({ name: "B's name (newer)" }).where(eq(sqliteSchema.courses.id, c.id)).run();
    await a.sync(); // A pushes first…
    const { conflicts } = await b.sync(); // …B has the newer edit
    expect(conflicts).toBe(1);
    await a.sync();
    for (const pc of [a, b]) {
      expect(pc.local.select().from(sqliteSchema.courses).where(eq(sqliteSchema.courses.id, c.id)).get()?.name).toBe("B's name (newer)");
    }
    expect(recentConflicts(b.conn)[0].resolution).toMatch(/this computer's newer change/);
  });

  it("keeps both versions of a note edited on both computers", async () => {
    const a = await computer("pc-a4");
    const b = await computer("pc-b4");
    const [n] = await a.app.insert(sqliteSchema.notes).values({ title: "Essay", markdown: "draft", created_at: now, updated_at: now }).returning();
    await a.sync();
    await b.sync();
    a.local.update(sqliteSchema.notes).set({ markdown: "A's paragraph" }).where(eq(sqliteSchema.notes.id, n.id)).run();
    await tick();
    b.local.update(sqliteSchema.notes).set({ markdown: "B's paragraph" }).where(eq(sqliteSchema.notes.id, n.id)).run();
    await a.sync();
    await b.sync();
    await a.sync();
    for (const pc of [a, b]) {
      const texts = pc.local.select().from(sqliteSchema.notes).all().filter((x) => x.title.startsWith("Essay")).map((x) => x.markdown).sort();
      expect(texts).toEqual(["A's paragraph", "B's paragraph"]);
    }
  });

  it("never loses a note edit to a delete made on the other computer", async () => {
    const a = await computer("pc-a5");
    const b = await computer("pc-b5");
    const [n] = await a.app.insert(sqliteSchema.notes).values({ title: "Keep me", markdown: "v1", created_at: now, updated_at: now }).returning();
    await a.sync();
    await b.sync();
    b.local.update(sqliteSchema.notes).set({ markdown: "edited offline" }).where(eq(sqliteSchema.notes.id, n.id)).run();
    await tick();
    a.local.delete(sqliteSchema.notes).where(eq(sqliteSchema.notes.id, n.id)).run();
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.local.select().from(sqliteSchema.notes).where(eq(sqliteSchema.notes.id, n.id)).get()?.markdown).toBe("edited offline");
  });

  it("drops work made offline inside something the other computer deleted, without getting stuck", async () => {
    const a = await computer("pc-a6");
    const b = await computer("pc-b6");
    const [c] = await a.app.insert(sqliteSchema.courses).values(course("Dropped")).returning();
    await a.sync();
    await b.sync();
    a.local.delete(sqliteSchema.courses).where(eq(sqliteSchema.courses.id, c.id)).run();
    await b.app.insert(sqliteSchema.folders).values({ course_id: c.id, name: "Orphan", created_at: now });
    await a.sync();
    await b.sync(); // must not throw
    expect(b.local.select().from(sqliteSchema.folders).where(eq(sqliteSchema.folders.name, "Orphan")).all()).toHaveLength(0);
    expect(outboxCount(b.conn)).toBe(0);
  });

  it("settles a one-per-course clash (both set an exam date)", async () => {
    const a = await computer("pc-a7");
    const b = await computer("pc-b7");
    const [c] = await a.app.insert(sqliteSchema.courses).values(course("Exams")).returning();
    await a.sync();
    await b.sync();
    await a.app.insert(sqliteSchema.exam_dates).values({ course_id: c.id, date: "2026-12-01", updated_at: now });
    await tick(); // B's is the newer one
    await b.app.insert(sqliteSchema.exam_dates).values({ course_id: c.id, date: "2026-12-10", updated_at: now });
    await a.sync();
    await b.sync(); // B keeps its newer date and replaces A's in the cloud
    await a.sync();
    const dates = (pc: typeof a) => pc.local.select().from(sqliteSchema.exam_dates).where(eq(sqliteSchema.exam_dates.course_id, c.id)).all().map((d) => d.date);
    expect(dates(a)).toEqual(["2026-12-10"]);
    expect(dates(b)).toEqual(["2026-12-10"]);
  });

  it("picks up changes made by a computer in plain Supabase mode", async () => {
    const a = await computer("pc-a8");
    await cloud.insert(pgSchema.courses).values({ name: "Made in cloud mode", created_at: now });
    await a.sync();
    expect(a.local.select().from(sqliteSchema.courses).where(eq(sqliteSchema.courses.name, "Made in cloud mode")).all()).toHaveLength(1);
  });

  it("restoring a backup on one computer restores it on the others too", async () => {
    const a = await computer("pc-a10");
    const b = await computer("pc-b10");
    const [kept] = await a.app.insert(sqliteSchema.courses).values(course("In the backup")).returning();
    await a.sync();
    await b.sync();
    const backup = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sb-sync-restore-")), "backup.db");
    await writeSnapshot({ source: { db: a.local, tables: sqliteSchema }, targetPath: backup, previousPath: null });

    const [later] = await a.app.insert(sqliteSchema.courses).values(course("Made after the backup")).returning();
    a.local.update(sqliteSchema.courses).set({ name: "Renamed after" }).where(eq(sqliteSchema.courses.id, kept.id)).run();
    await a.sync();
    await b.sync();

    replaceDatabaseContents(a.conn, backup); // what Restore does, with sync on
    a.ids.reset();
    await a.sync();
    await b.sync();
    for (const pc of [a, b]) {
      expect(pc.local.select().from(sqliteSchema.courses).where(eq(sqliteSchema.courses.id, kept.id)).get()?.name).toBe("In the backup");
      expect(pc.local.select().from(sqliteSchema.courses).where(eq(sqliteSchema.courses.id, later.id)).all()).toHaveLength(0);
    }
    // A's next new row doesn't reuse an id from before the restore.
    const [next] = await a.app.insert(sqliteSchema.courses).values(course("After restore")).returning();
    expect(next.id).toBeGreaterThan(kept.id);
  });

  it("doesn't get stuck when a row's parent is in a later upload batch", async () => {
    const a = await computer("pc-a11");
    const b = await computer("pc-b11");
    const [c] = await a.app.insert(sqliteSchema.courses).values(course("Batches")).returning();
    await a.sync();
    // Folder X is changed first, then moved under folder Y made after it —
    // so X's upload comes before Y's.
    const [x] = await a.app.insert(sqliteSchema.folders).values({ course_id: c.id, name: "X", created_at: now }).returning();
    const [y] = await a.app.insert(sqliteSchema.folders).values({ course_id: c.id, name: "Y", created_at: now }).returning();
    a.local.update(sqliteSchema.folders).set({ parent_folder_id: y.id }).where(eq(sqliteSchema.folders.id, x.id)).run();
    await push(a.ctx, 1); // a batch of one: X alone, before Y exists in the cloud
    expect(outboxCount(a.conn)).toBe(0);
    await b.sync();
    expect(b.local.select().from(sqliteSchema.folders).where(eq(sqliteSchema.folders.id, x.id)).get()?.parent_folder_id).toBe(y.id);
  });

  it("sets up a new computer with a full copy", async () => {
    const a = await computer("pc-a9");
    await a.app.insert(sqliteSchema.courses).values(course("Before C existed"));
    await a.sync();
    const c = await computer("pc-c9");
    await fullRefresh(c.ctx, null);
    expect(c.local.select().from(sqliteSchema.courses).where(eq(sqliteSchema.courses.name, "Before C existed")).all()).toHaveLength(1);
    const [mine] = await c.app.insert(sqliteSchema.courses).values(course("C's first")).returning();
    expect(mine.id).toBe(c.idBase + 1);
    const { rows } = (await cloud.execute(sql`select count(*)::int as n from sync_devices`)) as unknown as { rows: { n: number }[] };
    expect(rows[0].n).toBeGreaterThanOrEqual(3);
  });
});
