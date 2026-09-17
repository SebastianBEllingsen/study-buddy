import { deleteChatConversation, getChatConversation, getCourse, setChatConversationCourse } from "@/lib/models";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const detail = await getChatConversation(id);
  if (!detail) return Response.json({ error: "Conversation not found" }, { status: 404 });
  return Response.json(detail);
}

// Scopes (or unscopes) a conversation to a course — see
// ChatConversation.courseId's doc comment in models.ts.
export async function PATCH(request: Request, { params }: Params) {
  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || !("courseId" in body)) {
    return Response.json({ error: "courseId is required" }, { status: 400 });
  }

  const { courseId } = body as { courseId: unknown };
  if (courseId !== null) {
    if (!Number.isInteger(courseId)) {
      return Response.json({ error: "courseId must be an integer or null" }, { status: 400 });
    }
    const course = await getCourse(courseId as number);
    if (!course) {
      return Response.json({ error: "Course not found" }, { status: 404 });
    }
  }

  const detail = await getChatConversation(id);
  if (!detail) return Response.json({ error: "Conversation not found" }, { status: 404 });

  await setChatConversationCourse(id, courseId as number | null);
  return Response.json(await getChatConversation(id));
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return new Response(null, { status: 204 });
  await deleteChatConversation(id);
  return new Response(null, { status: 204 });
}
