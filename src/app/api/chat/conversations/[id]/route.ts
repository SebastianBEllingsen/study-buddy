import { deleteChatConversation, getChatConversation } from "@/lib/models";
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

export async function DELETE(_request: Request, { params }: Params) {
  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return new Response(null, { status: 204 });
  await deleteChatConversation(id);
  return new Response(null, { status: 204 });
}
