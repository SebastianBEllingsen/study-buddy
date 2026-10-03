import { describe, expect, it } from "vitest";
import { chapterWhy, nextChapterStep, planDay, rankChapters, type ChapterCandidate, type TodayInput } from "./planDay";

const none: TodayInput = {
  minutes: 45,
  courseId: null,
  reviews: { dueCards: 0, dueQuestions: 0, newCards: 0 },
  mistakes: { sure: 0, total: 0 },
  chapters: [],
  weakConcepts: [],
};

const chapter = (id: number, overrides: Partial<ChapterCandidate> = {}): ChapterCandidate => ({
  planId: 1,
  courseId: 2,
  courseName: "Sample Course",
  chapterId: id,
  chapterTitle: `Chapter ${id}`,
  session: null,
  next: { type: "resource", resourceId: 9, title: "Intro lecture", kind: "video", url: "https://example.com/v", provider: "Example" },
  ...overrides,
});

describe("planDay", () => {
  it("is empty when there's nothing to do", () => {
    expect(planDay(none)).toEqual([]);
  });

  it("orders reviews, confident mistakes, the chapter step, then a weak concept", () => {
    const steps = planDay({
      ...none,
      minutes: 60,
      reviews: { dueCards: 20, dueQuestions: 4, newCards: 10 },
      mistakes: { sure: 3, total: 7 },
      chapters: [chapter(5)],
      weakConcepts: [{ courseId: 2, courseName: "Sample Course", name: "Recursion", recall: 0.31 }],
    });
    expect(steps.map((s) => s.kind)).toEqual(["reviews", "mistakes", "chapter", "concept"]);
    // 20*0.25 + 10*0.5 + 4*1 = 14
    expect(steps[0]).toMatchObject({ minutes: 14, title: "Review 34 items", href: "/review" });
    expect(steps[1]).toMatchObject({ minutes: 5, href: "/review?mode=mistakes" });
    expect(steps[2]).toMatchObject({
      title: "Watch: Intro lecture",
      external: true,
      minutes: 25,
      completion: { type: "resource", planId: 1, resourceId: 9 },
    });
    expect(steps[3]).toMatchObject({ minutes: 10, title: "Strengthen: Recursion" });
    expect(steps[3].href).toBe("/review?courseId=2&mode=concept&concept=Recursion");
    expect(steps.reduce((n, s) => n + s.minutes, 0)).toBeLessThanOrEqual(60);
  });

  it("gives reviews the whole budget when they need it and drops the rest", () => {
    const steps = planDay({ ...none, minutes: 15, reviews: { dueCards: 200, dueQuestions: 0, newCards: 0 }, chapters: [chapter(1)] });
    expect(steps).toHaveLength(1);
    expect(steps[0].minutes).toBe(15);
  });

  it("sizes a chapter step to today's scheduled session and links the session", () => {
    const steps = planDay({ ...none, minutes: 90, chapters: [chapter(3, { session: { id: 44, minutes: 40 } })] });
    expect(steps[0]).toMatchObject({ minutes: 40, sessionId: { planId: 1, sessionId: 44 } });
  });

  it("scopes review links to a course", () => {
    const steps = planDay({ ...none, courseId: 7, reviews: { dueCards: 1, dueQuestions: 0, newCards: 0 }, mistakes: { sure: 1, total: 1 } });
    expect(steps.map((s) => s.href)).toEqual(["/review?courseId=7", "/review?mode=mistakes&courseId=7"]);
  });

  it("describes subtopic and practice steps", () => {
    const [sub, practice] = planDay({
      ...none,
      minutes: 60,
      chapters: [
        chapter(1, { next: { type: "subtopic", index: 2, text: "Bayes' rule" } }),
        chapter(2, { next: { type: "practice", itemId: null, itemTitle: null } }),
      ],
    });
    expect(sub).toMatchObject({
      title: "Learn: Bayes' rule",
      href: "/courses/2/plan#chapter-1",
      completion: { type: "subtopic", chapterId: 1, index: 2 },
    });
    expect(practice).toMatchObject({ title: "Test yourself: Chapter 2", completion: null, href: "/courses/2/plan#chapter-2" });
  });
});

