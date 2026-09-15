import { generateForCourse, NoDocumentsError, DestinationFolderNotFoundError } from "@/lib/generate";
import { describeAiError, AiDisabledError } from "@/lib/aiClient";
import { createGenerationNotification, getAppSettings } from "@/lib/models";
import type { GenerationMode } from "@/lib/models";
import type { QuizGenerationSettings } from "@/lib/types";
import { parseId } from "@/lib/routeParams";

type Params = { params: Promise<{ courseId: string; mode: string }> };

const VALID_MODES: GenerationMode[] = ["notes", "quiz", "flashcards"];

function parseQuizSettings(value: unknown): QuizGenerationSettings | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const singleChoice = !!v.singleChoice;
  const multipleChoice = !!v.multipleChoice;
  const shortAnswer = !!v.shortAnswer;
  // Falls back to "no settings" (generateQuiz's own unrestricted default)
  // rather than a request with every type off, which would leave the
  // prompt with nothing to ask for.
  if (!singleChoice && !multipleChoice && !shortAnswer) return undefined;
  return { singleChoice, multipleChoice, shortAnswer };
}

export async function POST(request: Request, { params }: Params) {
  const { courseId, mode } = await params;

  if (!VALID_MODES.includes(mode as GenerationMode)) {
    return Response.json({ error: "Invalid mode" }, { status: 400 });
  }
  const id = parseId(courseId);
  if (id === null) return Response.json({ error: "Course not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const folderId =
    typeof body?.folderId === "number" && Number.isInteger(body.folderId)
      ? body.folderId
      : null;
  const documentIds = Array.isArray(body?.documentIds)
    ? body.documentIds.filter((id: unknown): id is number => typeof id === "number" && Number.isInteger(id))
    : null;
  const quizSettings = parseQuizSettings(body?.quizSettings);
  // undefined (key omitted): keep generateForCourse's own default (file
  // alongside the source folder, or the course default folder). null: force
  // the course default folder. A number: an explicit destination — see
  // destinationFolderId's doc comment on generateForCourse.
  const destinationFolderId =
    "destinationFolderId" in body
      ? typeof body.destinationFolderId === "number" && Number.isInteger(body.destinationFolderId)
        ? body.destinationFolderId
        : null
      : undefined;

  try {
    const item = await generateForCourse(id, mode as GenerationMode, {
      folderId,
      documentIds,
      quizSettings,
      destinationFolderId,
    });
    // Only when the user has opted out of being taken straight there —
    // otherwise there's nothing left to notify about by the time they'd see it.
    const { autoOpenGeneratedItems } = await getAppSettings();
    if (!autoOpenGeneratedItems) {
      await createGenerationNotification(item.id);
    }
    return Response.json(item, { status: 201 });
  } catch (err) {
    if (err instanceof NoDocumentsError || err instanceof DestinationFolderNotFoundError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Generation failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
