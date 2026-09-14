import { createChatConversation, listChatConversations } from "@/lib/models";

export async function GET() {
  return Response.json(await listChatConversations());
}

export async function POST() {
  const conversation = await createChatConversation();
  return Response.json(conversation, { status: 201 });
}
