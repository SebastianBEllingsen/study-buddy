import crypto from "node:crypto";
import { blobStore } from "@/lib/blobStorage";
import { IMAGE_EXTENSION_BY_MIME } from "@/lib/blobStorage/imageTypes";
import { getAppSettings } from "@/lib/models";
import { formatMegabytes, isUploadKind, UPLOAD_LIMITS } from "@/lib/uploadLimits";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) return Response.json({ error: "Invalid upload" }, { status: 400 });

  const file = formData.get("file");
  const kind = formData.get("kind");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!isUploadKind(kind)) {
    return Response.json({ error: "Invalid kind" }, { status: 400 });
  }
  const extension = IMAGE_EXTENSION_BY_MIME.get(file.type);
  if (!extension) {
    return Response.json({ error: "Unsupported image type" }, { status: 400 });
  }
  // Per-kind raw-byte caps (see lib/uploadLimits.ts) — a real byte count
  // is the honest check for an actual file, unlike the base64-length caps
  // in lib/dataUrlImage.ts. Skipped entirely with "Full-resolution uploads"
  // on (AppSettings.unlimitedUploads).
  const limit = UPLOAD_LIMITS.get(kind)!;
  const { unlimitedUploads } = await getAppSettings();
  if (!unlimitedUploads && file.size > limit) {
    // Says the actual cap — animated images are the uploads most likely to
    // hit it (the client normally compresses those to fit first).
    return Response.json({ error: `Image is too large (max ${formatMegabytes(limit)})` }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  if (blobStore) {
    const key = `${kind}/${crypto.randomUUID()}${extension}`;
    const result = await blobStore.put(key, bytes, file.type);
    if (result) return Response.json({ url: result.url });
  }

  // No blob store configured (or the upload failed) — fall back to a plain
  // data URL, exactly what every image field accepted before this feature
  // existed. isValidCoverImage/isValidIconImage/etc. (src/lib/dataUrlImage.ts)
  // still accept this shape alongside a real URL. Only for files within the
  // normal cap, though: past it (possible with limits switched off), a
  // failed store means the file really didn't fit anywhere — most often a
  // storage provider's own per-file limit (Supabase's bucket setting) —
  // and inlining it would put megabytes of base64 into a database row.
  if (file.size > limit) {
    return Response.json(
      {
        error: blobStore
          ? "Storage rejected that file — your storage provider may have its own per-file size limit"
          : "No file storage is configured for a file this large",
      },
      { status: 502 }
    );
  }
  return Response.json({ dataUrl: `data:${file.type};base64,${bytes.toString("base64")}` });
}
