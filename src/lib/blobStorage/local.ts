import fs from "node:fs/promises";
import path from "node:path";
import type { BlobStore } from "./types";

// Mirrors src/lib/uploads.ts's data/uploads/ layout for documents — a
// sibling data/blobs/ directory, served back out through
// src/app/api/blobs/[...key]/route.ts since it isn't under public/.
const blobsDir = path.join(process.cwd(), "data", "blobs");

export const localBlobStore: BlobStore = {
  async put(key, bytes) {
    const filePath = path.join(blobsDir, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    return { url: `/api/blobs/${key}` };
  },

  async remove(key) {
    const filePath = path.join(blobsDir, key);
    await fs.rm(filePath, { force: true });
  },
};
