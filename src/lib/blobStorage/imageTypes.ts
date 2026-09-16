// Shared by src/app/api/blobs/route.ts and
// .../storage-settings/migrate-images/route.ts — kept as a Map, not a plain
// object literal: a plain object is vulnerable to prototype-chain lookups
// ("__proto__" in obj is true, obj["__proto__"] returns Object.prototype
// rather than undefined), which would let a crafted mimetype silently
// bypass whatever this is gating. A Map has no such prototype chain to
// exploit — get()/has() only ever see keys actually set on it.
//
// No SVG: the app never produces one (canvas.toBlob/toDataURL calls
// throughout this codebase only ever emit image/png or image/jpeg), so
// accepting it here would be pure attack surface — an SVG can embed
// <script>, and a locally-stored blob is served from /api/blobs/... under
// this app's own origin (unlike a data: URL, which gets an opaque origin),
// so an embedded script would run with the app's own privileges if that URL
// were ever opened directly.
export const IMAGE_EXTENSION_BY_MIME = new Map<string, string>([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);
