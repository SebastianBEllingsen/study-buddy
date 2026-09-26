import { blobKeyFromUrl } from "../blobStorage";
import { readLocalBlob } from "../blobStorage/local";
import type { GenerateTextImage } from "../aiBackends/types";

// Photos of handwritten answers, uploaded through /api/blobs as kind
// "answer": stored as a blob URL (local /api/blobs/… or a Supabase Storage
// public URL) or, without a blob store, a data URL. Only those shapes are
// accepted on an attempt, and only those are read back for grading.

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const SUPABASE_PUBLIC = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//;
export const MAX_IMAGES_PER_ANSWER = 6;
const MAX_IMAGE_BYTES = 10_000_000;

export function isAnswerImageUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 15_000_000) return false;
  if (DATA_URL.test(url)) return true;
  const key = blobKeyFromUrl(url);
  return !!key && key.startsWith("answer/") && !key.includes("..");
}

function mimeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
}

// The image's bytes for the grader, or null when it can't be read.
export async function loadAnswerImage(url: string): Promise<GenerateTextImage | null> {
  if (!isAnswerImageUrl(url)) return null;
  const data = url.match(DATA_URL);
  if (data) return { mimeType: data[1], base64: data[2] };
  const key = blobKeyFromUrl(url) as string;
  if (url.startsWith("/api/blobs/")) {
    const bytes = await readLocalBlob(key);
    return bytes ? { mimeType: mimeFromKey(key), base64: bytes.toString("base64") } : null;
  }
  if (!SUPABASE_PUBLIC.test(url)) return null;
  try {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    const type = res.headers.get("content-type")?.split(";")[0] ?? mimeFromKey(key);
    return { mimeType: type.startsWith("image/") ? type : mimeFromKey(key), base64: bytes.toString("base64") };
  } catch {
    return null;
  }
}
