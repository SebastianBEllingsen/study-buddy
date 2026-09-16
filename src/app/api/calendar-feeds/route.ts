import { addCalendarFeed, listCalendarFeeds } from "@/lib/models";
import { isSafeExternalUrl } from "@/lib/urlSafety";

export async function GET() {
  const feeds = await listCalendarFeeds();
  return Response.json({ feeds });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";

  if (!label) return Response.json({ error: "Label is required" }, { status: 400 });
  if (!/^https?:\/\//i.test(url)) {
    return Response.json({ error: "Enter a valid feed URL" }, { status: 400 });
  }
  // Rejects loopback/private/link-local targets (see urlSafety.ts) — this
  // server fetches every configured feed's URL on every calendar load, so
  // an unrestricted URL here would let it be pointed at internal services.
  if (!(await isSafeExternalUrl(url))) {
    return Response.json({ error: "That URL isn't reachable as an external feed" }, { status: 400 });
  }

  const feed = await addCalendarFeed(label, url);
  return Response.json({ feed }, { status: 201 });
}
