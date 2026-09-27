// Recognizing this app's own blob URLs — kept free of any storage or
// database imports so anything (tests, the backup code) can use it.

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

// Every one of this app's own blob URLs mentioned in `text` (a JSON column
// or markdown) — e.g. imported Anki media inside a deck's content.
export function blobUrlsIn(text: string): string[] {
  const found = new Set<string>();
  for (const [url] of text.matchAll(/(?:\/api\/blobs\/|https?:\/\/)[^\s"'()<>\\]+/g)) {
    if (blobKeyFromUrl(url)) found.add(url);
  }
  return [...found];
}
