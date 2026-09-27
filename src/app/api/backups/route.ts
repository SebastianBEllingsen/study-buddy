import { BACKUP_DIR, BACKUPS_KEPT, createBackup, listBackups } from "@/lib/backup/service";

// The backups on this computer (see lib/backup/service.ts).
export async function GET() {
  return Response.json({ backups: listBackups(), folder: BACKUP_DIR, kept: BACKUPS_KEPT });
}

// "Back up now".
export async function POST() {
  try {
    const backup = await createBackup();
    return Response.json({ backup });
  } catch (err) {
    console.error("Backup failed:", err);
    return Response.json({ error: `Backup failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
