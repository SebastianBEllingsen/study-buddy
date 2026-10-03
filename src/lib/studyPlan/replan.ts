import { generateStructured } from "../aiClient";
import { getAppSettings } from "../models";
import { normalizeStudyPlanReplan } from "../aiResponseValidation";
import { studyPlanReplanSystemPrompt, studyPlanReplanUserPrompt } from "../prompts/studyPlan";
import { languageName } from "../languages";
import { localToday, missedSessions, type ScheduleWarning } from "./schedule";
import { reschedulePlan } from "./scheduleService";
import { StudyPlanNotFoundError } from "./resources";
import { getStudyPlan } from "./store";
import { chapterIsComplete } from "../studyPlanDisplay";

// "Replan": asks the AI which chapters need extra review given how the
// student is actually doing (mastery from their quizzes and flashcards,
// missed sessions), then rebuilds the schedule from today with that extra
// review first. If the AI is off or fails, the schedule is still rebuilt —
// missed sessions still get moved — just without extra review.

class AiSkipped extends Error {}

export interface ReplanResult {
  message: string;
  warnings: ScheduleWarning[];
  extraReview: { chapterId: number; minutes: number }[];
}

export async function replanStudyPlan(planId: number, options: { useAi?: boolean } = {}): Promise<ReplanResult> {
  const plan = await getStudyPlan(planId);
  if (!plan) throw new StudyPlanNotFoundError();
  const today = localToday();
  const chapters = [...plan.chapters].sort((a, b) => a.stage - b.stage || a.position - b.position);
  const missed = missedSessions(plan.sessions, today);

  // Stays undefined if the AI is unavailable, so extra review from an earlier
  // replan is kept rather than dropped.
  let extraReview: Map<number, number> | undefined;
  let message = missed.length
    ? `Moved ${missed.length} missed session${missed.length === 1 ? "" : "s"} forward from today.`
    : "Rebuilt the schedule from today.";

  // useAi: false only moves the missed sessions — no AI call.
  try {
    if (options.useAi === false) throw new AiSkipped();
    const { aiEfficiencyMode: efficient, preferredLanguage } = await getAppSettings();
    const replan = normalizeStudyPlanReplan(
      await generateStructured<unknown>({
        system: studyPlanReplanSystemPrompt(languageName(preferredLanguage)),
        user: studyPlanReplanUserPrompt(
          chapters.map((c) => ({
            title: c.title,
            masteryPercent: c.mastery === null ? null : Math.round(c.mastery * 100),
            level: c.current_level,
            complete: chapterIsComplete(c),
            missedSessions: missed.filter((s) => s.chapter_id === c.id).length,
          })),
          plan.options.deadline
        ),
        maxTokens: 2000,
        effort: "low",
        efficient,
      })
    );
    extraReview = new Map(
      replan.adjustments
        .filter((a) => chapters[a.chapter - 1])
        .map((a) => [chapters[a.chapter - 1].id, a.extraReviewMinutes])
    );
    if (replan.message) message = replan.message;
  } catch (err) {
    if (!(err instanceof AiSkipped)) {
      console.warn("Study plan: AI replan unavailable, rescheduling without extra review:", err);
    }
  }

  const { warnings } = await reschedulePlan(planId, extraReview);
  return {
    message,
    warnings,
    extraReview: [...(extraReview ?? [])].map(([chapterId, minutes]) => ({ chapterId, minutes })),
  };
}
