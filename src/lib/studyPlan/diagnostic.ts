import { generateForCourse } from "../generate";
import { mapWithConcurrency } from "../concurrency";
import { getStudyPlan } from "./store";

// The "pre-test each chapter" option: once a plan is built, a quiz per
// chapter that has none yet. Today offers it before a chapter is studied
// (lib/today/planDay.ts), and how it goes feeds the chapter's mastery — and
// with it how much study time the schedule gives the chapter.

const DIAGNOSTIC_CONCURRENCY = 2;

// Best effort: a chapter whose quiz fails is skipped (it can still be made
// from the chapter's page), never failing the plan.
export async function makeDiagnosticQuizzes(planId: number): Promise<void> {
  const plan = await getStudyPlan(planId);
  if (!plan) return;
  const chapters = plan.chapters.filter((c) => !c.items.some((i) => i.mode === "quiz"));
  await mapWithConcurrency(chapters, DIAGNOSTIC_CONCURRENCY, async (chapter) => {
    try {
      await generateForCourse(plan.course_id, "quiz", {
        documentIds: chapter.linked_document_ids.length ? chapter.linked_document_ids : null,
        destinationFolderId: null,
        studyPlanChapter: {
          id: chapter.id,
          title: chapter.title,
          summary: chapter.summary,
          subtopics: chapter.subtopics.map((s) => s.text),
        },
      });
    } catch (err) {
      console.warn(`Study plan: pre-test quiz failed for "${chapter.title}":`, err);
    }
  });
}
