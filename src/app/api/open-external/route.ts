import { spawn } from "node:child_process";
import { isExternalHttpUrl, isLocalSameOriginRequest } from "@/lib/externalLinks";

// Opens a link in the system's default browser — see src/lib/externalLinks.ts
// for why links don't just open from the page.
export async function POST(request: Request) {
  if (!isLocalSameOriginRequest(request.headers.get("host"), request.headers.get("origin"))) {
    return Response.json({ error: "Only available to the local app" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : "";
  if (!isExternalHttpUrl(url)) {
    return Response.json({ error: "Expected an http(s) URL" }, { status: 400 });
  }

  const opened = await new Promise<boolean>((resolve) => {
    const child = spawn("xdg-open", [url], { stdio: "ignore", detached: true });
    child.on("error", () => resolve(false));
    child.on("spawn", () => {
      child.unref();
      resolve(true);
    });
  });

  return opened
    ? Response.json({ ok: true })
    : Response.json({ error: "Couldn't launch the system browser" }, { status: 500 });
}
