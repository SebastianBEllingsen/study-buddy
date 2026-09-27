import { resolveStorageConfig, supabaseDetails, writeStorageConfig } from "@/lib/db/config";
import { lastConnectionError, reconnect } from "@/lib/db";
import { reconnectBlobStorage } from "@/lib/blobStorage";
import { disableSync, enableSync } from "@/lib/sync/service";

export async function GET() {
  const config = resolveStorageConfig();
  const details = supabaseDetails(config);
  return Response.json({
    mode: config.mode === "supabase" && config.sync ? "sync" : config.mode,
    // Includes details remembered from before switching to local.
    hasConnectionString: !!details?.connectionString,
    connectionError: lastConnectionError,
    storageUrl: details?.storageUrl ?? "",
    hasStorageServiceKey: !!details?.storageServiceKey,
    storageBucket: details?.storageBucket ?? "",
  });
}

// Saves the choice and reconnects immediately — no restart needed. Run
// /api/storage-settings/migrate first when switching to Supabase, so a bad
// connection string never leaves the app pointed at an empty cloud database.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const mode = body?.mode;

  // This computer works on its own database and syncs with the Supabase
  // one (lib/sync/). Needs Supabase set up first.
  if (mode === "sync") {
    const existing = resolveStorageConfig();
    if (existing.mode !== "supabase") {
      return Response.json({ error: "Connect Supabase first, then turn on sync" }, { status: 400 });
    }
    try {
      await enableSync(existing);
      return Response.json({ ok: true, error: null });
    } catch (err) {
      console.error("Turning on sync failed:", err);
      return Response.json({ ok: false, error: `Couldn't turn on sync: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }
  }

  // Leaving sync mode goes through lib/sync/ (uploads first, removes the
  // change recording).
  const current = resolveStorageConfig();
  if (current.mode === "supabase" && current.sync && (mode === "local" || mode === "supabase")) {
    try {
      const { notUploaded } = await disableSync(mode);
      if (mode === "supabase") {
        return Response.json({ ok: true, error: null });
      }
      return Response.json({
        ok: true,
        error: notUploaded > 0 ? `${notUploaded} change(s) made offline were never uploaded to Supabase` : null,
      });
    } catch (err) {
      return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 409 });
    }
  }

  if (mode === "local") {
    writeStorageConfig({ mode: "local", remembered: supabaseDetails(current) ?? undefined });
    const result = await reconnect();
    reconnectBlobStorage();
    return Response.json(result);
  }

  if (mode === "supabase") {
    // Blank means "the one already saved" — including one remembered from
    // before switching to local.
    const saved = supabaseDetails(resolveStorageConfig());
    const connectionString =
      (typeof body?.connectionString === "string" ? body.connectionString.trim() : "") || saved?.connectionString || "";
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
    const existingStorageServiceKey = saved?.storageServiceKey;

    const storageUrl = typeof body?.storageUrl === "string" ? body.storageUrl.trim() : "";
    const storageServiceKeyInput =
      typeof body?.storageServiceKey === "string" ? body.storageServiceKey.trim() : "";
    const storageBucket = typeof body?.storageBucket === "string" ? body.storageBucket.trim() : "";
    writeStorageConfig({
      mode: "supabase",
      sync: existing.mode === "supabase" ? existing.sync : undefined,
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
