// The "Today" autopilot: turns everything that wants the learner's time
// into one ordered list of steps that fits the minutes they have. Pure and
// client-safe — lib/today/loadToday.ts gathers the inputs.
//
// Order (the research-backed priority):
//  1. due reviews — spaced retrieval is the highest-value minute there is
//  2. mistakes you were sure about — confident errors are the ones that stick
//  3. a mock exam, when exam mode says one is due (lib/readiness/examMode.ts)
//  4. the next step of up to a few plan chapters, most urgent first (plans
//     set to "every day" or short of their days-a-week target first, then the
//     nearest deadline, then weakest) and mixed across courses; they share the time
//     left between them (none in an exam's final days). A course with nothing
//     left to learn brings its weakest finished chapter back for revision
//     (lib/today/revision.ts), after new learning, and exam days keep it
//  5. coding practice, on a programming plan: write code for the
//     current chapter (reading about code is not writing it). A plan set to
//     "at least N days a week" gets it only until it has met that target
//  6. one weak concept, if time is left — two in exam mode, for more
//     mixed practice. A weak concept from code exercises comes back as a
//     fresh exercise to write, not a question to answer.

import { PROJECT_LANGUAGES, type CodeLanguage } from "../code/types";
import { REVISION_FRESH_QUIZ_SCORE } from "./revision";

export type TodayStepKind = "reviews" | "mistakes" | "exam" | "chapter" | "concept" | "code";

// What "Done" on a step records on the server (lib/today/complete.ts).
export type StepCompletion =
  | { type: "resource"; planId: number; resourceId: number }
  | { type: "subtopic"; planId: number; chapterId: number; index: number };

export interface TodayStep {
  id: string;
  kind: TodayStepKind;
  title: string;
  detail: string;
  minutes: number;
  href: string;
  external: boolean;
  courseName: string | null;
  // Why this is on today's list, in a few words.
  why?: string;
  // Set on a "test yourself" step with no quiz made yet: opening it makes
  // the chapter's quiz first (needs AI), then goes to it.
  generateQuiz?: { planId: number; chapterId: number };
  completion: StepCompletion | null;
  // The plan session this step belongs to, marked done when the day's
  // session is finished.
  sessionId: { planId: number; sessionId: number; chapterId?: number } | null;
}

export type ChapterNextStep =
  | { type: "resource"; resourceId: number; title: string; kind: string; url: string; provider: string | null }
  | { type: "subtopic"; index: number; text: string }
  | { type: "practice"; itemId: number | null; itemTitle: string | null; pretest?: boolean };

export interface ChapterCandidate {
  planId: number;
  courseId: number;
  courseName: string;
  chapterId: number;
  chapterTitle: string;
  // Today's scheduled session for this chapter, if the plan has a schedule.
  session: { id: number; minutes: number } | null;
  next: ChapterNextStep;
  // The plan's deadline (YYYY-MM-DD) and the chapter's mastery (0–1), for
  // ranking what needs the time most.
  deadline?: string | null;
  mastery?: number | null;
  // Days until that deadline, when there is one.
  daysLeft?: number | null;
  // When the learner last did anything in this course's plan (null: never),
  // so courses get their turn instead of the same few winning every day.
  lastStudiedAt?: string | null;
  // Studied but not yet tested: this step is the check that unlocks the
  // next chapter.
  awaitingCheck?: boolean;
  // A finished chapter coming back for revision (see revision.ts): a test, not
  // new material, so it still counts in an exam's final days.
  revision?: boolean;
  // Why this plan must get a chapter step today, from its Today frequency
  // setting (lib/today/cadence.ts): "your every-day plan", "1 of 3 study days
  // in the last week". Such chapters come before everything else.
  must?: string;
  // On a programming plan: the language, and the chapter's code set with
  // exercises still to do (null when there isn't one yet — opening the step
  // writes one).
  code?: { language: CodeLanguage; setId: number | null };
  // A plan set to "at least N days a week" has met its target: no coding
  // practice today (see cadence.ts).
  skipCode?: boolean;
}

