import { describe, it, expect, vi, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { TestDb } from "../db/testHarness";

let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});

const { createCourse, createGeneratedItem } = await import("../models");
const { backupTableNames, replaceDatabaseContents, writeSnapshot } = await import("./snapshot");
const { bootstrapSqliteDatabase } = await import("../db/sqliteBootstrap");
const pgSchema = await import("../db/schema.pg");
const { getTableColumns, eq } = await import("drizzle-orm");
const eqId = (id: number) => eq(testDb.schema.courses.id, id);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-backup-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("backupTableNames", () => {
  it("covers every table, each with a matching Postgres table and columns", () => {
    const names = backupTableNames();
    expect(names.length).toBeGreaterThanOrEqual(34);
    for (const name of names) {
      const pg = (pgSchema as Record<string, unknown>)[name];
      expect(pg, name).toBeDefined();
      const sqliteCols = Object.keys(getTableColumns(testDb.schema[name as keyof typeof testDb.schema] as never)).sort();
      expect(Object.keys(getTableColumns(pg as never)).sort(), name).toEqual(sqliteCols);
    }
  });
});

describe("writeSnapshot", () => {
  it("copies every table, embeds PDFs, and reuses them from the previous backup", async () => {
    const course = await createCourse("Backed up");
    await createGeneratedItem({
      courseId: course.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: "Deck",
      contentJson: { cards: [{ front: "Q", back: "A" }] },
      sourceDocumentIds: [],
    });
    const { documents } = testDb.schema;
    await testDb.db.insert(documents).values({
      course_id: course.id,
      filename: "notes.pdf",
      file_path: "/disk/notes.pdf",
      status: "extracted",
      created_at: "2026-09-01 10:00:00",
    } as never);

    const source = { db: testDb.db, tables: testDb.schema };
    const first = path.join(dir, "first.db");
    const readDocumentFile = vi.fn((p: string) => (p === "/disk/notes.pdf" ? Buffer.from("%PDF-1") : null));
    await writeSnapshot({ source, targetPath: first, previousPath: null, readDocumentFile });

    const copy = new Database(first, { readonly: true });
    expect(copy.prepare("SELECT name FROM courses").all()).toContainEqual({ name: "Backed up" });
    expect(copy.prepare("SELECT count(*) AS n FROM generated_items").get()).toEqual({ n: 1 });
    const doc = copy.prepare("SELECT file_base64 FROM documents WHERE filename = 'notes.pdf'").get() as { file_base64: string };
    expect(Buffer.from(doc.file_base64, "base64").toString()).toBe("%PDF-1");
    copy.close();

    // The file is gone from disk now — the next backup takes it from the first.
    const second = path.join(dir, "second.db");
    await writeSnapshot({ source, targetPath: second, previousPath: first, readDocumentFile: () => null });
    const again = new Database(second, { readonly: true });
    const kept = again.prepare("SELECT file_base64 FROM documents WHERE filename = 'notes.pdf'").get() as { file_base64: string };
    expect(Buffer.from(kept.file_base64, "base64").toString()).toBe("%PDF-1");
    again.close();
    expect(fs.existsSync(`${second}.tmp`)).toBe(false);
  });
});

describe("writeSnapshot with PDFs in blob storage", () => {
  it("leaves a stored file out of the backup file (the blob mirror has it)", async () => {
    const course = await createCourse("Stored");
    await testDb.db.insert(testDb.schema.documents).values({
      course_id: course.id,
      filename: "stored.pdf",
      file_path: "/gone/stored.pdf",
      file_url: "/api/blobs/documents/s.pdf",
      status: "extracted",
      created_at: "2026-09-02 10:00:00",
    } as never);
    const out = path.join(dir, "stored.db");
    await writeSnapshot({ source: { db: testDb.db, tables: testDb.schema }, targetPath: out, previousPath: null });
    const copy = new Database(out, { readonly: true });
    expect(copy.prepare("SELECT file_url, file_base64 FROM documents WHERE filename = 'stored.pdf'").get()).toEqual({
      file_url: "/api/blobs/documents/s.pdf",
      file_base64: null,
    });
    copy.close();
  });
});

describe("replaceDatabaseContents", () => {
  it("restores a backup over newer data and repoints image URLs", async () => {
    const cover = "https://proj.supabase.co/storage/v1/object/public/bucket/course/abc.png";
    const course = await createCourse("Before");
    await testDb.db.update(testDb.schema.courses).set({ cover_image: cover }).where(eqId(course.id));
    const backup = path.join(dir, "restore-src.db");
    await writeSnapshot({ source: { db: testDb.db, tables: testDb.schema }, targetPath: backup, previousPath: null });

    const live = new Database(":memory:");
    bootstrapSqliteDatabase(live);
    live.prepare("INSERT INTO courses (name, created_at) VALUES ('Made later', '2026-09-30 00:00:00')").run();

    replaceDatabaseContents(live, backup, new Map([[cover, "/api/blobs/course/abc.png"]]));
    const names = (live.prepare("SELECT name FROM courses").all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain("Before");
    expect(names).not.toContain("Made later");
    expect(live.prepare("SELECT cover_image FROM courses WHERE name = 'Before'").get()).toEqual({
      cover_image: "/api/blobs/course/abc.png",
    });
    expect(live.pragma("foreign_keys", { simple: true })).toBe(1);
    live.close();
  });
});
