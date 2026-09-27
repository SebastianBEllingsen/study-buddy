import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getTableName, type Table } from "drizzle-orm";
import { usingPostgres, db } from "../db";
import * as pgSchema from "../db/schema.pg";
import * as sqliteSchema from "../db/schema.sqlite";
import { sqliteConnection, sqliteDb } from "../db/sqlite";
import { blobKeyFromUrl, blobUrlsIn } from "../blobStorage/urls";
import { readBlob } from "../blobStorage";
import { mapWithConcurrency } from "../concurrency";
import { enqueue } from "../db/operationQueue";
import { backupTableNames, replaceDatabaseContents, writeSnapshot } from "./snapshot";
import { syncRuntime } from "../sync/runtime";

// Backups of all the app's data to this computer (data/backups/), made
// once a day while the app runs (see schedule.ts) or on demand, from
// whichever database is in use. Each is a standalone SQLite file; the
// images and files its data points at are mirrored once into
// data/backups/blobs/, so a backup restores even if the cloud copy is gone.

const dataDir = path.join(process.cwd(), "data");
export const BACKUP_DIR = path.join(dataDir, "backups");
const BACKUP_BLOBS_DIR = path.join(BACKUP_DIR, "blobs");
const LIVE_BLOBS_DIR = path.join(dataDir, "blobs");
export const BACKUPS_KEPT = 14;
const MAX_BLOB_BYTES = 100 * 1024 * 1024;
const NAME = /^study-buddy-[0-9A-Za-z_-]+\.db$/;

export interface BackupInfo {
  name: string;
  createdAt: string; // ISO
  bytes: number;
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => NAME.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, createdAt: (startedAt(name) ?? stat.mtime).toISOString(), bytes: stat.size };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// When the backup started, from its name (a big first backup can take a
// couple of minutes to write, so the file's own time is when it finished).
function startedAt(name: string): Date | null {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.db$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

function stamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

function readDocumentFile(filePath: string): Buffer | null {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

// One backup or restore at a time (the daily one and a click can collide).
let running: Promise<unknown> | null = null;
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = (running ?? Promise.resolve()).catch(() => {}).then(fn);
  running = next;
  return next;
}

export function createBackup(): Promise<BackupInfo & { rows: number; blobs: BlobMirrorResult }> {
  return exclusive(async () => {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const previous = listBackups()[0];
    const name = `study-buddy-${stamp()}.db`;
    const target = path.join(BACKUP_DIR, name);
    const source = usingPostgres ? { db, tables: pgSchema } : { db: sqliteDb, tables: sqliteSchema };
    const { rows } = await writeSnapshot({
      source,
      targetPath: target,
      previousPath: previous ? path.join(BACKUP_DIR, previous.name) : null,
      readDocumentFile,
    });
    const blobs = await mirrorBlobs(target);
    prune();
    const stat = fs.statSync(target);
    return { name, createdAt: (startedAt(name) ?? stat.mtime).toISOString(), bytes: stat.size, rows, blobs };
  });
}

function prune() {
  for (const old of listBackups().slice(BACKUPS_KEPT)) {
    fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
  }
}

// A path under `dir` for a blob key, or null if the key would escape it.
function blobPath(dir: string, key: string): string | null {
  const full = path.join(dir, key);
  return full.startsWith(dir + path.sep) ? full : null;
}

// Every blob URL mentioned anywhere in a backup (PDF contents excluded).
function blobUrlsInBackup(file: string): string[] {
  const backup = new Database(file, { readonly: true });
  try {
    const urls = new Set<string>();
    for (const name of backupTableNames()) {
      const table = sqliteTableName(name);
      const columns = (backup.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[])
        .map((c) => c.name)
        .filter((c) => c !== "file_base64");
      const select = backup.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(", ")} FROM "${table}"`);
      for (const row of select.iterate()) {
        for (const url of blobUrlsIn(JSON.stringify(row))) urls.add(url);
      }
    }
    return [...urls];
  } finally {
    backup.close();
  }
}

function sqliteTableName(exportName: string): string {
  return getTableName((sqliteSchema as Record<string, unknown>)[exportName] as Table);
}

export interface BlobMirrorResult {
  copied: number;
  failed: number;
}

// Copies the images/media a backup points at into data/backups/blobs/ —
// once per file (keys are unique and never reused).
async function mirrorBlobs(backupFile: string): Promise<BlobMirrorResult> {
  const result = { copied: 0, failed: 0 };
  await mapWithConcurrency(blobUrlsInBackup(backupFile), 4, async (url) => {
    const key = blobKeyFromUrl(url);
    const dest = key && blobPath(BACKUP_BLOBS_DIR, key);
    if (!key || !dest || fs.existsSync(dest)) return;
    try {
      let bytes: Buffer | null = null;
      if (url.startsWith("/api/blobs/")) {
        // This computer's copy, or downloaded from Storage.
        bytes = await readBlob(key);
      } else {
        const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
        if (res.ok) {
          const body = Buffer.from(await res.arrayBuffer());
          if (body.length <= MAX_BLOB_BYTES) bytes = body;
        }
      }
      if (!bytes) {
        result.failed++;
        return;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, bytes);
      result.copied++;
    } catch {
      result.failed++;
    }
  });
  return result;
}

// Loads a backup into this computer's local database (what "This computer"
// storage uses), with its images — after first backing up the local
// database as it is now, so a restore can itself be undone. In sync mode
// the restore is recorded like any other change, so it's uploaded and
// becomes the state on every computer (Settings says so before it runs).
export function restoreBackup(name: string): Promise<{ restored: string; savedFirst: string }> {
  return exclusive(async () => {
    if (!NAME.test(name)) throw new Error("Not a backup file");
    const file = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(file)) throw new Error("That backup doesn't exist anymore");

    const savedFirst = `study-buddy-before-restore-${stamp()}.db`;
    await writeSnapshot({
      source: { db: sqliteDb, tables: sqliteSchema },
      targetPath: path.join(BACKUP_DIR, savedFirst),
      previousPath: null,
      readDocumentFile,
    });

    // Images: back into the live local blob folder, and pointed at there.
    const localized = new Map<string, string>();
    for (const url of blobUrlsInBackup(file)) {
      const key = blobKeyFromUrl(url);
      const mirrored = key && blobPath(BACKUP_BLOBS_DIR, key);
      const live = key && blobPath(LIVE_BLOBS_DIR, key);
      if (!key || !mirrored || !live || !fs.existsSync(mirrored)) continue;
      if (!fs.existsSync(live)) {
        fs.mkdirSync(path.dirname(live), { recursive: true });
        fs.copyFileSync(mirrored, live);
      }
      if (!url.startsWith("/api/blobs/")) localized.set(url, `/api/blobs/${key}`);
    }

    // Local writes go through the same queue as transactions (db/index.ts),
    // so nothing interleaves with the swap.
    await enqueue(async () => {
      replaceDatabaseContents(sqliteConnection, file, localized);
    });
    // Rows in this computer's own id range may have come or gone — its
    // sync id counter has to look again (see sync/ids.ts).
    syncRuntime.allocator?.reset();
    prune();
    return { restored: name, savedFirst };
  });
}

export function latestBackupAge(now = Date.now()): number | null {
  const latest = listBackups()[0];
  return latest ? now - Date.parse(latest.createdAt) : null;
}
