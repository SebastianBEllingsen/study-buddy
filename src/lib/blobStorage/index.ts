import { resolveStorageConfig } from "@/lib/db/config";
import { localBlobStore } from "./local";
import { createSupabaseBlobStore } from "./supabase";
import type { BlobStore } from "./types";

export type { BlobStore } from "./types";

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

// Recovers the key put() originally returned a URL for, from either URL
// shape blobStore.put() can hand back — the local route's own
// /api/blobs/<key> (checked against the fixed prefix, works regardless of
// current mode/config) or a Supabase Storage public URL (checked against
// the *currently configured* storageUrl/storageBucket, so a URL from a
// previously-configured bucket correctly stops matching if that config
// later changes). Returns null for anything else — a data: URL, or a URL
// this app didn't hand out itself — meaning "nothing to remove."
export function blobKeyFromUrl(url: string): string | null {
  if (url.startsWith("/api/blobs/")) return url.slice("/api/blobs/".length);
  const config = resolveStorageConfig();
  if (config.mode === "supabase" && config.storageUrl && config.storageBucket) {
    const prefix = `${config.storageUrl.replace(/\/$/, "")}/storage/v1/object/public/${config.storageBucket}/`;
    if (url.startsWith(prefix)) return url.slice(prefix.length);
  }
  return null;
}

// Best-effort — see supabase.ts's own remove() for why a failure here never
// throws. Silently does nothing for a URL blobKeyFromUrl doesn't recognize
// or when no store is currently configured.
export async function removeBlobByUrl(url: string): Promise<void> {
  const key = blobKeyFromUrl(url);
  if (!key || !blobStore) return;
  try {
    await blobStore.remove(key);
  } catch {
    // best-effort cleanup — never block the caller's actual write over this
  }
}
