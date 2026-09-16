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

// Matches any Supabase Storage public-object URL shape, not just one from
// the *currently configured* project/bucket — see blobKeyFromUrl's own
// comment for why this needs to stay config-independent.
const SUPABASE_PUBLIC_URL_PATTERN =
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/;

// Recovers the key put() originally returned a URL for, from either URL
// shape blobStore.put() can hand back — the local route's own
// /api/blobs/<key> (works regardless of current mode/config) or a Supabase
// Storage public URL. The Supabase case deliberately does NOT check against
// the *currently configured* storageUrl/storageBucket (an earlier version
// did): a course cover image saved while on Supabase stores that Storage
// URL permanently in the DB row, and switching storage mode back to local
// (or just renaming the bucket) doesn't change what's already stored there.
// Gating recognition on the live config meant every save of an unrelated
// field on that same row started failing image validation the moment the
// config changed, with no way to fix it short of re-uploading the image.
// Matching the general public-object URL shape instead keeps recognizing
// it as "one of this app's blobs" regardless of what's currently
// configured — this is only ever used for format validation and best-effort
// cleanup, never as an access-control boundary, so being bucket-agnostic
// here doesn't loosen anything security-relevant.
export function blobKeyFromUrl(url: string): string | null {
  if (url.startsWith("/api/blobs/")) {
    const key = url.slice("/api/blobs/".length);
    return key ? key : null;
  }
  const match = url.match(SUPABASE_PUBLIC_URL_PATTERN);
  if (match) return match[2] || null;
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
