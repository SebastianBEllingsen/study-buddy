import { completeStep, parseCompletion } from "@/lib/today/complete";
import { parseJsonObjectBody } from "@/lib/requestBody";

// Records a Today step as done in the study plan (see lib/today/complete.ts).
export async function POST(request: Request) {
  const completion = parseCompletion(await parseJsonObjectBody(request));
  if (!completion) return Response.json({ error: "Invalid step" }, { status: 400 });
  try {
    if (!(await completeStep(completion))) return Response.json({ error: "Step not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Completing a Today step failed:", err);
    return Response.json({ error: "Couldn't save that step" }, { status: 500 });
  }
}
