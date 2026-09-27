import path from "node:path";
import { readBlob } from "@/lib/blobStorage";

// Serves every stored file by key: from data/blobs/ (see
// src/lib/blobStorage/local.ts), which isn't under public/, or — for files
// kept in Supabase Storage — downloaded once and cached there. Older
// Supabase-mode rows may still hold the bucket's public URL directly
// (Settings → Storage → Move files rewrites them to this route).
const blobsDir = path.join(process.cwd(), "data", "blobs");

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  // Audio/video bundled with imported Anki decks (see lib/anki/importDeck.ts).
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};

type Params = { params: Promise<{ key: string[] }> };

export async function GET(_request: Request, { params }: Params) {
  const { key } = await params;
  // Keys are always server-generated (kind/uuid.ext — see /api/blobs's
  // POST), but the URL segments here come straight from the request path,
  // so reject anything that could climb out of blobsDir before it ever
  // reaches the filesystem.
  if (key.length === 0 || key.some((segment) => segment === ".." || segment.includes("/"))) {
    return new Response(null, { status: 400 });
  }
  const filePath = path.join(blobsDir, ...key);
  if (!filePath.startsWith(blobsDir + path.sep)) {
    return new Response(null, { status: 400 });
  }

  try {
    // This computer's copy, or — for files kept in Supabase Storage — a
    // one-time download that's cached for next time (and for offline).
    const bytes = await readBlob(key.join("/"));
    if (!bytes) return new Response(null, { status: 404 });
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        // Filenames are UUID-based and never reused, so a cached copy is
        // always still correct — same reasoning as the document-file route.
        "Cache-Control": "public, max-age=31536000, immutable",
        // Blobs are media, never pages: an SVG (e.g. from an imported Anki
        // deck) opened directly in a tab must not be able to run script on
        // this app's origin, where it could call the whole API.
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
