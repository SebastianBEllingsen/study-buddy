import { CodeSetError, actOnCodeSet } from "@/lib/code/service";
import { deleteCodeSet, getCodeSet } from "@/lib/code/store";
import { parseCodeAction } from "@/lib/code/requests";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ setId: string }> };

// The whole set, tests and reference solutions included: the browser runs
// the tests (and checks them against the solution first). The page keeps
// hidden tests and the solution out of view until they're earned.
export async function GET(_request: Request, { params }: Params) {
  const id = parseId((await params).setId);
  const set = id === null ? null : await getCodeSet(id);
  if (!set) return Response.json({ error: "Code set not found" }, { status: 404 });
  return Response.json({ set });
}

// One action on one exercise: save code, report a test run, take a hint,
// or reveal the solution. Body: { action, exercise, code?, error?, tests? }.
export async function POST(request: Request, { params }: Params) {
  const id = parseId((await params).setId);
  if (id === null) return Response.json({ error: "Code set not found" }, { status: 404 });
  const act = parseCodeAction(await parseJsonObjectBody(request));
  if (!act) return Response.json({ error: "Invalid action" }, { status: 400 });
  try {
    return Response.json({ set: await actOnCodeSet(id, act) });
  } catch (err) {
    if (err instanceof CodeSetError) {
      return Response.json({ error: err.message }, { status: err.message.includes("not found") ? 404 : 400 });
    }
    console.error("Code set action failed:", err);
    return Response.json({ error: "Couldn't save that" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const id = parseId((await params).setId);
  if (id === null || !(await getCodeSet(id))) return Response.json({ error: "Code set not found" }, { status: 404 });
  await deleteCodeSet(id);
  return Response.json({ ok: true });
}
