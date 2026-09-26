import { loadFocusQueue, loadReviewQueue } from "@/lib/review/queue";
import { parseQueueParams } from "@/lib/review/queueParams";

// The review session's queue — see lib/review/queueBuild.ts.
export async function GET(request: Request) {
  try {
    const { courseId, dayStart, limit, mode, concept } = parseQueueParams(new URL(request.url));
    if (mode !== "due") {
      return Response.json(await loadFocusQueue({ mode, courseId, concept: concept ?? undefined, limit }));
    }
    return Response.json(await loadReviewQueue({ courseId, dayStart, limit }));
  } catch (err) {
    console.error("Loading the review queue failed:", err);
    return Response.json({ error: "Couldn't load your reviews" }, { status: 500 });
  }
}
