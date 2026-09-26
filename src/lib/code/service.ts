import { generateStructured } from "../aiClient";
import { createGeneratedItem, getAppSettings, getCourse, getGeneratedItem } from "../models";
import { languageName } from "../languages";
import { codeExercisesSystemPrompt, type CodeTopic } from "../prompts/code";
import type { AttemptResultEntry } from "../quizGrading";
import type { QuizContent } from "../types";
import { getChapter, getStudyPlan } from "../studyPlan/store";
import { listConceptsForCourse } from "../review/concepts";
import { recordQuizAnswers } from "../review/answers";
import { reviewVerdict } from "../problems/service";
import { createCodeSet, getCodeSet, saveCodeProgress, setCodePracticeItem } from "./store";
import type { CodeAction } from "./requests";
import { CODE_LANGUAGE_NAMES, type CodeLanguage, type CodeProgress, type CodeSet } from "./types";
import { normalizeCodeExercises } from "./validate";

// Code exercises: the AI writes a short progression of exercises with
// tests; the learner's code runs in their browser (components/code/), which
// reports the test results here. A finished exercise goes into spaced
// review through the set's practice quiz, like a solved problem.

export class CodeSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeSetError";
  }
}

export async function generateCodeSet(
  courseId: number,
  input: { language: CodeLanguage; chapterId: number | null; topic: string }
): Promise<CodeSet> {
  let topic: CodeTopic;
  if (input.chapterId !== null) {
    const chapter = await getChapter(input.chapterId);
    const plan = chapter ? await getStudyPlan(chapter.plan_id) : undefined;
    if (!chapter || plan?.course_id !== courseId) throw new CodeSetError("That chapter isn't in this course.");
    topic = { name: chapter.title, summary: chapter.summary, subtopics: chapter.subtopics.map((s) => s.text) };
  } else {
    topic = { name: input.topic, summary: "", subtopics: [] };
  }
  const [course, settings, concepts] = await Promise.all([getCourse(courseId), getAppSettings(), listConceptsForCourse(courseId)]);
  const efficient = settings.aiEfficiencyMode;
  const exercises = normalizeCodeExercises(
    await generateStructured<unknown>({
      system: codeExercisesSystemPrompt(
        course?.name ?? "this course",
        topic,
        input.language,
        languageName(settings.preferredLanguage),
        concepts.map((c) => c.name)
      ),
      user: `Write the ${CODE_LANGUAGE_NAMES[input.language]} exercises on "${topic.name}" now.`,
      maxTokens: efficient ? 8000 : 12_000,
      effort: efficient ? "low" : "medium",
      efficient,
    })
  );
  return createCodeSet({
    courseId,
    chapterId: input.chapterId,
    title: `${CODE_LANGUAGE_NAMES[input.language]}: ${topic.name}`.slice(0, 200),
    language: input.language,
    exercises,
  });
}

export function codePracticeContent(set: CodeSet): QuizContent {
  const fence = set.language === "python" ? "python" : "js";
  return {
    questions: set.exercises.map((e) => ({
      type: "short_answer" as const,
      question: `${e.title} (${CODE_LANGUAGE_NAMES[set.language]})\n\n${e.prompt}`,
      modelAnswer: `\`\`\`${fence}\n${e.solution}\n\`\`\``,
      explanation: e.hints.join(" "),
      ...(e.concept && { concept: e.concept }),
    })),
  };
}

async function recordForReview(set: CodeSet, index: number, solved: boolean, code: string) {
  let item = set.practice_item_id !== null ? await getGeneratedItem(set.practice_item_id) : undefined;
  if (!item) {
    item = await createGeneratedItem({
      courseId: set.course_id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "quiz",
      title: `Code practice — ${set.title}`.slice(0, 200),
      contentJson: codePracticeContent(set),
      sourceDocumentIds: [],
      studyPlanChapterId: set.chapter_id,
    });
    await setCodePracticeItem(set.id, item.id);
  }
  const question = codePracticeContent(set).questions[index];
  const scored = reviewVerdict(solved ? "correct" : "incorrect", set.progress[index].hintsUsed);
  const result: AttemptResultEntry = {
    index,
    type: "short_answer",
    correct: scored.verdict === "correct",
    verdict: scored.verdict,
    feedback: solved ? "All tests passed." : "Looked at the solution.",
    explanation: question.explanation,
    correctAnswer: question.type === "short_answer" ? question.modelAnswer : "",
  };
  await recordQuizAnswers({ item, source: "quiz", entries: [{ question, answer: code, confidence: scored.confidence, result }] });
}

// Solved: at least one test ran, the code loaded, and every test passed.
// (The browser leaves out tests the reference solution itself fails.)
export function allPassed(run: { error: string | null; tests: { passed: boolean }[] }): boolean {
  return run.error === null && run.tests.length > 0 && run.tests.every((t) => t.passed);
}

export async function actOnCodeSet(setId: number, act: CodeAction): Promise<CodeSet> {
  const set = await getCodeSet(setId);
  if (!set) throw new CodeSetError("Code set not found.");
  const exercise = set.exercises[act.exercise];
  if (!exercise) throw new CodeSetError("No such exercise.");
  const progress: CodeProgress = { ...set.progress[act.exercise] };

  if (act.action === "save") {
    progress.code = act.code;
  } else if (act.action === "hint") {
    progress.hintsUsed = Math.min(exercise.hints.length, progress.hintsUsed + 1);
  } else if (act.action === "reveal") {
    // Giving up before solving it counts as not solved; after solving, it's
    // just a look at another way to write it.
    if (!progress.done) await recordForReview(set, act.exercise, false, progress.code);
    progress.revealed = true;
    progress.done = true;
  } else {
    // The browser ran the tests; the result is taken at its word — this is
    // the learner's own practice.
    progress.code = act.code;
    progress.runs += 1;
    if (allPassed(act) && !progress.passed) {
      progress.passed = true;
      if (!progress.done) await recordForReview(set, act.exercise, true, act.code);
      progress.done = true;
    }
  }

  const next = set.progress.map((p, i) => (i === act.exercise ? progress : p));
  await saveCodeProgress(set.id, next);
  // Re-read: recording for review may have just created the practice quiz.
  return (await getCodeSet(set.id)) ?? { ...set, progress: next };
}
