import { createCanvas } from "@/lib/models";
import { sanitizeCanvasData } from "@/lib/canvas";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ courseId: string }> };

// `data` is optional — present when importing a .canvas file (see
// CourseCanvasSection), absent for a new, empty board.
export async function POST(request: Request, { params }: Params) {
  const { courseId } = await params;
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);
  const title = typeof body.title === "string" ? body.title.trim() : "";

  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });

  let data;
  if ("data" in body) {
    const sanitized = sanitizeCanvasData(body.data);
    if (!sanitized) return Response.json({ error: "That isn't a valid canvas file" }, { status: 400 });
    data = sanitized;
  }

  try {
    const canvas = await createCanvas(title, id, data);
    return Response.json({ canvas }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't create canvas" }, { status: 409 });
  }
}
