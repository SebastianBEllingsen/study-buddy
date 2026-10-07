import { isCurriculumId } from "@/lib/curriculum/chapters";
import { installCurriculum } from "@/lib/curriculum/install";
import { parseJsonObjectBody } from "@/lib/requestBody";

// Installs a built-in curriculum as a course with a ready-made study plan.
// Body: { id: "programming" }. Installing again returns the existing course.
export async function POST(request: Request) {
  const body = await parseJsonObjectBody(request);
  if (!isCurriculumId(body.id)) return Response.json({ error: "Unknown curriculum" }, { status: 400 });
  try {
    const result = await installCurriculum(body.id);
    return Response.json(result, { status: result.alreadyInstalled ? 200 : 201 });
  } catch (err) {
    console.error("Installing curriculum failed:", err);
    return Response.json({ error: "Couldn't set up the course" }, { status: 500 });
  }
}
