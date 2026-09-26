import { getCourse } from "@/lib/models";
import { loadCourseKnowledge } from "@/lib/review/knowledge";
import { countUntagged } from "@/lib/review/tagConcepts";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

// Per-concept recall for a course (lib/review/knowledgeSummary.ts), plus
// how many sets still have untagged cards/questions.
export async function GET(_request: Request, { params }: Params) {
  const courseId = parseId((await params).courseId);
  if (courseId === null) return Response.json({ error: "Course not found" }, { status: 404 });
  try {
    const course = await getCourse(courseId);
    if (!course) return Response.json({ error: "Course not found" }, { status: 404 });
    const [knowledge, untagged] = await Promise.all([loadCourseKnowledge(courseId), countUntagged(courseId)]);
    return Response.json({ course: { id: course.id, name: course.name }, ...knowledge, untaggedSets: untagged.items });
  } catch (err) {
    console.error("Loading course knowledge failed:", err);
    return Response.json({ error: "Couldn't load this course's concepts" }, { status: 500 });
  }
}
