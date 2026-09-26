import { getCourse } from "@/lib/models";
import { isIsoDate } from "@/lib/studyPlan/options";
import { loadReadiness, setExamDate } from "@/lib/readiness/load";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ courseId: string }> };

// The readiness forecast for the course's exam (lib/readiness/).
export async function GET(_request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const course = await getCourse(courseId);
  if (!course) return Response.json({ error: "Course not found" }, { status: 404 });
  try {
    return Response.json({ course: { id: course.id, name: course.name }, ...(await loadReadiness(courseId)) });
  } catch (err) {
    console.error("Loading readiness failed:", err);
    return Response.json({ error: "Couldn't load the forecast" }, { status: 500 });
  }
}

// Sets (or clears, with null) the exam date. Body: { examDate: "YYYY-MM-DD" | null }.
export async function PUT(request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null || !(await getCourse(courseId))) return Response.json({ error: "Course not found" }, { status: 404 });
  const { examDate } = await parseJsonObjectBody(request);
  if (examDate !== null && !isIsoDate(examDate)) {
    return Response.json({ error: "examDate must be YYYY-MM-DD or null" }, { status: 400 });
  }
  await setExamDate(courseId, examDate as string | null);
  return Response.json({ ok: true });
}
