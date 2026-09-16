import crypto from "node:crypto";
import { blobStore } from "@/lib/blobStorage";
import { IMAGE_EXTENSION_BY_MIME } from "@/lib/blobStorage/imageTypes";

// Per-kind raw-byte caps, replacing the base64-char-length caps in
// src/lib/dataUrlImage.ts for anything that goes through this upload path —
// those still gate the data-URL fallback response below, but a real byte
// count is the more honest check for an actual file. A Map, not a plain
// object — see imageTypes.ts's comment on why a plain object's prototype
// chain ("__proto__" in obj) is a real bypass here, not just theoretical.
const KIND_LIMITS = new Map<string, number>([
  ["icon", 3_000_000],
  ["cover", 4_000_000],
  ["background", 8_000_000],
  ["app-icon", 3_000_000],
  ["dashboard-background", 8_000_000],
  ["note", 8_000_000],
]);

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) return Response.json({ error: "Invalid upload" }, { status: 400 });

  const file = formData.get("file");
  const kind = formData.get("kind");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (typeof kind !== "string" || !KIND_LIMITS.has(kind)) {
    return Response.json({ error: "Invalid kind" }, { status: 400 });
  }
  const extension = IMAGE_EXTENSION_BY_MIME.get(file.type);
  if (!extension) {
    return Response.json({ error: "Unsupported image type" }, { status: 400 });
  }
  if (file.size > KIND_LIMITS.get(kind)!) {
    return Response.json({ error: "Image is too large" }, { status: 400 });
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
  // still accept this shape alongside a real URL.
  return Response.json({ dataUrl: `data:${file.type};base64,${bytes.toString("base64")}` });
}
