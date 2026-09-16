import { getAppSettings } from "@/lib/models";

// The custom favicon (Settings → Appearance → App icon) — a dynamic route
// rather than Next's static app/icon.* convention, since the icon itself
// lives in the database (uploaded image or emoji), not on disk. Referenced
// via generateMetadata's `icons` field in layout.tsx.
function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function emojiFaviconSvg(emoji: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="72" font-size="72" text-anchor="middle">${escapeXml(emoji)}</text></svg>`;
}

export async function GET(request: Request) {
  const settings = await getAppSettings();

  if (settings.appIconImage) {
    const match = settings.appIconImage.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const [, contentType, base64] = match;
      return new Response(Buffer.from(base64, "base64"), {
        headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=300" },
      });
    }
    // A real URL (local /api/blobs/... or a Supabase Storage public URL,
    // see src/lib/blobStorage) rather than an inline data URL — hand the
    // browser straight to it instead of proxying the bytes ourselves.
    // Response.redirect() requires an absolute URL and throws on the
    // relative /api/blobs/... form local storage returns — resolve it
    // against this request's own URL first (a no-op for the already-
    // absolute Supabase case).
    return Response.redirect(new URL(settings.appIconImage, request.url), 307);
  }

  if (settings.appIcon) {
    return new Response(emojiFaviconSvg(settings.appIcon), {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" },
    });
  }

  // No custom icon set — hand back to the static default rather than a 404,
  // so a browser that already resolved this URL via metadata.icons still
  // gets a real favicon instead of a broken-image icon.
  return Response.redirect(new URL("/favicon.ico", request.url), 307);
}
