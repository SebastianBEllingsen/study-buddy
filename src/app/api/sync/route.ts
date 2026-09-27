import { syncNow, syncStatus } from "@/lib/sync/service";

// Sync status for the header indicator and Settings (see lib/sync/).
export async function GET() {
  return Response.json(syncStatus());
}

// "Sync now".
export async function POST() {
  await syncNow();
  return Response.json(syncStatus());
}
