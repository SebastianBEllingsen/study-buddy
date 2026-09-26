import { getMistake, setMistakeResolved } from "@/lib/review/mistakes";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";

type Params = { params: Promise<{ mistakeId: string }> };

// Marks a mistake resolved (dismissed by hand) or reopens it.
export async function PATCH(request: Request, { params }: Params) {
  const id = parseId((await params).mistakeId);
  if (id === null) return Response.json({ error: "Mistake not found" }, { status: 404 });
  const body = await parseJsonObjectBody(request);
  if (typeof body.resolved !== "boolean") {
    return Response.json({ error: "resolved must be a boolean" }, { status: 400 });
  }
  try {
    if (!(await getMistake(id))) return Response.json({ error: "Mistake not found" }, { status: 404 });
    await setMistakeResolved(id, body.resolved);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Updating a mistake failed:", err);
    return Response.json({ error: "Couldn't update this mistake" }, { status: 500 });
  }
}