export interface WeakConcept {
  courseId: number;
  courseName: string;
  name: string;
  recall: number;
  // Set when the concept comes from code exercises: it's practised by
  // writing code again, in this language.
  codeLanguage?: CodeLanguage;
}

export interface MockExamDue {
  courseId: number;
  courseName: string;
  daysLeft: number;
  minutes: number;
}

export interface TodayInput {
  minutes: number;
  courseId: number | null;
  reviews: { dueCards: number; dueQuestions: number; newCards: number };
  mistakes: { sure: number; total: number };
  mockExams?: MockExamDue[];
  chapters: ChapterCandidate[];
  // Weakest first; exam mode uses up to two.
  weakConcepts: WeakConcept[];
  examMode?: boolean;
  // Overrides how many chapters share the time (picked by the learner).
  maxChapterSteps?: number;
}

// Rough minutes per item, for fitting steps into the budget. A quiz
// question is a typed answer plus reading the feedback, so it takes longer
// than flipping a card.
export const MINUTES_PER = { card: 0.25, newCard: 0.5, question: 1.5, mistake: 1.5 };
// A review session asks again what you miss (a few items later, until it's
// right), so it runs longer than its item count: about one item in four.
export const REASK_ALLOWANCE = 1.25;
export const MAX_MISTAKE_MINUTES = 15;
export const DEFAULT_CHAPTER_STEP_MINUTES = 25;
export const MIN_CHAPTER_STEP_MINUTES = 10;
export const CONCEPT_MINUTES = 10;
export const MIN_CONCEPT_MINUTES = 5;
export const MAX_CHAPTER_STEPS = 2;
// Plans that must get a step today can take this many slots, even past the usual limit.
export const MAX_MUST_STEPS = 3;
// With this many minutes to spend, a third chapter is worth mixing in.
export const THREE_CHAPTER_MINUTES = 90;
// Chapters don't take the last minutes a weak concept needs, once there's
// time for both.
export const CONCEPT_RESERVE_FROM_MINUTES = 40;
export const CODE_MINUTES = 20;
export const MIN_CODE_MINUTES = 10;
// With this many minutes to spend, coding practice keeps its slot before chapters take the rest.
export const CODE_RESERVE_FROM_MINUTES = 40;
export const MIN_MOCK_EXAM_MINUTES = 30;

