import { loadInsights } from "@/lib/insights/load";

// Calibration and the weekly review; ?courseId= narrows to one course.
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("courseId");
  const courseId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  try {
    return Response.json(await loadInsights(courseId));
  } catch (err) {
    console.error("Loading insights failed:", err);
    return Response.json({ error: "Couldn't load your insights" }, { status: 500 });
  }
}
