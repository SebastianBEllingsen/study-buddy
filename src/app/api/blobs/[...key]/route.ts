import fs from "node:fs/promises";
import path from "node:path";

// Serves what src/lib/blobStorage/local.ts writes under data/blobs/ — that
// directory isn't under public/, so local-mode blob URLs (/api/blobs/...)
// need a route to actually resolve. Supabase-mode URLs point straight at
// the Storage bucket's own public endpoint and never hit this route.
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
    const bytes = await fs.readFile(filePath);
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        // Filenames are UUID-based and never reused, so a cached copy is
        // always still correct — same reasoning as the document-file route.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
