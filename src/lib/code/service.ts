import { generateStructured } from "../aiClient";
import { createGeneratedItem, getAppSettings, getCourse, getGeneratedItem } from "../models";
import { languageName } from "../languages";
import { codeExercisesSystemPrompt, codeProjectSystemPrompt, codeReviewSystemPrompt, type CodeTopic } from "../prompts/code";
import type { AttemptResultEntry } from "../quizGrading";
import type { QuizContent } from "../types";
import { getChapter, getStudyPlan } from "../studyPlan/store";
import { listConceptsForCourse } from "../review/concepts";
import { recordQuizAnswers } from "../review/answers";
import { logMistake, setMisconceptions } from "../review/mistakes";
import { reviewVerdict } from "../problems/service";
import { createCodeSet, getCodeSet, saveCodeProgress, setCodePracticeItem } from "./store";
import type { CodeAction } from "./requests";
import { CODE_LANGUAGE_NAMES, isRunKind, type CodeExercise, type CodeLanguage, type CodeProgress, type CodeReview, type CodeSet, type ProjectFile } from "./types";
import { joinFiles, parseProjectFiles } from "./projectFiles";
import { normalizeCodeExercises, normalizeReview } from "./validate";

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
  input: { language: CodeLanguage; chapterId: number | null; topic: string; count?: number; project?: boolean }
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
    input.language,
    await generateStructured<unknown>({
      system: input.project
        ? codeProjectSystemPrompt(course?.name ?? "this course", topic, input.language, languageName(settings.preferredLanguage), input.count)
        : codeExercisesSystemPrompt(
            course?.name ?? "this course",
            topic,
            input.language,
            languageName(settings.preferredLanguage),
            concepts.map((c) => c.name),
            input.count
          ),
      user: `Write the ${CODE_LANGUAGE_NAMES[input.language]} ${input.project ? "project milestones" : "exercises"} on "${topic.name}" now.`,
      maxTokens: efficient ? 8000 : 12_000,
      effort: efficient ? "low" : "medium",
      efficient,
    })
  );
  return createCodeSet({
    courseId,
    chapterId: input.chapterId,
    title: `${CODE_LANGUAGE_NAMES[input.language]}${input.project ? " project" : ""}: ${topic.name}`.slice(0, 200),
    language: input.language,
    exercises,
  });
}

const FENCE: Record<CodeLanguage, string> = { cpp: "cpp", csharp: "csharp", sql: "sql", python: "python", javascript: "js" };

// What the learner is asked in the review queue, and the answer they're
// held to: for exercises you write, the task and a reference solution; for
// ones you read, the question with its code and the model answer.
export function codePracticeContent(set: CodeSet): QuizContent {
  const fence = FENCE[set.language];
  return {
    questions: set.exercises.map((e) => {
      // SQL questions need the tables they're about.
      const schema = e.setup ? `\n\n\`\`\`sql\n${e.setup}\n\`\`\`` : "";
      const header = `${e.title} (${CODE_LANGUAGE_NAMES[set.language]})\n\n${e.prompt}${schema}`;
      // Debug, refactor and project work start from existing code, which the question must show.
      const code = e.kind === "project" ? joinFiles(e.files, set.language) : e.starter;
      const given = code.trim() && e.kind !== "write" ? `\n\n\`\`\`${fence}\n${code}\n\`\`\`` : "";
      return {
        type: "short_answer" as const,
        question: `${header}${given}`,
        modelAnswer: isRunKind(e.kind) ? `\`\`\`${fence}\n${solutionText(e, set.language)}\n\`\`\`` : e.answer,
        explanation: e.hints.join(" "),
        ...(e.concept && { concept: e.concept }),
      };
    }),
  };
}

// The reference solution as text: a project's files are joined, each under its name.
function solutionText(e: CodeExercise, language: CodeLanguage): string {
  return e.kind === "project" ? joinFiles(e.solutionFiles, language) : e.solution;
}

// What the learner has written, as text.
function workText(e: CodeExercise, p: CodeProgress, language: CodeLanguage): string {
  return e.kind === "project" ? joinFiles(p.files, language) : p.code;
}

// Predict-the-output answers match ignoring trailing spaces and blank
// lines at the ends: the learner is judged on the output, not on spacing.
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function outputsMatch(given: string, expected: string): boolean {
  return normalizeOutput(given) === normalizeOutput(expected);
}

async function recordForReview(set: CodeSet, index: number, solved: boolean, work: string) {
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
    feedback: solved ? "Solved." : "Looked at the solution.",
    explanation: question.explanation,
    correctAnswer: question.type === "short_answer" ? question.modelAnswer : "",
  };
  await recordQuizAnswers({ item, source: "quiz", entries: [{ question, answer: work, confidence: scored.confidence, result }] });
  return item.id;
}

// Solved: at least one test ran, the code loaded, and every test passed.
// (The runner leaves out tests the reference solution itself fails.)
export function allPassed(run: { error: string | null; tests: { passed: boolean }[] }): boolean {
  return run.error === null && run.tests.length > 0 && run.tests.every((t) => t.passed);
}

