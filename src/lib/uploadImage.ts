"use client";

// Keep in sync with the `kind` keys in src/app/api/blobs/route.ts.
export type ImageUploadKind = "icon" | "cover" | "background" | "app-icon" | "dashboard-background" | "note";

// Uploads a freshly cropped/resized image and returns whatever's safe to
// store in a DB column and render directly — either a real blob-storage URL,
// or (when no blob store is configured, see src/lib/blobStorage) a data:
// URL, exactly what every image field already accepted before this existed.
// Callers never need to know which one they got back: isValidCoverImage/
// isValidIconImage/etc. (src/lib/dataUrlImage.ts) and every render site
// accept both shapes.
export async function uploadImage(blob: Blob, kind: ImageUploadKind): Promise<string> {
  const formData = new FormData();
  formData.append("kind", kind);
  formData.append("file", blob);
  const res = await fetch("/api/blobs", { method: "POST", body: formData });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ImageUploadError(body.error ?? "Upload failed");
  return body.url ?? body.dataUrl;
}

// A rejection /api/blobs explained itself (e.g. "Image is too large (max
// 8 MB)") — worth showing as-is, unlike a network failure or a crash,
// where callers' own generic message reads better than whatever the
// browser's error says.
export class ImageUploadError extends Error {}

export function describeUploadError(err: unknown, fallback: string): string {
  return err instanceof ImageUploadError ? err.message : fallback;
}

// Whether "Full-resolution uploads" is on, read fresh from the server —
// deliberately not from SWR's cached /api/settings, which can be stale
// (e.g. toggled in another tab) and would otherwise send a full-size encode
// the server then rejects, or needlessly shrink one it would accept.
export async function fetchUnlimitedUploads(): Promise<boolean> {
  try {
    const res = await fetch("/api/settings");
    return res.ok ? !!(await res.json()).unlimitedUploads : false;
  } catch {
    return false;
  }
}
