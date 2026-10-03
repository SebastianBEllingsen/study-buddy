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

// DNS rebinding guard: a web page can point its own hostname at 127.0.0.1
// after the page has loaded, and then its requests to this app look
// same-origin to the browser — so the check above lets them through. What
// still gives them away is the Host header, which carries their hostname.
// Only the machine's own names are accepted; STUDY_BUDDY_ALLOWED_HOSTS
// (comma-separated hostnames) adds others, for someone who reaches the app
// through a name of their own.
const OWN_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostnameOf(host: string): string {
  // "[::1]:3000" / "localhost:3000" / "localhost" → the name without the port.
  const end = host.startsWith("[") ? host.indexOf("]") + 1 : host.indexOf(":");
  return (end > 0 ? host.slice(0, end) : host).toLowerCase();
}

export function isUntrustedHost(
  headers: { get(name: string): string | null },
  extraHosts: string | undefined = undefined,
): boolean {
  const host = headers.get("host");
  // No Host header: not a browser (HTTP/1.1 clients always send one).
  if (!host) return false;
  const name = hostnameOf(host);
  if (OWN_HOSTS.has(name) || name.endsWith(".localhost")) return false;
  const extra = (extraHosts ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return !extra.includes(name);
}
