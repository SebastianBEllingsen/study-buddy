// Runs once when the server starts (Next.js instrumentation hook): daily
// backups, and background sync on computers set up for it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackupSchedule } = await import("./lib/backup/schedule");
    startBackupSchedule();
    // Only loaded when this computer syncs — it opens the database.
    const { resolveStorageConfig } = await import("./lib/db/config");
    const config = resolveStorageConfig();
    if (config.mode === "supabase" && config.sync) {
      const { startSyncLoop } = await import("./lib/sync/service");
      startSyncLoop();
    }
  }
}
