import { listMistakes, type MistakeStatus } from "@/lib/review/mistakes";

const STATUSES: MistakeStatus[] = ["open", "resolved", "all"];

// The mistake log, newest first. ?courseId= narrows to one course;
// ?status=open|resolved|all (default open).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawCourse = url.searchParams.get("courseId");
  const courseId = rawCourse !== null && /^\d+$/.test(rawCourse) ? Number(rawCourse) : null;
  const rawStatus = url.searchParams.get("status") ?? "open";
  if (!STATUSES.includes(rawStatus as MistakeStatus)) {
    return Response.json({ error: "status must be open, resolved or all" }, { status: 400 });
  }
  try {
    return Response.json({ mistakes: await listMistakes({ courseId, status: rawStatus as MistakeStatus }) });
  } catch (err) {
    console.error("Listing mistakes failed:", err);
    return Response.json({ error: "Couldn't load your mistakes" }, { status: 500 });
  }
}
