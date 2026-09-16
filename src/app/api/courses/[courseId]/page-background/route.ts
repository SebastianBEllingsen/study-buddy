import { getCoursePageBackground } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string }> };

// The one field the dashboard's course list deliberately leaves out (see
// listCourseSummaries) — fetched here on demand, only while
// CustomizeCourseDialog is actually open, so opening it doesn't need to
// pull a course's full page (folders/documents/items/notes) just to seed
// one image field.
export async function GET(_request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const pageBackgroundImage = await getCoursePageBackground(id);
  if (pageBackgroundImage === undefined) {
    return Response.json({ error: "Course not found" }, { status: 404 });
  }
  return Response.json({ pageBackgroundImage });
}
