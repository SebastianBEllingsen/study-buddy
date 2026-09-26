import { loadToday } from "@/lib/today/loadToday";
import { parseQueueParams } from "@/lib/review/queueParams";

const MAX_MINUTES = 480;

// Today's autopilot session: ?courseId= narrows it to one course,
// ?minutes= sets its length (default from the study plan's schedule).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { courseId, dayStart } = parseQueueParams(url);
  const raw = Number(url.searchParams.get("minutes"));
  const minutes = Number.isInteger(raw) && raw > 0 ? Math.min(raw, MAX_MINUTES) : undefined;
  try {
    return Response.json(await loadToday({ courseId, minutes, dayStart }));
  } catch (err) {
    console.error("Planning today's session failed:", err);
    return Response.json({ error: "Couldn't plan today's session" }, { status: 500 });
  }
}
