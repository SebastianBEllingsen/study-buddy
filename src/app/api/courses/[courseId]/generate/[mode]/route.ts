import { generateForCourse, NoDocumentsError } from "@/lib/generate";
import { describeAiError } from "@/lib/aiClient";
import type { GenerationMode } from "@/lib/models";

type Params = { params: Promise<{ courseId: string; mode: string }> };

const VALID_MODES: GenerationMode[] = ["notes", "quiz", "flashcards"];

export async function POST(request: Request, { params }: Params) {
  const { courseId, mode } = await params;

  if (!VALID_MODES.includes(mode as GenerationMode)) {
    return Response.json({ error: "Invalid mode" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const folderId =
    typeof body?.folderId === "number" && Number.isInteger(body.folderId)
      ? body.folderId
      : null;

  try {
    const item = await generateForCourse(Number(courseId), mode as GenerationMode, folderId);
    return Response.json(item, { status: 201 });
  } catch (err) {
    if (err instanceof NoDocumentsError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Generation failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
