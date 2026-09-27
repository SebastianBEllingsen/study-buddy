import type Database from "better-sqlite3";
import { IdAllocator } from "./ids";
import { ensureLocalSyncTables, getSyncState } from "./local";

// Process-wide sync state, on globalThis so a dev hot-reload keeps it: the
// id allocator shared by the app's database handle and the sync engine,
// and the latest sync status for the UI.

export type SyncHealth = "synced" | "pending" | "syncing" | "offline" | "error";

export interface SyncStatus {
  health: SyncHealth;
  pending: number;
  lastSyncedAt: string | null; // ISO
  error: string | null;
}

declare global {
  var __studyBuddySync: { allocator: IdAllocator | null; status: SyncStatus } | undefined;
}

export const syncRuntime = (globalThis.__studyBuddySync ??= {
  allocator: null,
  status: { health: "pending", pending: 0, lastSyncedAt: null, error: null },
});

// This computer's id allocator, if it's been set up for sync.
export function deviceAllocator(conn: Database.Database): IdAllocator | null {
  if (syncRuntime.allocator) return syncRuntime.allocator;
  ensureLocalSyncTables(conn);
  const base = getSyncState(conn, "id_base");
  if (!base) return null;
  syncRuntime.allocator = new IdAllocator(conn, Number(base));
  return syncRuntime.allocator;
}
