// Cross-site request forgery guard for the API (see src/proxy.ts). The app
// has no login — anything that can reach it can use it — so a web page on
// another site must not be able to make the browser send it a write
// (a POST with a text/plain body needs no CORS preflight, and every route
// parses JSON regardless of Content-Type).

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isCrossSiteWrite(
  method: string,
  headers: { get(name: string): string | null },
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;

  // Modern browsers label every request with where it came from.
  // "same-site" still means another origin (e.g. a different localhost
  // port), so only "same-origin" and "none" (typed/bookmarked by the user)
  // pass.
  const site = headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";

  // Older browsers: fall back to Origin, which they send on cross-origin
  // writes.
  const origin = headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host !== headers.get("host");
    } catch {
      return true;
    }
  }

  // Neither header: not a browser (curl, scripts) — nothing to forge.
  return false;
}
