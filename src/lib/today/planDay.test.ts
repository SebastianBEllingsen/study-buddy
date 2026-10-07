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
    // (20 cards * 0.25 + 10 new * 0.5 + 4 questions * 1.5) * 1.25 for re-asks = 20
    expect(steps[0]).toMatchObject({ minutes: 20, title: "Review 34 items", href: "/review" });
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

  it("budgets questions at a typed answer each, plus time for what gets asked again", () => {
    // 21 questions, as measured: 21 * 1.5 = 31.5, * 1.25 = 39.4 → 40 (it took 34 in practice).
    const [step] = planDay({ ...none, minutes: 90, reviews: { dueCards: 0, dueQuestions: 21, newCards: 0 } });
    expect(step.minutes).toBe(40);
    // Cards stay quick: 40 cards * 0.25 * 1.25 = 12.5 → 13.
    expect(planDay({ ...none, minutes: 90, reviews: { dueCards: 40, dueQuestions: 0, newCards: 0 } })[0].minutes).toBe(13);
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

  it("gives the course studied least recently (or never) its turn before the weakest one", () => {
    const ranked = rankChapters([
      chapter(1, { lastStudiedAt: "2026-03-01 10:00:00", mastery: 0.1 }),
      chapter(2, { lastStudiedAt: "2026-02-20 10:00:00", mastery: 0.9 }),
      chapter(3, { lastStudiedAt: null, mastery: 0.9 }),
    ]);
    expect(ranked.map((c) => c.chapterId)).toEqual([3, 2, 1]);
  });

  it("still puts a deadline and a scheduled session ahead of recency", () => {
    const ranked = rankChapters([
      chapter(1, { lastStudiedAt: null }),
      chapter(2, { lastStudiedAt: "2026-03-01 10:00:00", session: { id: 1, minutes: 30 } }),
      chapter(3, { lastStudiedAt: "2026-03-01 10:00:00", deadline: "2026-04-01" }),
    ]);
    expect(ranked.map((c) => c.chapterId)).toEqual([3, 2, 1]);
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

describe("coding practice on a programming plan", () => {
  const coding = (id: number, setId: number | null = null) => chapter(id, { code: { language: "cpp", setId } });

  it("adds a daily write-code step after the chapter step, for the same chapter", () => {
    const steps = planDay({ ...none, minutes: 60, chapters: [coding(5)] });
    expect(steps.map((s) => s.kind)).toEqual(["chapter", "code"]);
    expect(steps[1]).toMatchObject({
      id: "code:chapter:5",
      title: "Write code: Chapter 5",
      minutes: 20,
      href: "/courses/2/code?chapterId=5&language=cpp&auto=1",
    });
    expect(steps.reduce((n, s) => n + s.minutes, 0)).toBeLessThanOrEqual(60);
  });

  it("opens a capstone chapter as a project", () => {
    const steps = planDay({ ...none, minutes: 60, chapters: [{ ...coding(9), chapterTitle: "Capstone projects" }] });
    expect(steps.find((s) => s.kind === "code")?.href).toBe("/courses/2/code?chapterId=9&language=cpp&auto=1&project=1");
  });

  it("picks up the chapter's open code set instead of starting a new one", () => {
    const steps = planDay({ ...none, minutes: 60, chapters: [coding(5, 31)] });
    expect(steps.find((s) => s.kind === "code")?.href).toBe("/courses/2/code/31");
  });

  it("keeps the coding slot when time is short, and never adds one on other plans", () => {
    const tight = planDay({ ...none, minutes: 45, chapters: [coding(5)] });
    expect(tight.find((s) => s.kind === "code")?.minutes).toBeGreaterThanOrEqual(10);
    expect(tight.reduce((n, s) => n + s.minutes, 0)).toBeLessThanOrEqual(45);
    expect(planDay({ ...none, minutes: 60, chapters: [chapter(5)] }).some((s) => s.kind === "code")).toBe(false);
  });

  it("brings a weak code concept back as new exercises to write, not a quiz", () => {
    const steps = planDay({
      ...none,
      minutes: 60,
      weakConcepts: [{ courseId: 2, courseName: "Sample Course", name: "Move semantics", recall: 0.4, codeLanguage: "cpp" }],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "code", title: "Write it again: Move semantics" });
    expect(steps[0].href).toBe("/courses/2/code?topic=Move+semantics&language=cpp&count=2&auto=1");
  });

  it("leaves a weak concept from anywhere else as an ordinary review step", () => {
    const [step] = planDay({
      ...none,
      weakConcepts: [{ courseId: 2, courseName: "Sample Course", name: "Entropy", recall: 0.4 }],
    });
    expect(step.kind).toBe("concept");
  });
});

describe("plans with a Today frequency", () => {
  const plain = (id: number, over: Partial<ChapterCandidate> = {}) => chapter(id, { courseId: id, courseName: `Course ${id}`, ...over });
  const must = (id: number, reason = "your every-day plan") => plain(id, { must: reason });

  it("puts a plan that must get a step ahead of an earlier deadline", () => {
    const ranked = rankChapters([plain(1, { deadline: "2026-11-01" }), must(2)]);
    expect(ranked.map((c) => c.chapterId)).toEqual([2, 1]);
  });

  it("orders several that must get a step the usual way among themselves", () => {
    const ranked = rankChapters([must(1), must(2, "1 of 3 study days in the last week"), plain(3)].map((c, i) => ({ ...c, lastStudiedAt: i === 0 ? "2026-10-06 10:00:00" : null })));
    expect(ranked.map((c) => c.chapterId)).toEqual([2, 1, 3]);
  });

  it("gives it a slot even when the usual limit is already taken", () => {
    // Two plain chapters would fill the two slots; the third must get one too.
    const steps = planDay({ ...none, minutes: 90, chapters: [plain(1), plain(2), must(3)] });
    expect(steps.filter((s) => s.kind === "chapter").map((s) => s.id.split(":")[1])).toEqual(["3", "1", "2"]);
  });

  it("never gives it more than three slots, however many ask", () => {
    const steps = planDay({ ...none, minutes: 120, chapters: [must(1), must(2), must(3), must(4), plain(5)] });
    expect(steps.filter((s) => s.kind === "chapter")).toHaveLength(3);
  });

  it("says why it is there", () => {
    const [step] = planDay({ ...none, chapters: [must(1, "1 of 3 study days in the last week")] });
    expect(step.why).toBe("1 of 3 study days in the last week");
  });

  it("leaves a hand-picked set of chapters as picked", () => {
    const steps = planDay({ ...none, minutes: 90, maxChapterSteps: 1, chapters: [plain(1), must(2)] });
    expect(steps.filter((s) => s.kind === "chapter")).toHaveLength(1);
  });

  it("puts a programming plan's coding step with its chapter step when it must get one", () => {
    const code = { language: "cpp" as const, setId: null };
    const steps = planDay({ ...none, minutes: 60, chapters: [plain(1), plain(2, { code, must: "your every-day plan" })] });
    expect(steps.find((s) => s.kind === "code")?.id).toBe("code:chapter:2");
  });
});