const RESOURCE_VERBS: Record<string, string> = {
  video: "Watch",
  playlist: "Watch",
  course: "Work through",
  interactive: "Work through",
  book: "Read",
  article: "Read",
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function withCourse(href: string, courseId: number | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  if (courseId !== null) params.set("courseId", String(courseId));
  const query = params.toString();
  return query ? `${href}?${query}` : href;
}

// Why a chapter made today's list: what makes it the one to work on.
export function chapterWhy(c: ChapterCandidate): string {
  const parts: string[] = [];
  if (c.must) parts.push(c.must);
  if (c.revision) {
    const mastery = c.mastery !== null && c.mastery !== undefined ? ` (${Math.round(c.mastery * 100)}%)` : "";
    parts.push(`revision — your weakest finished chapter${mastery}`);
  }
  if (c.awaitingCheck) parts.push("passing it unlocks the next chapter");
  if (c.daysLeft !== null && c.daysLeft !== undefined && c.daysLeft >= 0 && c.daysLeft <= 60) {
    parts.push(c.daysLeft === 0 ? "finish date is today" : `${plural(c.daysLeft, "day")} to your finish date`);
  }
  if (c.mastery !== null && c.mastery !== undefined && c.mastery < 0.5) parts.push("a weak spot");
  if (parts.length === 0) parts.push(c.session ? "on today's plan" : "next in your roadmap");
  return parts.join(" · ");
}

function chapterStep(c: ChapterCandidate, minutes: number): TodayStep {
  const planHref = `/courses/${c.courseId}/plan#chapter-${c.chapterId}`;
  const base = {
    kind: "chapter" as const,
    minutes,
    courseName: c.courseName,
    why: chapterWhy(c),
    sessionId: c.session ? { planId: c.planId, sessionId: c.session.id, chapterId: c.chapterId } : null,
  };
  if (c.next.type === "resource") {
    const verb = RESOURCE_VERBS[c.next.kind] ?? "Study";
    return {
      ...base,
      id: `chapter:${c.chapterId}:resource:${c.next.resourceId}`,
      title: `${verb}: ${c.next.title}`,
      detail: `${c.chapterTitle}${c.next.provider ? ` · ${c.next.provider}` : ""}`,
      href: c.next.url,
      external: true,
      completion: { type: "resource", planId: c.planId, resourceId: c.next.resourceId },
    };
  }
  if (c.next.type === "subtopic") {
    return {
      ...base,
      id: `chapter:${c.chapterId}:subtopic:${c.next.index}`,
      title: `Learn: ${c.next.text}`,
      detail: c.chapterTitle,
      href: planHref,
      external: false,
      completion: { type: "subtopic", planId: c.planId, chapterId: c.chapterId, index: c.next.index },
    };
  }
  return {
    ...base,
    id: `chapter:${c.chapterId}:practice`,
    title: `${c.revision ? "Revise" : c.next.pretest ? "Pre-test" : "Test yourself"}: ${c.chapterTitle}`,
    detail: c.next.itemTitle ?? "A quiz for this chapter gets made when you open it",
    ...(c.next.itemId === null ? { generateQuiz: { planId: c.planId, chapterId: c.chapterId } } : {}),
    href: c.next.itemId !== null ? `/items/${c.next.itemId}` : planHref,
    external: false,
    completion: null,
  };
}

// Most urgent first: plans that must get a step today (their Today frequency
// setting asks for one), then the nearest deadline (none last), then today's
// scheduled sessions before unscheduled chapters, then new learning before
// revision of finished chapters, then the course studied
// least recently (never studied first), then the weakest chapter.
export function rankChapters(chapters: ChapterCandidate[]): ChapterCandidate[] {
  return chapters
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        Number(!!b.c.must) - Number(!!a.c.must) ||
        (a.c.deadline ?? "9999-12-31").localeCompare(b.c.deadline ?? "9999-12-31") ||
        Number(!!b.c.session) - Number(!!a.c.session) ||
        Number(!!a.c.revision) - Number(!!b.c.revision) ||
        (a.c.lastStudiedAt ?? "").localeCompare(b.c.lastStudiedAt ?? "") ||
        (a.c.mastery ?? 0.5) - (b.c.mastery ?? 0.5) ||
        a.i - b.i
    )
    .map(({ c }) => c);
}

// Daily coding practice for a chapter: its open code set, or a new one.
function codeStep(c: ChapterCandidate, code: NonNullable<ChapterCandidate["code"]>, minutes: number): TodayStep {
  const params = new URLSearchParams({ chapterId: String(c.chapterId), language: code.language, auto: "1" });
  // A capstone is a project, built in milestones across files.
  if (/capstone/i.test(c.chapterTitle) && PROJECT_LANGUAGES.includes(code.language)) params.set("project", "1");
  return {
    id: `code:chapter:${c.chapterId}`,
    kind: "code",
    title: `Write code: ${c.chapterTitle}`,
    detail: code.setId !== null ? "Pick up your exercises where you left off" : "Fresh exercises for this chapter, written for you",
    minutes,
    href: code.setId !== null ? `/courses/${c.courseId}/code/${code.setId}` : `/courses/${c.courseId}/code?${params}`,
    external: false,
    courseName: c.courseName,
    why: "coding practice — writing code, not just reading it",
    completion: null,
    sessionId: null,
  };
}

// A weak concept from code exercises, practised by writing code again —
// new exercises on it, so it's the skill being tested and not memory of
// one solution.
function rewriteStep(c: WeakConcept, language: CodeLanguage, minutes: number): TodayStep {
  const params = new URLSearchParams({ topic: c.name, language, count: "2", auto: "1" });
  return {
    id: `code:concept:${c.courseId}:${c.name.toLowerCase()}`,
    kind: "code",
    title: `Write it again: ${c.name}`,
    detail: `Your weakest coding concept — about ${Math.round(c.recall * 100)}% recall right now. New exercises, from a blank page.`,
    minutes,
    href: `/courses/${c.courseId}/code?${params}`,
    external: false,
    courseName: c.courseName,
    completion: null,
    sessionId: null,
  };
}

