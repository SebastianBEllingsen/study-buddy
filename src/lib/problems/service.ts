import { generateStructured } from "../aiClient";
import { createGeneratedItem, getAppSettings, getCourse, getGeneratedItem } from "../models";
import { languageName } from "../languages";
import { checkSystemPrompt, checkUserPrompt, coachSystemPrompt, mixedSystemPrompt, type ProblemTopic } from "../prompts/problems";
import type { AttemptResultEntry } from "../quizGrading";
import type { QuizContent } from "../types";
import { getChapter, getStudyPlan, getStudyPlanForCourse } from "../studyPlan/store";
import { chapterIsComplete } from "../studyPlanDisplay";
import { loadCourseKnowledge } from "../review/knowledge";
import { recordQuizAnswers } from "../review/answers";
import type { Confidence } from "../review/types";
import { getExamProfile } from "../exams/store";
import { createProblemSet, getProblemSet, saveProgress, setProblemPracticeItem } from "./store";
import type { Problem, ProblemProgress, ProblemSet, Verdict } from "./types";
import { normalizeCheck, normalizeProblems } from "./validate";

// Problem-solving practice: a coached set fades support over four problems
// (worked → faded → two independent); a mixed set interleaves independent
// problems across the learner's weakest topics. Solved problems go into
// spaced review through the set's practice quiz, like mock exam tasks.

export class ProblemSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProblemSetError";
  }
}

const MIXED_TOPICS = 4;

async function context(courseId: number) {
  const [course, profile, settings] = await Promise.all([getCourse(courseId), getExamProfile(courseId), getAppSettings()]);
  return {
    courseName: course?.name ?? "this course",
    language: profile?.profile.language ?? languageName(settings.preferredLanguage),
    examStyle: profile?.profile.style || null,
    efficient: settings.aiEfficiencyMode,
  };
}

export async function createCoachSet(courseId: number, input: { chapterId?: number | null; topic?: string }): Promise<ProblemSet> {
  let topic: ProblemTopic;
  let chapterId: number | null = null;
  if (input.chapterId != null) {
    const chapter = await getChapter(input.chapterId);
    const plan = chapter ? await getStudyPlan(chapter.plan_id) : undefined;
    if (!chapter || plan?.course_id !== courseId) throw new ProblemSetError("That chapter isn't in this course.");
    chapterId = chapter.id;
    topic = { name: chapter.title, summary: chapter.summary, subtopics: chapter.subtopics.map((s) => s.text) };
  } else {
    const name = input.topic?.trim().slice(0, 200);
    if (!name) throw new ProblemSetError("Say what topic to practise.");
    topic = { name, summary: "", subtopics: [] };
  }
  const ctx = await context(courseId);
  const { problems } = normalizeProblems(
    await generateStructured<unknown>({
      system: coachSystemPrompt(ctx.courseName, topic, ctx.language, ctx.examStyle),
      user: `Write the problem set on "${topic.name}" now.`,
      maxTokens: ctx.efficient ? 8000 : 12_000,
      effort: ctx.efficient ? "low" : "medium",
      efficient: ctx.efficient,
    }),
    "coach"
  );
  return createProblemSet({ courseId, chapterId, kind: "coach", title: `Coached: ${topic.name}`, problems });
}

// The weakest reviewed concepts; failing that, the plan's open chapters.
export async function mixedTopics(courseId: number): Promise<ProblemTopic[]> {
  const knowledge = await loadCourseKnowledge(courseId);
  const weak = knowledge.concepts.filter((c) => c.reviewed > 0).slice(0, MIXED_TOPICS);
  if (weak.length >= 2) return weak.map((c) => ({ name: c.name, summary: "", subtopics: [] }));
  const plan = await getStudyPlanForCourse(courseId);
  const chapters = [...(plan?.chapters ?? [])].sort((a, b) => a.position - b.position);
  const open = chapters.filter((c) => !chapterIsComplete(c));
  return (open.length >= 2 ? open : chapters)
    .slice(0, MIXED_TOPICS)
    .map((c) => ({ name: c.title, summary: c.summary, subtopics: c.subtopics.map((s) => s.text) }));
}

export async function createMixedSet(courseId: number): Promise<ProblemSet> {
  const topics = await mixedTopics(courseId);
  if (topics.length < 2) {
    throw new ProblemSetError("A mixed set needs at least two topics — review some tagged cards, or build a study plan.");
  }
  const ctx = await context(courseId);
  const { problems } = normalizeProblems(
    await generateStructured<unknown>({
      system: mixedSystemPrompt(ctx.courseName, topics, ctx.language, ctx.examStyle),
      user: "Write the mixed problem set now.",
      maxTokens: ctx.efficient ? 8000 : 12_000,
      effort: ctx.efficient ? "low" : "medium",
      efficient: ctx.efficient,
    }),
    "mixed"
  );
  return createProblemSet({ courseId, chapterId: null, kind: "mixed", title: `Mixed: ${topics.map((t) => t.name).join(", ")}`.slice(0, 200), problems });
}

async function check(set: ProblemSet, problem: Problem, target: { step: number } | "solution", text: string) {
  const ctx = await context(set.course_id);
  return normalizeCheck(
    await generateStructured<unknown>({
      system: checkSystemPrompt(ctx.language),
      user: checkUserPrompt(problem, target, text),
      maxTokens: 1500,
      effort: "low",
      efficient: ctx.efficient,
    })
  );
}

