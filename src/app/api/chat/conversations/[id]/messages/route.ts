import { sendChatMessage } from "@/lib/chat";
import { describeAiError } from "@/lib/aiClient";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  if (typeof body?.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }

  try {
    const reply = await sendChatMessage(id, body.content.trim());
    return Response.json(reply, { status: 201 });
  } catch (err) {
    console.error("Chat reply failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
