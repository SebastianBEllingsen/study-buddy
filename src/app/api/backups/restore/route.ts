import { restoreBackup } from "@/lib/backup/service";
import { parseJsonObjectBody } from "@/lib/requestBody";

// Loads a backup into this computer's local database. Body: { name }.
export async function POST(request: Request) {
  const { name } = await parseJsonObjectBody(request);
  if (typeof name !== "string") return Response.json({ error: "name is required" }, { status: 400 });
  try {
    return Response.json(await restoreBackup(name));
  } catch (err) {
    console.error("Restore failed:", err);
    return Response.json({ error: `Restore failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
