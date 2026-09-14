import { sendChatMessage } from "@/lib/chat";
import { describeAiError } from "@/lib/aiClient";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  if (typeof body?.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }

  try {
    const reply = await sendChatMessage(Number(id), body.content.trim());
    return Response.json(reply, { status: 201 });
  } catch (err) {
    console.error("Chat reply failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
