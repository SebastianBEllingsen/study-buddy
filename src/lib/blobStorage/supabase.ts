import type { StorageConfig } from "@/lib/db/config";
import type { BlobStore } from "./types";

type SupabaseConfig = Extract<StorageConfig, { mode: "supabase" }>;

// Talks to the Supabase Storage REST API directly over fetch(), the same
// choice src/lib/db/postgres.ts already made for the database itself (a
// plain connection string over postgres-js, never the @supabase/supabase-js
// SDK) — no new dependency for a handful of HTTP calls. Docs:
// https://supabase.com/docs/guides/storage (REST reference under
// storage/v1/object).
export function createSupabaseBlobStore(config: SupabaseConfig): BlobStore | null {
  const { storageUrl, storageServiceKey, storageBucket } = config;
  if (!storageUrl || !storageServiceKey || !storageBucket) return null;

  const base = `${storageUrl.replace(/\/$/, "")}/storage/v1/object`;
  const authHeaders = {
    Authorization: `Bearer ${storageServiceKey}`,
    apikey: storageServiceKey,
  };

  return {
    async put(key, bytes, contentType) {
      try {
        const res = await fetch(`${base}/${storageBucket}/${key}`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": contentType, "x-upsert": "true" },
          body: new Uint8Array(bytes),
        });
        if (!res.ok) return null;
        // The bucket is public (no signed URLs) — this path is deterministic
        // and permanent, no follow-up API call needed to resolve it.
        return { url: `${base}/public/${storageBucket}/${key}` };
      } catch {
        return null;
      }
    },

    async remove(key) {
      try {
        await fetch(`${base}/${storageBucket}/${key}`, { method: "DELETE", headers: authHeaders });
      } catch {
        // Best-effort — an orphaned Storage object isn't worth failing the
        // caller's delete over (matches how deleteUploadedImage etc. in
        // lib/models.ts don't roll back on downstream cleanup failures).
      }
    },
  };
}
