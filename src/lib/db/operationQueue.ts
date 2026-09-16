// Extracted out of db/index.ts so it's testable on its own (see
// operationQueue.test.ts) without importing db/index.ts itself — that
// module resolves a real database connection at import time (see its own
// top-level `await resolve(...)`), which sqlite.ts's/postgres.ts's guards
// now deliberately refuse to do during a test run. This file has no such
// side effect: it's just an in-memory promise chain, safe to import
// directly. testHarness.ts's own runTransaction reuses this exact function
// too, so the FIFO-serialization behavior a test exercises through the
// in-memory test harness is the same code production actually runs, not a
// parallel reimplementation that could silently diverge from it.
//
// Every runTransaction call AND every reconnect() call in db/index.ts goes
// through this single FIFO queue. Originally only SQLite's manual
// BEGIN/COMMIT/ROLLBACK needed serializing (two concurrent callers could
// otherwise interleave their BEGINs into what was meant to be one atomic
// block) — but a plain "SQLite transactions queue, Postgres transactions
// don't" split left a real gap: reconnect() reassigns `db`/`usingPostgres`
// (and, for Postgres, closes the client) with no coordination at all, so a
// reconnect() landing while a transaction was already running — or already
// queued — could hand that transaction's next db call to a connection of
// the wrong dialect entirely, or one that's just been closed out from under
// it. Routing reconnect() through the same queue makes it wait for any
// in-flight transaction to finish first, and makes any transaction that
// enqueues after it see the new connection consistently instead of a
// half-swapped one. This costs no real Postgres concurrency either —
// createPostgresDb's pool is already `max: 1`, so Postgres transactions
// were already effectively one-at-a-time.
//
// Cached on globalThis in dev for the same reason sqlite.ts caches the
// underlying connection there: Next.js's dev-mode HMR can load db/index.ts
// more than once while all instances still share that one cached
// connection. A plain module-level `let` here would give each instance its
// own queue over the same shared connection — two "independent" queues
// serialize nothing against each other, so a reconnect() from one instance
// could still swap `db` out from under a transaction another instance has
// in flight.
declare global {
  var __studyBuddyDbOperationQueue: Promise<void> | undefined;
}

let operationQueue: Promise<void> = globalThis.__studyBuddyDbOperationQueue ?? Promise.resolve();
if (process.env.NODE_ENV !== "production") {
  globalThis.__studyBuddyDbOperationQueue = operationQueue;
}

export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  // operationQueue itself never rejects (the line below always converts it
  // back to a resolved void promise), so the next enqueue's turn starts
  // regardless of whether this one succeeded or threw — a failed operation
  // must not jam the queue for everything after it.
  const result = operationQueue.then(fn);
  operationQueue = result.then(
    () => undefined,
    () => undefined
  );
  if (process.env.NODE_ENV !== "production") {
    globalThis.__studyBuddyDbOperationQueue = operationQueue;
  }
  return result;
}
