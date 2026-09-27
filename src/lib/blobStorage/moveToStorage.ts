import crypto from "node:crypto";
import path from "node:path";
import { and, count, eq, getTableColumns, getTableName, is, isNotNull, isNull, sql, type Table } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db, usingPostgres } from "../db";
import * as pgSchema from "../db/schema.pg";
import { resolveStorageConfig } from "../db/config";
import type { PostgresDb } from "../db/postgres";
import { blobStore } from "./index";

// One-time move of files out of the Supabase database, into Storage
// (Settings → Storage → Move files): PDFs stored inline in
// documents.file_base64 — most of the database's size — and image URLs
// that point at the bucket's public address instead of this app's own
// /api/blobs/ route (which serves every computer from its local cache).
// Each step is safe to stop and run again: a PDF's inline copy is only
// dropped once it's in Storage, and already-moved rows are skipped.

// Only called in Supabase mode, where db is the Postgres connection (its
// static type is pinned to SQLite's — see db/index.ts).
function pg(): PostgresDb {
  return db as unknown as PostgresDb;
}

export function canMoveToStorage(): boolean {
  return usingPostgres && blobStore?.kind === "supabase";
}

// The bucket's public URL prefix that stored rows may still contain.
function publicPrefix(): string | null {
  const config = resolveStorageConfig();
  if (config.mode !== "supabase" || !config.storageUrl || !config.storageBucket) return null;
  return `${config.storageUrl.replace(/\/$/, "")}/storage/v1/object/public/${config.storageBucket}/`;
}

// Points every stored public bucket URL at /api/blobs/<same key>.
export async function localizeBlobUrls(): Promise<void> {
  const prefix = publicPrefix();
  if (!prefix) return;
  const tables = Object.values(pgSchema).filter((value) => is(value, PgTable)) as PgTable[];
  for (const table of tables) {
    for (const column of Object.values(getTableColumns(table as Table))) {
      if (column.columnType !== "PgText" || column.name === "file_base64") continue;
      const t = sql.identifier(getTableName(table as Table));
      const c = sql.identifier(column.name);
      await pg().execute(
        sql`update ${t} set ${c} = replace(${c}, ${prefix}, '/api/blobs/') where strpos(${c}, ${prefix}) > 0`
      );
    }
  }
}

const docs = pgSchema.documents;
const waiting = and(isNotNull(docs.file_base64), isNull(docs.file_url));

export async function documentsLeftToMove(): Promise<number> {
  const [row] = await pg().select({ n: count() }).from(docs).where(waiting);
  return Number(row?.n ?? 0);
}

// Moves PDFs until `budgetMs` is used up (so each request stays short).
export async function moveDocuments(budgetMs: number): Promise<{ moved: number; failed: number; remaining: number }> {
  if (!blobStore || blobStore.kind !== "supabase") throw new Error("Supabase Storage isn't set up");
  const deadline = Date.now() + budgetMs;
  let moved = 0;
  let failed = 0;
  const skip = new Set<number>();
  while (Date.now() < deadline) {
    const batch = await pg()
      .select({ id: docs.id, filename: docs.filename })
      .from(docs)
      .where(waiting)
      .limit(20);
    const todo = batch.filter((d) => !skip.has(d.id)).slice(0, 5);
    if (todo.length === 0) break;
    for (const doc of todo) {
      const [row] = await pg()
        .select({ file_base64: docs.file_base64 })
        .from(docs)
        .where(eq(docs.id, doc.id));
      if (!row?.file_base64) continue;
      const ext = path.extname(doc.filename).toLowerCase();
      const stored = await blobStore.put(`documents/${crypto.randomUUID()}${ext}`, Buffer.from(row.file_base64, "base64"), "application/octet-stream");
      if (!stored) {
        failed++;
        skip.add(doc.id);
        continue;
      }
      await pg()
        .update(docs)
        .set({ file_url: stored.url, file_base64: null })
        .where(and(eq(docs.id, doc.id), isNull(docs.file_url)));
      moved++;
    }
  }
  return { moved, failed, remaining: await documentsLeftToMove() };
}

// Hands the space the inline PDFs took back — Postgres otherwise only
// reuses it, and the database keeps counting it against its size limit.
export async function compactDocuments(): Promise<void> {
  await pg().execute(sql`vacuum full documents`);
}

export async function databaseSizeBytes(): Promise<number> {
  const result = (await pg().execute(sql`select pg_database_size(current_database()) as bytes`)) as unknown as { bytes: string }[];
  return Number(result[0]?.bytes ?? 0);
}