export function planDay(input: TodayInput): TodayStep[] {
  const steps: TodayStep[] = [];
  let left = Math.max(0, Math.round(input.minutes));

  const { dueCards, dueQuestions, newCards } = input.reviews;
  const reviewCount = dueCards + dueQuestions + newCards;
  if (reviewCount > 0 && left > 0) {
    const estimate = Math.max(
      1,
      Math.ceil(
        (dueCards * MINUTES_PER.card + newCards * MINUTES_PER.newCard + dueQuestions * MINUTES_PER.question) *
          REASK_ALLOWANCE
      )
    );
    const minutes = Math.min(estimate, left);
    left -= minutes;
    const parts = [
      dueCards + dueQuestions > 0 ? `${dueCards + dueQuestions} due` : null,
      newCards > 0 ? `${newCards} new` : null,
    ].filter(Boolean);
    steps.push({
      id: "reviews",
      kind: "reviews",
      title: `Review ${plural(reviewCount, "item")}`,
      detail: `${parts.join(", ")} — cards and quiz questions, mixed`,
      minutes,
      href: withCourse("/review", input.courseId),
      external: false,
      courseName: null,
      completion: null,
      sessionId: null,
    });
  }

  if (input.mistakes.sure > 0 && left > 0) {
    const minutes = Math.min(Math.ceil(input.mistakes.sure * MINUTES_PER.mistake), MAX_MISTAKE_MINUTES, left);
    left -= minutes;
    steps.push({
      id: "mistakes",
      kind: "mistakes",
      title: `Redo ${plural(input.mistakes.sure, "answer")} you were sure about`,
      detail: "Confident mistakes are the ones that stick — fix them first",
      minutes,
      href: withCourse("/review", input.courseId, { mode: "mistakes" }),
      external: false,
      courseName: null,
      completion: null,
      sessionId: null,
    });
  }

  for (const exam of input.mockExams ?? []) {
    if (left < MIN_MOCK_EXAM_MINUTES) break;
    const minutes = Math.min(exam.minutes, left);
    left -= minutes;
    steps.push({
      id: `exam:${exam.courseId}`,
      kind: "exam",
      title: `Take a mock exam — ${plural(exam.daysLeft, "day")} to go`,
      detail: "Under exam conditions: timed, no notes",
      minutes,
      href: `/courses/${exam.courseId}/exams`,
      external: false,
      courseName: exam.courseName,
      completion: null,
      sessionId: null,
    });
  }

  // Chapters share what's left after reserving a slot for a weak concept:
  // each asks for its session's minutes, and when they don't all fit every
  // one is scaled down (never below the minimum) rather than the first
  // taking everything.
  const maxSteps =
    input.maxChapterSteps ?? (left >= THREE_CHAPTER_MINUTES ? MAX_CHAPTER_STEPS + 1 : MAX_CHAPTER_STEPS);
  // Today's coding practice: the best-ranked chapter of a programming plan.
  const codeChapter = rankChapters(input.chapters).find((c) => c.code && !c.skipCode);
  const codeReserve = codeChapter && left >= CODE_RESERVE_FROM_MINUTES ? CODE_MINUTES : 0;
  const reserve =
    (input.weakConcepts.length > 0 && left >= CONCEPT_RESERVE_FROM_MINUTES ? CONCEPT_MINUTES : 0) + codeReserve;
  const available = left - reserve;
  const chosen: { candidate: ChapterCandidate; wanted: number }[] = [];
  const ranked = rankChapters(input.chapters);
  // Plans that must get a step today keep their slots even past the usual limit.
  const slots = input.maxChapterSteps === undefined ? Math.max(maxSteps, Math.min(ranked.filter((c) => c.must).length, MAX_MUST_STEPS)) : maxSteps;
  for (const candidate of ranked.slice(0, slots)) {
    if ((chosen.length + 1) * MIN_CHAPTER_STEP_MINUTES > available) break;
    chosen.push({
      candidate,
      wanted: Math.max(candidate.session?.minutes ?? DEFAULT_CHAPTER_STEP_MINUTES, MIN_CHAPTER_STEP_MINUTES),
    });
  }
  const wantedTotal = chosen.reduce((n, c) => n + c.wanted, 0);
  const factor = wantedTotal > available ? available / wantedTotal : 1;
  let room = available;
  chosen.forEach(({ candidate, wanted }, i) => {
    const keepForRest = MIN_CHAPTER_STEP_MINUTES * (chosen.length - 1 - i);
    const minutes = Math.max(MIN_CHAPTER_STEP_MINUTES, Math.min(Math.floor(wanted * factor), room - keepForRest));
    room -= minutes;
    left -= minutes;
    steps.push(chapterStep(candidate, minutes));
  });

  if (codeChapter?.code && left >= MIN_CODE_MINUTES) {
    const minutes = Math.min(CODE_MINUTES, left);
    left -= minutes;
    steps.push(codeStep(codeChapter, codeChapter.code, minutes));
  }

  for (const c of input.weakConcepts.slice(0, input.examMode ? 2 : 1)) {
    if (left < MIN_CONCEPT_MINUTES) break;
    const minutes = Math.min(CONCEPT_MINUTES, left);
    left -= minutes;
    if (c.codeLanguage) {
      steps.push(rewriteStep(c, c.codeLanguage, minutes));
      continue;
    }
    steps.push({
      id: `concept:${c.courseId}:${c.name.toLowerCase()}`,
      kind: "concept",
      title: `Strengthen: ${c.name}`,
      detail: `Your weakest concept — about ${Math.round(c.recall * 100)}% recall right now`,
      minutes,
      href: `/review?${new URLSearchParams({ courseId: String(c.courseId), mode: "concept", concept: c.name })}`,
      external: false,
      courseName: c.courseName,
      completion: null,
      sessionId: null,
    });
  }
  return steps;
}

