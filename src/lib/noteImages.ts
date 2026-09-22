"use client";

import { resizeImageForNote } from "@/lib/resizeImage";
import { fetchUnlimitedUploads, uploadImage } from "@/lib/uploadImage";
import { isAnimatedImage } from "@/lib/animatedImage";
import { canEncodeAnimations, encodeAnimation } from "@/lib/animationEncoder";
import { uploadLimitBytes } from "@/lib/uploadLimits";
import { IMAGE_EXTENSION_BY_MIME } from "@/lib/blobStorage/imageTypes";

// Pictures pasted/dropped into a note (see NoteEditor's noteImagePasteDrop)
// or onto a canvas are uploaded once and referenced by this short pseudo-
// scheme plus their uploaded_images row id — never the raw data URL, which
// for a real photo/screenshot can run to hundreds of KB of base64 text.
// Obsidian's own approach for a pasted image is the same idea (a short
// wikilink to a saved file, not the image data inline); this is this app's
// equivalent, since there's no separate attachments folder to save a real
// file into — everything already lives in the uploaded_images table.
export const NOTE_IMAGE_SCHEME = "studybuddy-image:";

// Resolved data URLs are cached at module scope (not per-editor-instance)
// since the same image id can appear in more than one place across a
// session — a note's Preview and Edit mode, and any canvas card showing it,
// all render the same reference independently, and switching between them
// shouldn't mean re-fetching an image already seen once.
export const noteImageCache = new Map<number, string>();
const noteImageFetches = new Map<number, Promise<string>>();

export function fetchNoteImage(id: number): Promise<string> {
  const cached = noteImageCache.get(id);
  if (cached) return Promise.resolve(cached);
  const inFlight = noteImageFetches.get(id);
  if (inFlight) return inFlight;
  const promise = fetch(`/api/uploaded-images/${id}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((body: { image?: { url: string } } | null) => {
      const url = body?.image?.url ?? "";
      if (url) noteImageCache.set(id, url);
      noteImageFetches.delete(id);
      return url;
    });
  noteImageFetches.set(id, promise);
  return promise;
}

// Uploads and records `file` as a "note"-kind library image, returning the
// new row's id — what a studybuddy-image:<id> embed or a canvas
// "image:<id>" card points at. Primes the cache so the picture renders
// immediately, no round trip. What gets uploaded depends on the file:
//   - a still image is resized (transparency preserved — see
//     resizeImageForNote), as notes only ever display it that large;
//   - an animated one (GIF, animated WebP, APNG — see lib/animatedImage.ts)
//     can't go through that resize, which draws through a canvas and keeps
//     only the first frame. Within the upload cap it's stored exactly as
//     picked; over it, it's re-encoded smaller until it fits (see
//     lib/animationEncoder.ts) rather than rejected;
//   - with "Full-resolution uploads" on, every file is stored as picked.
export async function uploadNoteImage(file: File): Promise<number> {
  const blob = await prepareNoteImage(file);
  const url = await uploadImage(blob, "note");
  const res = await fetch("/api/uploaded-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "note", url }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? "Upload failed");
  noteImageCache.set(body.image.id, url);
  return body.image.id;
}

async function prepareNoteImage(file: File): Promise<Blob> {
  // Only formats /api/blobs actually stores can skip conversion — anything
  // else (a BMP, say) still goes through the resize, which converts it.
  if (IMAGE_EXTENSION_BY_MIME.has(file.type) && (await fetchUnlimitedUploads())) return file;
  const animated = isAnimatedImage(new Uint8Array(await file.arrayBuffer()), file.type);
  if (!animated) return resizeImageForNote(file);
  const limit = uploadLimitBytes("note", false);
  // Oversized and this browser can't re-encode animations: upload as-is
  // and let /api/blobs explain the size cap, rather than silently keeping
  // only the first frame.
  if (file.size <= limit || !canEncodeAnimations()) return file;
  return encodeAnimation(file, { maxBytes: limit });
}
