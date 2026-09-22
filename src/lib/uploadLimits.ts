import type { ImageUploadKind } from "@/lib/uploadImage";

// Per-kind raw-byte caps for /api/blobs uploads — shared by that route
// (which enforces them) and the client (which compresses an oversized
// animation to fit before uploading, see lib/animationEncoder.ts), so the
// two can never disagree about what fits. A Map, not a plain object — see
// blobStorage/imageTypes.ts's comment on why a plain object's prototype
// chain ("__proto__" in obj) is a real bypass here, not just theoretical.
//
// Lifted entirely when Settings → Storage → "Full-resolution uploads" is on
// (AppSettings.unlimitedUploads).
export const UPLOAD_LIMITS = new Map<ImageUploadKind, number>([
  ["icon", 3_000_000],
  ["cover", 4_000_000],
  ["background", 8_000_000],
  ["app-icon", 3_000_000],
  ["dashboard-background", 8_000_000],
  ["note", 8_000_000],
]);

export function isUploadKind(value: unknown): value is ImageUploadKind {
  return typeof value === "string" && UPLOAD_LIMITS.has(value as ImageUploadKind);
}

// The byte budget an upload of this kind has to fit — Infinity when limits
// are switched off.
export function uploadLimitBytes(kind: ImageUploadKind, unlimited: boolean): number {
  return unlimited ? Infinity : UPLOAD_LIMITS.get(kind)!;
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / 1_000_000) * 10) / 10} MB`;
}
