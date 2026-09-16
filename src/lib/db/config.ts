import fs from "node:fs";
import path from "node:path";

export type StorageConfig =
  | { mode: "local" }
  | {
      mode: "supabase";
      connectionString: string;
      // Optional: where uploaded images go when this backend is active (see
      // src/lib/blobStorage). Left unset, blob uploads fall back to inlining
      // a base64 data URL straight into the DB column — today's behavior —
      // so an existing config saved before this feature existed keeps
      // working unchanged.
      storageUrl?: string;
      storageServiceKey?: string;
      storageBucket?: string;
    };

const configPath = path.join(process.cwd(), "data", "storage-config.json");

// Resolution order: DATABASE_URL env var (for power users / deployments) →
// data/storage-config.json (written by the Storage settings dialog) →
// default to local SQLite. Read once at module load, before any DB
// connects — storage mode can't live inside app_settings itself, since the
// app needs to know which database to open before it can query that row.
export function resolveStorageConfig(): StorageConfig {
  if (process.env.DATABASE_URL) {
    return {
      mode: "supabase",
      connectionString: process.env.DATABASE_URL,
      storageUrl: process.env.SUPABASE_STORAGE_URL,
      storageServiceKey: process.env.SUPABASE_STORAGE_SERVICE_KEY,
      storageBucket: process.env.SUPABASE_STORAGE_BUCKET,
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as StorageConfig;
    if (parsed.mode === "supabase" && parsed.connectionString) {
      return parsed;
    }
  } catch {
    // No config file yet, or it's malformed — fall back to local.
  }
  return { mode: "local" };
}

export function writeStorageConfig(config: StorageConfig): void {
  const dataDir = path.dirname(configPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
