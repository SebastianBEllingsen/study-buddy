import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { reconnect } from "../db";
import { resolveStorageConfig, supabaseDetails, writeStorageConfig, type StorageConfig } from "../db/config";
import { createPostgresDb } from "../db/postgres";
import { sqliteConnection, sqliteDb } from "../db/sqlite";
import * as sqliteSchema from "../db/schema.sqlite";
import { BACKUP_DIR, listBackups } from "../backup/service";
import { writeSnapshot } from "../backup/snapshot";
import { reconnectBlobStorage } from "../blobStorage";
import { ensureCloudSync, registerDevice, type CloudDb } from "./cloud";
import { fullRefresh, NeedsFullRefresh, pull, push, recentConflicts, type SyncContext } from "./engine";
import { IdAllocator } from "./ids";
import { ensureLocalSyncTables, getSyncState, installTriggers, outboxCount, removeTriggers, setSyncState } from "./local";
import { syncRuntime, type SyncStatus } from "./runtime";

// Sync mode, end to end: turning it on for this computer (a full copy of
// the cloud database, then triggers that record every change), the
// background loop that pulls and pushes, and turning it off again.

type SupabaseConfig = Extract<StorageConfig, { mode: "supabase" }>;

const SYNC_EVERY_MS = 15_000;

declare global {
  var __studyBuddySyncCloud: { connectionString: string; db: SyncContext["cloud"]; end: () => Promise<void> } | undefined;
  var __studyBuddySyncLoop: boolean | undefined;
}

export function syncEnabled(): boolean {
  const config = resolveStorageConfig();
  return config.mode === "supabase" && !!config.sync;
}

// The sync engine's own connection to the cloud (the app itself doesn't
// use one in sync mode). Opened lazily — offline, this is what fails.
async function cloudDb(connectionString: string): Promise<SyncContext["cloud"]> {
  const current = globalThis.__studyBuddySyncCloud;
  if (current?.connectionString === connectionString) return current.db;
  if (current) await current.end().catch(() => {});
  // Two connections are plenty for syncing, and leave the Supabase
  // pooler's limited slots for everything else.
  const { db, client } = await createPostgresDb(connectionString, { maxConnections: 2 });
  const cloud = db as unknown as SyncContext["cloud"];
  globalThis.__studyBuddySyncCloud = { connectionString, db: cloud, end: () => client.end() };
  return cloud;
}

async function dropCloudConnection() {
  const current = globalThis.__studyBuddySyncCloud;
  globalThis.__studyBuddySyncCloud = undefined;
  await current?.end().catch(() => {});
}

function context(cloud: SyncContext["cloud"], allocator: IdAllocator): SyncContext {
  const deviceId = getSyncState(sqliteConnection, "device_id");
  if (!deviceId) throw new Error("This computer isn't set up for sync");
  return { conn: sqliteConnection, local: sqliteDb, cloud, deviceId, ids: allocator };
}

function latestBackupPath(): string | null {
  const latest = listBackups()[0];
  return latest ? path.join(BACKUP_DIR, latest.name) : null;
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "_");
}