describe("nextChapterStep", () => {
  const resource = (id: number, position: number, extra = {}) => ({
    id,
    position,
    kind: "article",
    title: `R${id}`,
    url: `https://example.com/${id}`,
    provider: null,
    link_status: "ok",
    done_at: null,
    ...extra,
  });

  it("takes the next unfinished, working resource in study order", () => {
    const step = nextChapterStep({
      subtopics: [{ text: "A", done: false }],
      resources: [resource(1, 2), resource(2, 0, { done_at: "x" }), resource(3, 1, { link_status: "dead" })],
      items: [],
    });
    expect(step).toMatchObject({ type: "resource", resourceId: 1 });
  });

  it("falls back to the next unchecked subtopic, then the weakest quiz", () => {
    expect(nextChapterStep({ subtopics: [{ text: "A", done: true }, { text: "B", done: false }], resources: [], items: [] })).toEqual({
      type: "subtopic",
      index: 1,
      text: "B",
    });
    const items = [
      { id: 1, mode: "flashcards", title: "Cards", best_score: null },
      { id: 2, mode: "quiz", title: "Quiz A", best_score: 90 },
      { id: 3, mode: "quiz", title: "Quiz B", best_score: 40 },
    ];
    expect(nextChapterStep({ subtopics: [], resources: [], items })).toEqual({ type: "practice", itemId: 3, itemTitle: "Quiz B" });
    expect(nextChapterStep({ subtopics: [], resources: [], items: [] })).toEqual({ type: "practice", itemId: null, itemTitle: null });
  });

  it("goes straight to practice for a review session", () => {
    expect(nextChapterStep({ subtopics: [{ text: "A", done: false }], resources: [resource(1, 0)], items: [] }, true)).toMatchObject({
      type: "practice",
    });
  });
});

describe("planDay in exam mode", () => {
  it("puts a due mock exam before the chapter step and practises two weak concepts", () => {
    const steps = planDay({
      ...none,
      minutes: 200,
      examMode: true,
      reviews: { dueCards: 4, dueQuestions: 0, newCards: 0 },
      mockExams: [{ courseId: 2, courseName: "Sample Course", daysLeft: 7, minutes: 120 }],
      chapters: [chapter(1)],
      weakConcepts: [
        { courseId: 2, courseName: "Sample Course", name: "A", recall: 0.2 },
        { courseId: 2, courseName: "Sample Course", name: "B", recall: 0.3 },
        { courseId: 2, courseName: "Sample Course", name: "C", recall: 0.4 },
      ],
    });
    expect(steps.map((s) => s.kind)).toEqual(["reviews", "exam", "chapter", "concept", "concept"]);
    expect(steps[1]).toMatchObject({ title: "Take a mock exam — 7 days to go", minutes: 120, href: "/courses/2/exams" });
  });

  it("skips a mock exam when there isn't time for one", () => {
    const steps = planDay({ ...none, minutes: 20, mockExams: [{ courseId: 2, courseName: "S", daysLeft: 3, minutes: 90 }] });
    expect(steps).toEqual([]);
  });
});

