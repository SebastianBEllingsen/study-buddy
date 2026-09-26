import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { InvalidAiResponseError } from "@/lib/aiResponseValidation";
import { reportItemWrong, resolveFlag, suggestFix } from "@/lib/sources/flagStore";
import { FlagError } from "@/lib/sources/flags";
import { parseFlagRequest } from "@/lib/sources/requests";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ itemId: string }> };

// Flagged cards and questions. Body: { index, action } where action is
// "report" (with an optional issue — the student's "This is wrong"),
// "keep", "remove", "save" (with the corrected entry) or "suggest" (asks
// the AI for a fix; nothing is saved).
export async function POST(request: Request, { params }: Params) {
  const id = parseId((await params).itemId);
  if (id === null) return Response.json({ error: "Item not found" }, { status: 404 });
  const req = parseFlagRequest(await parseJsonObjectBody(request));
  if (!req) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    switch (req.action) {
      case "report":
        await reportItemWrong(id, req.index, req.issue);
        return Response.json({ ok: true });
      case "suggest":
        return Response.json({ suggestion: await suggestFix(id, req.index) });
      case "save":
        await resolveFlag(id, req.index, { action: "save", entry: req.entry });
        return Response.json({ ok: true });
      default:
        await resolveFlag(id, req.index, { action: req.action });
        return Response.json({ ok: true });
    }
  } catch (err) {
    if (err instanceof FlagError) {
      return Response.json({ error: err.message }, { status: err.message === "Item not found" ? 404 : 400 });
    }
    if (err instanceof AiDisabledError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof InvalidAiResponseError) return Response.json({ error: err.message }, { status: 502 });
    if (req.action === "suggest") {
      console.error("Fix suggestion failed:", err);
      return Response.json({ error: await describeAiError(err) }, { status: 502 });
    }
    console.error("Updating a flag failed:", err);
    return Response.json({ error: "Couldn't update this item" }, { status: 500 });
  }
}
