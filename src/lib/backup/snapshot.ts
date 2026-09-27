import fs from "node:fs";
import Database from "better-sqlite3";
import { getTableColumns, getTableName, inArray, is, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as sqliteSchema from "../db/schema.sqlite";
import { bootstrapSqliteDatabase } from "../db/sqliteBootstrap";

// Writes a complete copy of the app's data to a standalone SQLite file —
// from whichever database is in use (the local file or Supabase), since the
// two schemas mirror each other table for table. A backup is self-contained:
// every document's PDF is inside it, even where the live database only
// keeps a path to a file on disk.
//
// PDFs are most of the data (and never change once uploaded), so each one
// is copied from the previous backup when it's already there, and only new
// ones are read from the source — the difference between a few MB and a
// few hundred MB of download per backup on Supabase.

// Every table, by its export name in schema.sqlite.ts — read from the
// schema itself, so a table added later can't be left out of backups.
export function backupTableNames(): string[] {
  return Object.entries(sqliteSchema)
    .filter(([, value]) => is(value, SQLiteTable))
    .map(([name]) => name);
}

// A drizzle database to read from: SQLite's or Postgres's, same query API.
type SourceDb = {
  select: (fields?: Record<string, unknown>) => {
    from: (table: never) => PromiseLike<Record<string, unknown>[]> & {
      where: (condition: unknown) => PromiseLike<Record<string, unknown>[]>;
    };
  };
};

export interface SnapshotSource {
  db: unknown;
  // The source's table objects by the same export names as schema.sqlite.ts.
  tables: Record<string, unknown>;
}

const INSERT_CHUNK = 100;
const PDF_FETCH_CHUNK = 10;

export async function writeSnapshot(options: {
  source: SnapshotSource;
  targetPath: string;
  previousPath: string | null;
  // Reads a document's file from disk (local mode keeps PDFs there).
  readDocumentFile?: (filePath: string) => Buffer | null;
}): Promise<{ rows: number }> {
  const source = options.source.db as SourceDb;
  const tmpPath = `${options.targetPath}.tmp`;
  fs.rmSync(tmpPath, { force: true });
  const target = new Database(tmpPath);
  let rows = 0;
  try {
    bootstrapSqliteDatabase(target);
    // Rows go in table by table in no particular order — parents can come
    // after their children (e.g. a folder moved under a newer one).
    target.pragma("foreign_keys = OFF");
    const targetDb = drizzle(target, { schema: sqliteSchema });
    const previous = options.previousPath && fs.existsSync(options.previousPath) ? new Database(options.previousPath, { readonly: true }) : null;
    try {
      for (const name of backupTableNames()) {
        const sourceTable = options.source.tables[name] as Table | undefined;
        if (!sourceTable) throw new Error(`The source database has no "${name}" table`);
        const targetTable = (sqliteSchema as Record<string, unknown>)[name] as Table;
        const data =
          name === "documents"
            ? await readDocuments(source, sourceTable, previous, options.readDocumentFile)
            : await source.select().from(sourceTable as never);
        target.exec(`DELETE FROM "${getTableName(targetTable)}"`);
        target.exec("BEGIN");
        for (let i = 0; i < data.length; i += INSERT_CHUNK) {
          targetDb
            .insert(targetTable as never)
            .values(data.slice(i, i + INSERT_CHUNK) as never)
            .run();
        }
        target.exec("COMMIT");
        rows += data.length;
      }
    } finally {
      previous?.close();
    }
    target.close();
  } catch (err) {
    if (target.open) target.close();
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
  fs.renameSync(tmpPath, options.targetPath);
  return { rows };
}

// Documents without their PDF column, then each inline PDF from the
// previous backup (same document: same id, filename and upload time), the
// disk, or the source — in that order. PDFs kept in blob storage
// (file_url) are copied with the backup's other files instead.
async function readDocuments(
  source: SourceDb,
  table: Table,
  previous: Database.Database | null,
  readDocumentFile: ((filePath: string) => Buffer | null) | undefined
): Promise<Record<string, unknown>[]> {
  const { file_base64: fileColumn, ...columns } = getTableColumns(table) as Record<string, unknown>;
  const docs = await source.select(columns).from(table as never);
  const fromPrevious = previous?.prepare(
    "SELECT file_base64 FROM documents WHERE id = ? AND filename = ? AND created_at = ?"
  );
  const needed: number[] = [];
  for (const doc of docs) {
    // Kept in blob storage: the backup's blob mirror has the file.
    if (doc.file_url) {
      doc.file_base64 = null;
      continue;
    }
    const kept = fromPrevious?.get(doc.id, doc.filename, doc.created_at) as { file_base64: string | null } | undefined;
    if (kept?.file_base64) {
      doc.file_base64 = kept.file_base64;
      continue;
    }
    const onDisk = typeof doc.file_path === "string" ? readDocumentFile?.(doc.file_path) : null;
    if (onDisk) {
      doc.file_base64 = onDisk.toString("base64");
      continue;
    }
    doc.file_base64 = null;
    needed.push(doc.id as number);
  }
  const byId = new Map(docs.map((d) => [d.id as number, d]));
  const idColumn = (columns as Record<string, unknown>).id;
  for (let i = 0; i < needed.length; i += PDF_FETCH_CHUNK) {
    const fetched = await source
      .select({ id: idColumn, file_base64: fileColumn })
      .from(table as never)
      .where(inArray(idColumn as never, needed.slice(i, i + PDF_FETCH_CHUNK)));
    for (const row of fetched) {
      const doc = byId.get(row.id as number);
      if (doc) doc.file_base64 = row.file_base64;
    }
  }
  return docs;
}

// Swaps every table's contents in `conn` for a backup file's, in one
// transaction, and repoints image URLs per `urlRewrites` (e.g. Supabase
// Storage URLs to the local copies restored next to it). Columns are
// matched by name, so a database whose columns were added in a different
// order (older installs upgraded by ALTER TABLE) restores correctly.
export function replaceDatabaseContents(
  conn: Database.Database,
  backupFile: string,
  urlRewrites: Map<string, string> = new Map()
): void {
  conn.pragma("foreign_keys = OFF");
  conn.prepare("ATTACH DATABASE ? AS restore_src").run(backupFile);
  try {
    conn.exec("BEGIN");
    try {
      for (const exportName of backupTableNames()) {
        const table = getTableName((sqliteSchema as Record<string, unknown>)[exportName] as Table);
        const liveCols = new Set(
          (conn.prepare(`PRAGMA main.table_info("${table}")`).all() as { name: string }[]).map((c) => c.name)
        );
        const cols = (conn.prepare(`PRAGMA restore_src.table_info("${table}")`).all() as { name: string; type: string }[]).filter(
          (c) => liveCols.has(c.name)
        );
        const list = cols.map((c) => `"${c.name}"`).join(", ");
        conn.exec(`DELETE FROM main."${table}"`);
        conn.exec(`INSERT INTO main."${table}" (${list}) SELECT ${list} FROM restore_src."${table}"`);
        const textCols = cols.filter((c) => /TEXT/i.test(c.type) && c.name !== "file_base64");
        for (const [from, to] of urlRewrites) {
          for (const col of textCols) {
            conn
              .prepare(`UPDATE main."${table}" SET "${col.name}" = replace("${col.name}", ?, ?) WHERE instr("${col.name}", ?) > 0`)
              .run(from, to, from);
          }
        }
      }
      conn.exec("COMMIT");
    } catch (err) {
      conn.exec("ROLLBACK");
      throw err;
    }
  } finally {
    conn.exec("DETACH DATABASE restore_src");
    conn.pragma("foreign_keys = ON");
  }
}