describe("planDay across courses", () => {
  it("ranks by nearest deadline, then scheduled, then weakest", () => {
    const ranked = rankChapters([
      chapter(1, { deadline: null }),
      chapter(2, { deadline: "2026-03-01", mastery: 0.9 }),
      chapter(3, { deadline: "2026-02-01" }),
      chapter(4, { deadline: "2026-03-01", mastery: 0.2 }),
      chapter(5, { deadline: "2026-03-01", mastery: 0.9, session: { id: 1, minutes: 30 } }),
    ]);
    expect(ranked.map((c) => c.chapterId)).toEqual([3, 5, 4, 2, 1]);
  });

  it("shares the time between chapters instead of the first taking it all", () => {
    const steps = planDay({
      ...none,
      minutes: 60,
      chapters: [
        chapter(1, { session: { id: 1, minutes: 60 } }),
        chapter(2, { courseId: 3, session: { id: 2, minutes: 60 } }),
      ],
    });
    expect(steps.map((s) => s.minutes)).toEqual([30, 30]);
  });

  it("takes on as many chapters as were picked, not the usual two", () => {
    const chapters = [1, 2, 3, 4].map((id) => chapter(id, { courseId: id }));
    expect(planDay({ ...none, minutes: 60, chapters }).filter((s) => s.kind === "chapter")).toHaveLength(2);
    const picked = planDay({ ...none, minutes: 60, chapters, maxChapterSteps: 4 }).filter((s) => s.kind === "chapter");
    expect(picked).toHaveLength(4);
    expect(picked.reduce((n, s) => n + s.minutes, 0)).toBeLessThanOrEqual(60);
  });

  it("keeps a slot for a weak concept when there's time for both", () => {
    const steps = planDay({
      ...none,
      minutes: 60,
      chapters: [chapter(1, { session: { id: 1, minutes: 90 } })],
      weakConcepts: [{ courseId: 2, courseName: "Sample Course", name: "Recursion", recall: 0.3 }],
    });
    expect(steps.map((s) => [s.kind, s.minutes])).toEqual([
      ["chapter", 50],
      ["concept", 10],
    ]);
  });

  it("mixes in a third chapter only with lots of time", () => {
    const chapters = [1, 2, 3].map((i) => chapter(i, { courseId: i }));
    expect(planDay({ ...none, minutes: 60, chapters }).filter((s) => s.kind === "chapter")).toHaveLength(2);
    expect(planDay({ ...none, minutes: 120, chapters }).filter((s) => s.kind === "chapter")).toHaveLength(3);
  });
});

describe("chapterWhy", () => {
  it("says what makes a chapter today's pick", () => {
    expect(chapterWhy(chapter(1, { daysLeft: 12, mastery: 0.3 }))).toBe("12 days to your finish date · a weak spot");
    expect(chapterWhy(chapter(1, { awaitingCheck: true }))).toBe("passing it unlocks the next chapter");
    expect(chapterWhy(chapter(1, { session: { id: 1, minutes: 30 } }))).toBe("on today's plan");
    expect(chapterWhy(chapter(1))).toBe("next in your roadmap");
  });
});

describe("test-yourself step", () => {
  it("asks for the quiz to be made when the chapter has none, and links the existing one otherwise", () => {
    const none = planDay({ ...baseInput(), chapters: [chapter(4, { next: { type: "practice", itemId: null, itemTitle: null } })] });
    expect(none[0].generateQuiz).toEqual({ planId: 1, chapterId: 4 });
    const some = planDay({ ...baseInput(), chapters: [chapter(4, { next: { type: "practice", itemId: 8, itemTitle: "Quiz" } })] });
    expect(some[0].generateQuiz).toBeUndefined();
    expect(some[0].href).toBe("/items/8");
  });
});

function baseInput(): TodayInput {
  return { ...none, minutes: 45 };
}

describe("pre-test step", () => {
  const untouched = {
    subtopics: [{ text: "a", done: false }],
    resources: [],
    items: [
      { id: 7, mode: "quiz", title: "Pre-test quiz", best_score: null },
      { id: 8, mode: "flashcards", title: "Cards", best_score: null },
    ],
  };

  it("sends an unstarted chapter to its untaken quiz first, only when pre-tests are on", () => {
    expect(nextChapterStep(untouched, false, { pretest: true })).toEqual({
      type: "practice",
      itemId: 7,
      itemTitle: "Pre-test quiz",
      pretest: true,
    });
    expect(nextChapterStep(untouched).type).toBe("subtopic");
  });

  it("goes back to studying once the quiz is taken or the chapter is under way", () => {
    const taken = { ...untouched, items: [{ id: 7, mode: "quiz", title: "Q", best_score: 40 }] };
    expect(nextChapterStep(taken, false, { pretest: true }).type).toBe("subtopic");
    const started = { ...untouched, subtopics: [{ text: "a", done: true }, { text: "b", done: false }] };
    expect(nextChapterStep(started, false, { pretest: true }).type).toBe("subtopic");
  });

  it("titles the step as a pre-test", () => {
    const [step] = planDay({
      ...none,
      chapters: [chapter(2, { next: { type: "practice", itemId: 7, itemTitle: "Pre-test quiz", pretest: true } })],
    });
    expect(step.title).toBe("Pre-test: Chapter 2");
    expect(step.href).toBe("/items/7");
  });
});
