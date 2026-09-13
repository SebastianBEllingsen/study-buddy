import { resolveStorageConfig, writeStorageConfig } from "@/lib/db/config";
import { lastConnectionError, reconnect } from "@/lib/db";

export async function GET() {
  const config = resolveStorageConfig();
  return Response.json({
    mode: config.mode,
    hasConnectionString: config.mode === "supabase" && !!config.connectionString,
    connectionError: lastConnectionError,
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
    writeStorageConfig({ mode: "supabase", connectionString });
    const result = await reconnect();
    return Response.json(result);
  }

  return Response.json({ error: "mode must be 'local' or 'supabase'" }, { status: 400 });
}
