import { AiDisabledError, describeAiError } from "@/lib/aiClient";
import { ProblemSetError, actOnProblem } from "@/lib/problems/service";
import { deleteProblemSet, getProblemSet } from "@/lib/problems/store";
import { parseProblemAction, publicSet } from "@/lib/problems/requests";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ setId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const id = parseId((await params).setId);
  const set = id === null ? null : await getProblemSet(id);
  if (!set) return Response.json({ error: "Problem set not found" }, { status: 404 });
  return Response.json({ set: publicSet(set) });
}

// One action on one problem: check work, take a hint, reveal, or finish a
// worked example. Body: { action, problem, step?, text? }.
export async function POST(request: Request, { params }: Params) {
  const id = parseId((await params).setId);
  if (id === null) return Response.json({ error: "Problem set not found" }, { status: 404 });
  const act = parseProblemAction(await parseJsonObjectBody(request));
  if (!act) return Response.json({ error: "Invalid action" }, { status: 400 });
  try {
    return Response.json({ set: publicSet(await actOnProblem(id, act)) });
  } catch (err) {
    if (err instanceof ProblemSetError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: err instanceof ProblemSetError && err.message.includes("not found") ? 404 : 400 });
    }
    console.error("Problem set action failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const id = parseId((await params).setId);
  if (id === null || !(await getProblemSet(id))) return Response.json({ error: "Problem set not found" }, { status: 404 });
  await deleteProblemSet(id);
  return Response.json({ ok: true });
}
