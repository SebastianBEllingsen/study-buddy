// External (http/https) links are opened by the server in the system's
// default browser instead of by the page itself. Study Buddy usually runs
// in a kiosk window with its own Brave profile (see the studybuddy-kiosk
// launcher), so a plain target="_blank"/window.open lands in a fresh window
// of that isolated browser process rather than as a tab in the browser the
// user actually browses with. `xdg-open` hands the URL to the default
// browser, which opens it as a tab in its most recently focused window.

export function isExternalHttpUrl(href: string, currentOrigin?: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return currentOrigin === undefined || url.origin !== currentOrigin;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// Only a page served from this machine may ask the server to launch a
// browser — this rejects both LAN clients (non-local Host) and other
// websites trying a cross-site POST to localhost (foreign Origin).
export function isLocalSameOriginRequest(host: string | null, origin: string | null): boolean {
  if (!host || !origin) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  return originUrl.host === host && LOCAL_HOSTNAMES.has(originUrl.hostname);
}

// Client side: ask the server to open `url`, falling back to a normal new
// tab if that isn't possible (e.g. the app is being accessed remotely).
export async function openExternal(url: string): Promise<void> {
  try {
    const res = await fetch("/api/open-external", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (res.ok) return;
  } catch {
    // fall through to the in-browser fallback
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
