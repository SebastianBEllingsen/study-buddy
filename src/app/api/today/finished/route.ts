import { getDayTotals, parseFinishedDate, parseFinishedSession, recordFinishedToday } from "@/lib/today/finished";
import { parseJsonObjectBody } from "@/lib/requestBody";

// The day's finished Today sessions (see lib/today/finished.ts):
// GET ?date=YYYY-MM-DD reads the totals, POST records one more.
export async function GET(request: Request) {
  const date = parseFinishedDate(new URL(request.url).searchParams.get("date"));
  if (!date) return Response.json({ error: "Invalid date" }, { status: 400 });
  try {
    return Response.json({ totals: await getDayTotals(date) });
  } catch (err) {
    console.error("Reading finished Today sessions failed:", err);
    return Response.json({ error: "Couldn't load today's sessions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const finished = parseFinishedSession(await parseJsonObjectBody(request));
  if (!finished) return Response.json({ error: "Invalid session" }, { status: 400 });
  try {
    await recordFinishedToday(finished);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Recording a finished Today session failed:", err);
    return Response.json({ error: "Couldn't save that session" }, { status: 500 });
  }
}
