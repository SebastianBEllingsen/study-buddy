// External (http/https) links are opened by the server in the system's
// default browser instead of by the page itself. When the app runs in its
// own app/kiosk-style browser window (a separate profile), a plain
// target="_blank"/window.open would open a new window of that isolated
// browser instead of a tab in the browser the user normally uses. The
// system's default-browser handler (see browserOpenCommand) opens it as a
// tab in that browser's most recently focused window.

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

// The command that opens `url` in the default browser on each platform.
// None of them go through a shell, so the URL is never interpreted as a
// command line (e.g. an "&" in a query string on Windows).
export function browserOpenCommand(platform: string, url: string): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "explorer.exe", args: [url] };
  return { command: "xdg-open", args: [url] };
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