interface ChapterLike {
  subtopics: { text: string; done: boolean }[];
  resources: { id: number; position: number; kind: string; title: string; url: string; provider: string | null; link_status: string; done_at: string | null }[];
  items: { id: number; mode: string; title: string; best_score: number | null }[];
}

// What to do next in a chapter: the next unfinished resource in study
// order, then the next unchecked subtopic, then testing yourself. A review
// session skips straight to testing.
export function nextChapterStep(
  chapter: ChapterLike,
  reviewSession = false,
  options: { pretest?: boolean; revision?: boolean } = {}
): ChapterNextStep {
  // A chapter not started yet, with a pre-test made and not taken: that first.
  const untouched = !chapter.subtopics.some((s) => s.done) && !chapter.resources.some((r) => r.done_at);
  if (options.pretest && !reviewSession && untouched) {
    const pretest = chapter.items.find((i) => i.mode === "quiz" && i.best_score === null);
    if (pretest) return { type: "practice", itemId: pretest.id, itemTitle: pretest.title, pretest: true };
  }
  if (!reviewSession) {
    const resource = [...chapter.resources]
      .sort((a, b) => a.position - b.position)
      .find((r) => !r.done_at && r.link_status !== "dead" && r.link_status !== "blocked");
    if (resource) {
      return {
        type: "resource",
        resourceId: resource.id,
        title: resource.title,
        kind: resource.kind,
        url: resource.url,
        provider: resource.provider,
      };
    }
    const index = chapter.subtopics.findIndex((s) => !s.done);
    if (index !== -1) return { type: "subtopic", index, text: chapter.subtopics[index].text };
  }
  // The quiz you've done worst on (or never finished), else flashcards.
  const quizzes = chapter.items
    .filter((i) => i.mode === "quiz")
    .sort((a, b) => (a.best_score ?? -1) - (b.best_score ?? -1));
  // Revision of a chapter whose quizzes are all aced asks for a fresh one:
  // repeating the same questions tests memory of the answers.
  if (options.revision && quizzes.length > 0 && (quizzes[0].best_score ?? -1) >= REVISION_FRESH_QUIZ_SCORE) {
    return { type: "practice", itemId: null, itemTitle: null };
  }
  const item = quizzes[0] ?? chapter.items.find((i) => i.mode === "flashcards") ?? null;
  return { type: "practice", itemId: item?.id ?? null, itemTitle: item?.title ?? null };
}
