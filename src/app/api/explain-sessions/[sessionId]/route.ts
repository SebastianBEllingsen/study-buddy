import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { ExplainSessionError, explainTurn } from "@/lib/explain/flow";
import { getExplainSession } from "@/lib/explain/store";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const id = parseId((await params).sessionId);
  const session = id === null ? null : await getExplainSession(id);
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
  return Response.json({ session });
}

// The student's next turn. Body: { text: string, finish?: boolean }.
export async function POST(request: Request, { params }: Params) {
  const id = parseId((await params).sessionId);
  if (id === null) return Response.json({ error: "Session not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);
  if (typeof body.text !== "string" || (body.finish !== undefined && typeof body.finish !== "boolean")) {
    return Response.json({ error: "Invalid turn" }, { status: 400 });
  }
  try {
    return Response.json({ session: await explainTurn(id, { text: body.text, finish: body.finish as boolean | undefined }) });
  } catch (err) {
    if (err instanceof ExplainSessionError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Explain session turn failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