function practiceContent(set: ProblemSet): QuizContent {
  return {
    questions: set.problems.map((p) => ({
      type: "short_answer" as const,
      question: p.statement,
      modelAnswer: `${p.steps.map((s) => s.text).join("\n")}\n\nAnswer: ${p.answer}`,
      explanation: p.steps.map((s) => s.hint).filter(Boolean).join(" "),
      concept: p.concept,
    })),
  };
}

// Leaning on hints means the method isn't secure yet: two or more turn a
// correct solution into a partial one for scheduling, one marks it unsure.
export function reviewVerdict(verdict: Verdict, hintsUsed: number): { verdict: Verdict; confidence: Confidence | null } {
  if (verdict === "correct" && hintsUsed >= 2) return { verdict: "partial", confidence: null };
  if (verdict === "correct" && hintsUsed === 1) return { verdict: "correct", confidence: "unsure" };
  return { verdict, confidence: null };
}

async function recordForReview(set: ProblemSet, index: number, verdict: Verdict, work: string, feedback: string) {
  let item = set.practice_item_id !== null ? await getGeneratedItem(set.practice_item_id) : undefined;
  if (!item) {
    item = await createGeneratedItem({
      courseId: set.course_id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "quiz",
      title: `Problem practice — ${set.title}`.slice(0, 200),
      contentJson: practiceContent(set),
      sourceDocumentIds: [],
      studyPlanChapterId: set.chapter_id,
    });
    await setProblemPracticeItem(set.id, item.id);
  }
  const question = practiceContent(set).questions[index];
  const scored = reviewVerdict(verdict, set.progress[index].hintsUsed);
  const result: AttemptResultEntry = {
    index,
    type: "short_answer",
    correct: scored.verdict === "correct",
    verdict: scored.verdict,
    feedback,
    explanation: question.explanation,
    correctAnswer: set.problems[index].answer,
  };
  await recordQuizAnswers({ item, source: "quiz", entries: [{ question, answer: work, confidence: scored.confidence, result }] });
}

export type ProblemAction =
  | { action: "check"; problem: number; step?: number; text: string }
  | { action: "hint"; problem: number }
  | { action: "reveal"; problem: number; step?: number }
  | { action: "done"; problem: number };

export async function actOnProblem(setId: number, act: ProblemAction): Promise<ProblemSet> {
  const set = await getProblemSet(setId);
  if (!set) throw new ProblemSetError("Problem set not found.");
  const problem = set.problems[act.problem];
  if (!problem) throw new ProblemSetError("No such problem.");
  const progress: ProblemProgress = structuredClone(set.progress[act.problem]);
  const firstFinish = !progress.done;

  if (act.action === "hint") {
    if (problem.stage !== "independent") throw new ProblemSetError("Hints are for problems you solve alone.");
    progress.hintsUsed = Math.min(problem.steps.length, progress.hintsUsed + 1);
  } else if (act.action === "done") {
    if (problem.stage !== "worked") throw new ProblemSetError("Solve this one first.");
    progress.done = true;
  } else if (act.action === "reveal") {
    if (problem.stage === "faded" && act.step !== undefined && problem.blanks.includes(act.step)) {
      progress.revealed = [...new Set([...progress.revealed, act.step])];
      progress.done = problem.blanks.every((b) => progress.revealed.includes(b) || progress.stepAnswers[b]?.verdict === "correct");
    } else if (problem.stage === "independent") {
      // Giving up before any attempt shows the solution and counts as not
      // solved (an earlier attempt was already scored).
      if (firstFinish && !progress.solution) {
        await recordForReview(set, act.problem, "incorrect", "", "Looked at the solution.");
      }
      progress.done = true;
    } else {
      throw new ProblemSetError("Nothing to reveal there.");
    }
  } else {
    const text = act.text.trim();
    if (!text) throw new ProblemSetError("Write your working first.");
    if (problem.stage === "faded") {
      if (act.step === undefined || !problem.blanks.includes(act.step)) throw new ProblemSetError("That step isn't one to fill in.");
      const result = await check(set, problem, { step: act.step }, text);
      progress.stepAnswers[act.step] = { text, ...result };
      progress.done = problem.blanks.every((b) => progress.revealed.includes(b) || progress.stepAnswers[b]?.verdict === "correct");
    } else if (problem.stage === "independent") {
      if (progress.done) throw new ProblemSetError("This problem is finished.");
      const result = await check(set, problem, "solution", text);
      // Only the first attempt is scored for review; later attempts are
      // for getting it right.
      const firstAttempt = !progress.solution;
      progress.solution = { text, ...result };
      if (firstAttempt) await recordForReview(set, act.problem, result.verdict, text, result.feedback);
      if (result.verdict === "correct") progress.done = true;
    } else {
      throw new ProblemSetError("Worked examples are for studying, not answering.");
    }
  }

  const next = set.progress.map((p, i) => (i === act.problem ? progress : p));
  await saveProgress(set.id, next);
  // Re-read: recording for review may have just created the practice quiz.
  return (await getProblemSet(set.id)) ?? { ...set, progress: next };
}
