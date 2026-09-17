import { resolvePendingAction, PendingActionNotFoundError } from "@/lib/chat";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ id: string; messageId: string }> };

// Confirms or cancels an AI-proposed folder/save action (see
// chat.ts/chatActions.ts) — the one place these actions actually execute.
export async function POST(request: Request, { params }: Params) {
  const { id: idParam, messageId: messageIdParam } = await params;
  const conversationId = parseId(idParam);
  const messageId = parseId(messageIdParam);
  if (conversationId === null || messageId === null) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body?.confirm !== "boolean") {
    return Response.json({ error: "confirm must be a boolean" }, { status: 400 });
  }

  try {
    const message = await resolvePendingAction(conversationId, messageId, body.confirm);
    return Response.json(message);
  } catch (err) {
    if (err instanceof PendingActionNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    console.error("Resolving pending chat action failed:", err);
    return Response.json({ error: "Couldn't resolve that action" }, { status: 500 });
  }
}
