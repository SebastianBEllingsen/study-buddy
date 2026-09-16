import { isImageUrlReferenced } from "@/lib/models";
import { blobKeyFromUrl, removeBlobByUrl } from "./index";

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
