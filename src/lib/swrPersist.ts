// Keeps SWR's cache across reloads and app restarts: every page shows the
// data it had last time straight away, and SWR's usual revalidate-on-mount
// swaps in fresh data a moment later. Stored in IndexedDB (no 5 MB cap,
// doesn't block the main thread), one snapshot record.

const DB_NAME = "study-buddy-swr";
const STORE = "cache";
const RECORD = "snapshot";
// Bump when a response shape changes in a way old cached data would break.
const VERSION = 1;
// Anything older is more misleading than useful.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// Responses that seed editable or in-progress state (an editor's content, an
// exam attempt's answers, the review queue being worked through) are never
// persisted: starting from a stale copy there could overwrite newer work
// before the refetch lands.
const NEVER_PERSIST = [
  "/api/notes/",
  "/api/canvases/",
  "/api/code-sets/",
  "/api/documents/",
  "/api/mock-exam-attempts/",
  "/api/items/",
  "/api/review/",
  "/api/today",
  "/api/search",
  // Live status — a stale copy would show sync as off (or synced) wrongly.
  "/api/sync",
];

export function shouldPersist(key: string): boolean {
  return key.startsWith("/api/") && !NEVER_PERSIST.some((prefix) => key.startsWith(prefix));
}

interface Snapshot {
  version: number;
  savedAt: number;
  entries: [string, unknown][];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readSnapshot(): Promise<[string, unknown][]> {
  const db = await openDb();
  try {
    const snapshot = await new Promise<Snapshot | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(RECORD);
      request.onsuccess = () => resolve(request.result as Snapshot | undefined);
      request.onerror = () => reject(request.error);
    });
    if (!snapshot || snapshot.version !== VERSION || Date.now() - snapshot.savedAt > MAX_AGE_MS) return [];
    return snapshot.entries.filter(([key]) => shouldPersist(key));
  } finally {
    db.close();
  }
}

export async function writeSnapshot(entries: [string, unknown][]): Promise<void> {
  const db = await openDb();
  try {
    const snapshot: Snapshot = { version: VERSION, savedAt: Date.now(), entries };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(snapshot, RECORD);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