// Turns sync on for this computer: registers it, saves its current local
// database as a backup, replaces it with a full copy of the cloud one, and
// from then on records every change for upload.
export async function enableSync(config: SupabaseConfig): Promise<void> {
  const started = Date.now();
  const step = (label: string) => console.info(`Sync set-up: ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  const cloud = await cloudDb(config.connectionString);
  step("connected");
  await ensureCloudSync(cloud as CloudDb);
  step("cloud change log ready");
  ensureLocalSyncTables(sqliteConnection);
  const deviceId = getSyncState(sqliteConnection, "device_id") ?? crypto.randomUUID();
  const device = await registerDevice(cloud as CloudDb, deviceId, os.hostname());
  step("computer registered");

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  await writeSnapshot({
    source: { db: sqliteDb, tables: sqliteSchema },
    targetPath: path.join(BACKUP_DIR, `study-buddy-before-sync-${stamp()}.db`),
    previousPath: null,
  });

  const allocator = new IdAllocator(sqliteConnection, device.idBase);
  setSyncState(sqliteConnection, "device_id", deviceId);
  setSyncState(sqliteConnection, "id_base", String(device.idBase));
  installTriggers(sqliteConnection);
  try {
    await fullRefresh(context(cloud, allocator), latestBackupPath());
    step("full copy downloaded");
  } catch (err) {
    removeTriggers(sqliteConnection);
    throw err;
  }
  syncRuntime.allocator = allocator;
  writeStorageConfig({ ...config, sync: true });
  await reconnect();
  reconnectBlobStorage();
  setStatus({ health: "synced", lastSyncedAt: new Date().toISOString(), error: null });
  startSyncLoop();
}

// Turns sync off, back to plain Supabase mode (everything must be uploaded
// first) or to this computer only.
export async function disableSync(to: "supabase" | "local"): Promise<{ notUploaded: number }> {
  const config = resolveStorageConfig();
  if (config.mode !== "supabase" || !config.sync) return { notUploaded: 0 };
  if (to === "supabase") {
    await syncNow();
    const left = outboxCount(sqliteConnection);
    if (left > 0) throw new Error(`${left} change(s) haven't been uploaded yet — connect to the internet and try again`);
  }
  const notUploaded = outboxCount(sqliteConnection);
  removeTriggers(sqliteConnection);
  writeStorageConfig(
    to === "supabase" ? { ...config, sync: false } : { mode: "local", remembered: supabaseDetails(config) ?? undefined }
  );
  await dropCloudConnection();
  await reconnect();
  reconnectBlobStorage();
  return { notUploaded };
}

let running: Promise<void> | null = null;

// One pull-then-push round. Offline, it just reports that and tries again
// on the next round.
export function syncNow(): Promise<void> {
  running ??= (async () => {
    const config = resolveStorageConfig();
    if (config.mode !== "supabase" || !config.sync || !syncRuntime.allocator) return;
    setStatus({ health: "syncing" });
    try {
      const ctx = context(await cloudDb(config.connectionString), syncRuntime.allocator);
      try {
        await pull(ctx);
      } catch (err) {
        if (!(err instanceof NeedsFullRefresh)) throw err;
        // Away longer than the cloud keeps its change log: upload what's
        // here, then start again from a full copy.
        await push(ctx);
        await fullRefresh(ctx, latestBackupPath());
      }
      await push(ctx);
      setStatus({ health: "synced", lastSyncedAt: new Date().toISOString(), error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const offline = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|getaddrinfo|connect|network|CONNECT_TIMEOUT/i.test(message);
      if (offline) await dropCloudConnection();
      setStatus({ health: offline ? "offline" : "error", error: offline ? null : message });
      if (!offline) console.error("Sync failed:", err);
    } finally {
      running = null;
    }
  })();
  return running;
}

function setStatus(update: Partial<SyncStatus>) {
  const pending = syncRuntime.allocator ? outboxCount(sqliteConnection) : 0;
  const next = { ...syncRuntime.status, ...update, pending };
  if (next.health === "synced" && pending > 0) next.health = "pending";
  syncRuntime.status = next;
}

export function syncStatus(): SyncStatus & { enabled: boolean; conflicts: ReturnType<typeof recentConflicts> } {
  const enabled = syncEnabled() && !!syncRuntime.allocator;
  if (enabled) setStatus({});
  return { ...syncRuntime.status, enabled, conflicts: enabled ? recentConflicts(sqliteConnection) : [] };
}

export function startSyncLoop(): void {
  if (globalThis.__studyBuddySyncLoop) return;
  globalThis.__studyBuddySyncLoop = true;
  setInterval(() => {
    if (syncEnabled()) void syncNow();
  }, SYNC_EVERY_MS).unref();
  if (syncEnabled()) void syncNow();
}