// The AI's review of a solved exercise. Something it calls a real problem
// goes into the mistake log, so it comes back to be fixed and re-learnt
// even though the tests passed.
async function reviewSolution(set: CodeSet, index: number): Promise<CodeReview> {
  const exercise = set.exercises[index];
  const progress = set.progress[index];
  const settings = await getAppSettings();
  const efficient = settings.aiEfficiencyMode;
  const fence = FENCE[set.language];
  const review = normalizeReview(
    await generateStructured<unknown>({
      system: codeReviewSystemPrompt(set.language, languageName(settings.preferredLanguage)),
      user: `Exercise: ${exercise.title} (${exercise.kind})\n${exercise.prompt}\n\nLearner's solution (passes every test; ${progress.hintsUsed} hint${progress.hintsUsed === 1 ? "" : "s"} used):\n\`\`\`${fence}\n${workText(exercise, progress, set.language)}\n\`\`\`\n\nReference solution:\n\`\`\`${fence}\n${solutionText(exercise, set.language)}\n\`\`\``,
      maxTokens: efficient ? 1500 : 2500,
      effort: efficient ? "low" : "medium",
      efficient,
    })
  );
  if (review.verdict === "needs_work" && set.practice_item_id !== null) {
    const mistake = await logMistake({
      generatedItemId: set.practice_item_id,
      reviewItemId: null,
      conceptId: null,
      kind: "question",
      itemIndex: index,
      prompt: codePracticeContent(set).questions[index].question,
      givenAnswer: workText(exercise, progress, set.language),
      correctAnswer: `\`\`\`${fence}\n${solutionText(exercise, set.language)}\n\`\`\``,
      confidence: null,
    });
    if (review.points[0]) await setMisconceptions(new Map([[mistake.id, review.points[0].text.slice(0, 300)]]));
  }
  return review;
}

// A project's files as sent by the learner, checked against the language.
function projectFilesFor(set: CodeSet, exercise: CodeExercise, files: ProjectFile[]): ProjectFile[] {
  if (exercise.kind !== "project") throw new CodeSetError("That exercise is a single file.");
  const checked = parseProjectFiles(set.language, files);
  if (!checked) throw new CodeSetError("Those files can't be used: check their names and sizes.");
  return checked;
}

function requireKind(exercise: CodeExercise, wantsRun: boolean) {
  if (isRunKind(exercise.kind) !== wantsRun) {
    throw new CodeSetError(wantsRun ? "That exercise is answered, not run." : "That exercise is solved by running code.");
  }
}

export async function actOnCodeSet(setId: number, act: CodeAction): Promise<CodeSet> {
  const set = await getCodeSet(setId);
  if (!set) throw new CodeSetError("Code set not found.");
  const exercise = set.exercises[act.exercise];
  if (!exercise) throw new CodeSetError("No such exercise.");
  const progress: CodeProgress = { ...set.progress[act.exercise] };

  if (act.action === "save") {
    progress.code = act.code;
    if (act.files) progress.files = projectFilesFor(set, exercise, act.files);
  } else if (act.action === "hint") {
    progress.hintsUsed = Math.min(exercise.hints.length, progress.hintsUsed + 1);
  } else if (act.action === "reveal") {
    // Giving up before solving it counts as not solved; after solving, it's
    // just a look at another way to write it.
    if (!progress.done) await recordForReview(set, act.exercise, false, isRunKind(exercise.kind) ? workText(exercise, progress, set.language) : progress.answer);
    progress.revealed = true;
    progress.done = true;
  } else if (act.action === "answer") {
    requireKind(exercise, false);
    progress.answer = act.answer;
    if (!progress.done) {
      if (exercise.kind === "predict") {
        progress.runs += 1;
        if (outputsMatch(act.answer, exercise.answer)) {
          progress.passed = true;
          progress.done = true;
          await recordForReview(set, act.exercise, true, act.answer);
        }
      } else if (act.selfCorrect !== undefined) {
        // "read": the learner compared with the model answer and says how they did.
        progress.passed = act.selfCorrect;
        progress.revealed = true;
        progress.done = true;
        await recordForReview(set, act.exercise, act.selfCorrect, act.answer);
      }
    }
  } else if (act.action === "review") {
    requireKind(exercise, true);
    if (!progress.passed) throw new CodeSetError("Solve the exercise first, then ask for a review.");
    progress.review = await reviewSolution(set, act.exercise);
  } else {
    requireKind(exercise, true);
    // The runner ran the tests; the result is taken at its word — this is
    // the learner's own practice.
    progress.code = act.code;
    if (act.files) progress.files = projectFilesFor(set, exercise, act.files);
    progress.runs += 1;
    if (allPassed(act) && !progress.passed) {
      progress.passed = true;
      // The practice item (and so a review's mistake log entry) exists once solved.
      if (!progress.done) await recordForReview(set, act.exercise, true, workText(exercise, progress, set.language));
      progress.done = true;
    }
  }

  const next = set.progress.map((p, i) => (i === act.exercise ? progress : p));
  await saveCodeProgress(set.id, next);
  // Re-read: recording for review may have just created the practice quiz.
  return (await getCodeSet(set.id)) ?? { ...set, progress: next };
}
