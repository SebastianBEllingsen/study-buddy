import { reconnect } from "@/lib/db";
import { reconnectBlobStorage } from "@/lib/blobStorage";

// Tries the saved storage settings again, without changing them — for when
// the cloud database was unreachable and the app fell back to this
// computer's copy (see lib/db/index.ts). Changing the settings themselves
// goes through POST /api/storage-settings.
export async function POST() {
  const result = await reconnect();
  reconnectBlobStorage();
  return Response.json(result);
}
