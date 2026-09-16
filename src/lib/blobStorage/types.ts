// A blob store just needs to accept bytes under a key and hand back a URL
// those bytes are fetchable from — see src/lib/blobStorage/index.ts for how
// the local (data/blobs/) vs Supabase Storage implementation is chosen.
export interface BlobStore {
  // Returns null (rather than throwing) when the store can't actually take
  // the upload right now — e.g. Supabase Storage credentials configured but
  // the request failed. Callers (see src/app/api/blobs/route.ts) treat null
  // as "fall back to inlining a base64 data URL," never as a hard failure.
  put(key: string, bytes: Buffer, contentType: string): Promise<{ url: string } | null>;
  remove(key: string): Promise<void>;
}
