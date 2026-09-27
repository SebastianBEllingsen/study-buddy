import { isBlobUrlReferenced, isImageUrlReferenced } from "@/lib/models";
import { mapWithConcurrency } from "@/lib/concurrency";
import { blobKeyFromUrl, removeBlobByUrl } from "./index";
import { blobUrlsIn } from "./urls";

export { blobUrlsIn };

// Called after an image field is replaced or cleared (or a library entry is
// deleted, with newUrl left undefined) — removes the blob oldUrl pointed
// at, but only once nothing else references that exact URL anymore (see
// isImageUrlReferenced's comment for why the same URL can be shared across
// a course, the app's branding, and a library row). Skips the DB check
// entirely when oldUrl isn't one of this app's own blob URLs in the first
// place (a data: URL, or unset) — nothing to remove either way.
export async function cleanupReplacedImage(
  oldUrl: string | null | undefined,
  newUrl?: string | null
): Promise<void> {
  if (!oldUrl || oldUrl === newUrl) return;
  if (!blobKeyFromUrl(oldUrl)) return;
  if (await isImageUrlReferenced(oldUrl)) return;
  await removeBlobByUrl(oldUrl);
}

// After deleting something (a course, a deck, an exam attempt): removes the
// media files it used, except any still referenced elsewhere. Best-effort —
// a failure just leaves a file behind, never fails the delete.
export async function removeUnreferencedBlobs(texts: string[]): Promise<void> {
  const urls = [...new Set(texts.flatMap(blobUrlsIn))];
  await mapWithConcurrency(urls, 4, async (url) => {
    try {
      if (!(await isBlobUrlReferenced(url))) await removeBlobByUrl(url);
    } catch (err) {
      console.error("Couldn't clean up a media file:", err);
    }
  });
}
