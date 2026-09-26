// The "Today" autopilot: turns everything that wants the learner's time
// into one ordered list of steps that fits the minutes they have. Pure and
// client-safe — lib/today/loadToday.ts gathers the inputs.
//
// Order (the research-backed priority):
//  1. due reviews — spaced retrieval is the highest-value minute there is
//  2. mistakes you were sure about — confident errors are the ones that stick
//  3. a mock exam, when exam mode says one is due (lib/readiness/examMode.ts)
//  4. the next step of the current study plan chapter (none in an exam's
//     final days)
//  5. one weak concept, if time is left — two in exam mode, for more
//     mixed practice

export type TodayStepKind = "reviews" | "mistakes" | "exam" | "chapter" | "concept";

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
  completion: StepCompletion | null;
  // The plan session this step belongs to, marked done when the day's
  // session is finished.
  sessionId: { planId: number; sessionId: number } | null;
}

export type ChapterNextStep =
  | { type: "resource"; resourceId: number; title: string; kind: string; url: string; provider: string | null }
  | { type: "subtopic"; index: number; text: string }
  | { type: "practice"; itemId: number | null; itemTitle: string | null };

export interface ChapterCandidate {
  planId: number;
  courseId: number;
  courseName: string;
  chapterId: number;
  chapterTitle: string;
  // Today's scheduled session for this chapter, if the plan has a schedule.
  session: { id: number; minutes: number } | null;
  next: ChapterNextStep;
}

export interface WeakConcept {
  courseId: number;
  courseName: string;
  name: string;
  recall: number;
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
}

// Rough minutes per item, for fitting steps into the budget.
export const MINUTES_PER = { card: 0.25, newCard: 0.5, question: 1, mistake: 1.5 };
export const MAX_MISTAKE_MINUTES = 15;
export const DEFAULT_CHAPTER_STEP_MINUTES = 25;
export const MIN_CHAPTER_STEP_MINUTES = 10;
export const CONCEPT_MINUTES = 10;
export const MIN_CONCEPT_MINUTES = 5;
export const MAX_CHAPTER_STEPS = 2;
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

function chapterStep(c: ChapterCandidate, minutes: number): TodayStep {
  const planHref = `/courses/${c.courseId}/plan#chapter-${c.chapterId}`;
  const base = {
    kind: "chapter" as const,
    minutes,
    courseName: c.courseName,
    sessionId: c.session ? { planId: c.planId, sessionId: c.session.id } : null,
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
    title: `Test yourself: ${c.chapterTitle}`,
    detail: c.next.itemTitle ?? "Make a quiz for this chapter from its plan page",
    href: c.next.itemId !== null ? `/items/${c.next.itemId}` : planHref,
    external: false,
    completion: null,
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
      Math.ceil(dueCards * MINUTES_PER.card + newCards * MINUTES_PER.newCard + dueQuestions * MINUTES_PER.question)
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

  for (const candidate of input.chapters.slice(0, MAX_CHAPTER_STEPS)) {
    if (left < MIN_CHAPTER_STEP_MINUTES) break;
    const wanted = candidate.session?.minutes ?? DEFAULT_CHAPTER_STEP_MINUTES;
    const minutes = Math.min(Math.max(wanted, MIN_CHAPTER_STEP_MINUTES), left);
    left -= minutes;
    steps.push(chapterStep(candidate, minutes));
  }

  for (const c of input.weakConcepts.slice(0, input.examMode ? 2 : 1)) {
    if (left < MIN_CONCEPT_MINUTES) break;
    const minutes = Math.min(CONCEPT_MINUTES, left);
    left -= minutes;
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
export function nextChapterStep(chapter: ChapterLike, reviewSession = false): ChapterNextStep {
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
  const item = quizzes[0] ?? chapter.items.find((i) => i.mode === "flashcards") ?? null;
  return { type: "practice", itemId: item?.id ?? null, itemTitle: item?.title ?? null };
}
