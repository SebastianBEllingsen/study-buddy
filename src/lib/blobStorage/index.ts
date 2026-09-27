import { resolveStorageConfig } from "@/lib/db/config";
import { localBlobStore, readLocalBlob, removeLocalBlobCache, writeLocalBlobCache } from "./local";
import { createSupabaseBlobStore } from "./supabase";
import type { BlobStore } from "./types";
import { blobKeyFromUrl } from "./urls";

export type { BlobStore } from "./types";
export { blobKeyFromUrl } from "./urls";

// null specifically means "Supabase DB mode is active but Storage hasn't
// been configured yet (or configuring it failed)" — NOT "fall back to local
// disk". Falling back to local disk here would be actively wrong: the DB
// row would end up holding a /api/blobs/... URL that only resolves on this
// one machine, which breaks the moment the app is opened from another
// device or redeployed. Callers (src/app/api/blobs/route.ts) treat null as
// "inline a base64 data URL instead" — today's existing behavior — which
// travels with the row exactly like it always has.
function resolve(): BlobStore | null {
  const config = resolveStorageConfig();
  if (config.mode === "local") return localBlobStore;
  return createSupabaseBlobStore(config);
}

// Same live-binding + reconnect() shape as src/lib/db/index.ts, so a
// Storage settings save can swap this in place without a restart. `let`,
// not `const` — see that file's comment on why live bindings matter here.
export let blobStore: BlobStore | null = resolve();

export function reconnectBlobStorage(): void {
  blobStore = resolve();
}

// Matches any Supabase Storage public-object URL shape, not just one from
// the *currently configured* project/bucket — see blobKeyFromUrl's own
// comment for why this needs to stay config-independent.
// Best-effort — see supabase.ts's own remove() for why a failure here never
// throws. Silently does nothing for a URL blobKeyFromUrl doesn't recognize
// or when no store is currently configured.
// A blob's bytes by key: this computer's copy if it has one, else fetched
// from the store (Supabase Storage) and kept for next time.
export async function readBlob(key: string): Promise<Buffer | null> {
  const local = await readLocalBlob(key);
  if (local) return local;
  if (!blobStore || blobStore.kind === "local") return null;
  const bytes = await blobStore.get(key);
  if (bytes) await writeLocalBlobCache(key, bytes).catch(() => {});
  return bytes;
}

export async function removeBlobByUrl(url: string): Promise<void> {
  const key = blobKeyFromUrl(url);
  if (key) await removeLocalBlobCache(key);
  if (!key || !blobStore) return;
  try {
    await blobStore.remove(key);
  } catch {
    // best-effort cleanup — never block the caller's actual write over this
  }
}
