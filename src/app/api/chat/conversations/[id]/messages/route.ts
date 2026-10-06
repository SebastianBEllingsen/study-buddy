import { sendChatMessage, validateAndExtractAttachments } from "@/lib/chat";
import { describeAiError, AiDisabledError } from "@/lib/aiClient";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));

  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const attachments = Array.isArray(body?.attachments)
    ? await validateAndExtractAttachments(body.attachments)
    : undefined;

  if (!content && !attachments?.length) {
    return Response.json({ error: "content or an attachment is required" }, { status: 400 });
  }

  // stream: true answers with newline-delimited JSON events —
  // {type:"delta",text} as the reply is written, then {type:"done",message}
  // (the saved, final message) or {type:"error",error}.
  if (body?.stream === true) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          const message = await sendChatMessage(id, content, attachments, (text) => send({ type: "delta", text }));
          send({ type: "done", message });
        } catch (err) {
          if (!(err instanceof AiDisabledError)) console.error("Chat reply failed:", err);
          send({
            type: "error",
            error: err instanceof AiDisabledError ? err.message : await describeAiError(err),
          });
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
    });
  }

  try {
    const reply = await sendChatMessage(id, content, attachments);
    return Response.json(reply, { status: 201 });
  } catch (err) {
    if (err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Chat reply failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
