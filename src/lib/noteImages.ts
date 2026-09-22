"use client";

import { resizeImageForNote } from "@/lib/resizeImage";
import { uploadImage } from "@/lib/uploadImage";

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

// Resizes (transparency preserved — see resizeImageForNote), uploads, and
// records `file` as a "note"-kind library image, returning the new row's id
// — what a studybuddy-image:<id> embed or a canvas "image:<id>" card points
// at. Primes the cache so the picture renders immediately, no round trip.
export async function uploadNoteImage(file: File): Promise<number> {
  const blob = await resizeImageForNote(file);
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
