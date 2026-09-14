import { deleteChatConversation, getChatConversation } from "@/lib/models";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const detail = await getChatConversation(Number(id));
  if (!detail) return Response.json({ error: "Conversation not found" }, { status: 404 });
  return Response.json(detail);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  await deleteChatConversation(Number(id));
  return new Response(null, { status: 204 });
}
