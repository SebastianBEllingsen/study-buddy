import fs from "node:fs/promises";
import path from "node:path";
import type { BlobStore } from "./types";

// Mirrors src/lib/uploads.ts's data/uploads/ layout for documents — a
// sibling data/blobs/ directory, served back out through
// src/app/api/blobs/[...key]/route.ts since it isn't under public/.
const blobsDir = path.join(process.cwd(), "data", "blobs");

// put()'s key is always server-generated (see /api/blobs's POST), but
// remove()'s key can come from blobKeyFromUrl() on a URL stored in a DB
// field the client controls (e.g. cover_image) — see index.ts's
// blobKeyFromUrl and its callers. Without this check, a crafted stored URL
// like "/api/blobs/../../../../some/file" would resolve outside blobsDir
// and reach fs.rm on an arbitrary path once that field gets replaced or
// cleaned up. Mirrors the same containment check the GET route already has.
function resolveBlobPath(key: string): string {
  if (!key) throw new Error("Invalid blob key");
  const filePath = path.join(blobsDir, key);
  if (!filePath.startsWith(blobsDir + path.sep)) throw new Error("Invalid blob key");
  return filePath;
}

export const localBlobStore: BlobStore = {
  async put(key, bytes) {
    const filePath = resolveBlobPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    return { url: `/api/blobs/${key}` };
  },

  async remove(key) {
    const filePath = resolveBlobPath(key);
    await fs.rm(filePath, { force: true });
  },
};
