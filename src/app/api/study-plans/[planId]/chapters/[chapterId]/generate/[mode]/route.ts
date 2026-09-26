import { generateForCourse, NoDocumentsError } from "@/lib/generate";
import { describeAiError, AiDisabledError } from "@/lib/aiClient";
import { createGenerationNotification, getAppSettings } from "@/lib/models";
import type { GenerationMode } from "@/lib/models";
import { parseId } from "@/lib/routeParams";
import { parseJsonObjectBody } from "@/lib/requestBody";
import { parseQuizSettings } from "@/lib/quizSettings";
import { getChapter, getStudyPlan } from "@/lib/studyPlan/store";

type Params = { params: Promise<{ planId: string; chapterId: string; mode: string }> };

const VALID_MODES: GenerationMode[] = ["notes", "quiz", "flashcards"];

// A quiz, flashcard deck or notes for one study-plan chapter — from the
// chapter's linked course documents, or from its topic outline when it has
// none. The item is linked to the chapter, so its results feed the
// chapter's mastery (see lib/studyPlan/mastery.ts).
export async function POST(request: Request, { params }: Params) {
  const { planId, chapterId, mode } = await params;
  if (!VALID_MODES.includes(mode as GenerationMode)) {
    return Response.json({ error: "Invalid mode" }, { status: 400 });
  }
  const planIdNum = parseId(planId);
  const chapterIdNum = parseId(chapterId);
  const plan = planIdNum === null ? undefined : await getStudyPlan(planIdNum);
  const chapter = chapterIdNum === null ? undefined : await getChapter(chapterIdNum);
  if (!plan || !chapter || chapter.plan_id !== plan.id) {
    return Response.json({ error: "Chapter not found" }, { status: 404 });
  }

  const body = await parseJsonObjectBody(request);
  try {
    const item = await generateForCourse(plan.course_id, mode as GenerationMode, {
      documentIds: chapter.linked_document_ids.length ? chapter.linked_document_ids : null,
      quizSettings: parseQuizSettings(body.quizSettings),
      // Filed on the course page rather than in whichever folder the
      // chapter's documents happen to live in.
      destinationFolderId: null,
      studyPlanChapter: {
        id: chapter.id,
        title: chapter.title,
        summary: chapter.summary,
        subtopics: chapter.subtopics.map((s) => s.text),
      },
    });
    const { autoOpenGeneratedItems } = await getAppSettings();
    if (!autoOpenGeneratedItems) await createGenerationNotification(item.id);
    return Response.json(item, { status: 201 });
  } catch (err) {
    if (err instanceof NoDocumentsError || err instanceof AiDisabledError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Chapter generation failed:", err);
    return Response.json({ error: await describeAiError(err) }, { status: 502 });
  }
}
