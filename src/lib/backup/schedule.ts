// Makes a backup once a day while the app is running (started from
// src/instrumentation.ts): shortly after start-up, then checked hourly.
// The backup code is only imported when a backup is actually due, so
// starting the server never waits on it.

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 2 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;

declare global {
  var __studyBuddyBackupSchedule: boolean | undefined;
}

export function startBackupSchedule(): void {
  if (globalThis.__studyBuddyBackupSchedule) return;
  globalThis.__studyBuddyBackupSchedule = true;
  const check = async () => {
    try {
      const { createBackup, latestBackupAge } = await import("./service");
      const age = latestBackupAge();
      if (age === null || age >= DAY_MS) {
        const made = await createBackup();
        console.log(`Backup saved: ${made.name} (${(made.bytes / 1e6).toFixed(1)} MB)`);
      }
    } catch (err) {
      console.error("Daily backup failed:", err);
    }
  };
  setTimeout(() => {
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS).unref();
  }, FIRST_CHECK_MS).unref();
}
