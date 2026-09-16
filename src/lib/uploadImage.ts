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
  if (!res.ok) throw new Error(body.error ?? "Upload failed");
  return body.url ?? body.dataUrl;
}
