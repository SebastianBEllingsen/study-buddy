import { resolveStorageConfig, writeStorageConfig } from "@/lib/db/config";
import { lastConnectionError, reconnect } from "@/lib/db";
import { reconnectBlobStorage } from "@/lib/blobStorage";

export async function GET() {
  const config = resolveStorageConfig();
  return Response.json({
    mode: config.mode,
    hasConnectionString: config.mode === "supabase" && !!config.connectionString,
    connectionError: lastConnectionError,
    storageUrl: config.mode === "supabase" ? (config.storageUrl ?? "") : "",
    hasStorageServiceKey: config.mode === "supabase" && !!config.storageServiceKey,
    storageBucket: config.mode === "supabase" ? (config.storageBucket ?? "") : "",
  });
}

// Saves the choice and reconnects immediately — no restart needed. Run
// /api/storage-settings/migrate first when switching to Supabase, so a bad
// connection string never leaves the app pointed at an empty cloud database.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const mode = body?.mode;

  if (mode === "local") {
    writeStorageConfig({ mode: "local" });
    const result = await reconnect();
    reconnectBlobStorage();
    return Response.json(result);
  }

  if (mode === "supabase") {
    const connectionString =
      typeof body?.connectionString === "string" ? body.connectionString.trim() : "";
    if (!connectionString) {
      return Response.json(
        { error: "connectionString is required to switch to Supabase" },
        { status: 400 }
      );
    }
    // The three Storage fields are optional — left unset, images keep
    // inlining as base64 in the DB (see src/lib/blobStorage), same as
    // before this feature existed. storageServiceKey is a secret, so unlike
    // connectionString (which the client always resends) a blank submitted
    // value means "leave whatever's already configured alone," not "clear
    // it" — the client never gets the real key back from GET to resend.
    const existing = resolveStorageConfig();
    const existingStorageServiceKey =
      existing.mode === "supabase" ? existing.storageServiceKey : undefined;

    const storageUrl = typeof body?.storageUrl === "string" ? body.storageUrl.trim() : "";
    const storageServiceKeyInput =
      typeof body?.storageServiceKey === "string" ? body.storageServiceKey.trim() : "";
    const storageBucket = typeof body?.storageBucket === "string" ? body.storageBucket.trim() : "";
    writeStorageConfig({
      mode: "supabase",
      connectionString,
      storageUrl: storageUrl || undefined,
      storageServiceKey: storageServiceKeyInput || existingStorageServiceKey,
      storageBucket: storageBucket || undefined,
    });
    const result = await reconnect();
    reconnectBlobStorage();
    return Response.json(result);
  }

  return Response.json({ error: "mode must be 'local' or 'supabase'" }, { status: 400 });
}
