import { describe, it, expect, vi } from "vitest";
import type { TestDb } from "../db/testHarness";

let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});
vi.mock("../googleCalendar", () => ({ createEvent: vi.fn(), deleteEvent: vi.fn() }));

const { createCourse, createGeneratedItem } = await import("../models");
const store = await import("../studyPlan/store");
const { DEFAULT_STUDY_PLAN_OPTIONS } = await import("../studyPlan/options");
const { localToday } = await import("../studyPlan/schedule");
const { loadToday, chapterCandidates, openChapters } = await import("./loadToday");
const { completeStep, parseCompletion, actualMinutes } = await import("./complete");
const { recordQuizAnswers } = await import("../review/answers");
const { setExamDate } = await import("../readiness/load");
const { saveExamProfile } = await import("../exams/store");

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localToday(d);
}

function newChapter(title: string, overrides: Partial<import("../studyPlan/store").NewChapter> = {}) {
  return {
    title,
    summary: "",
    subtopics: ["First idea", "Second idea"],
    prerequisites: [],
    stage: 1,
    linked_document_ids: [],
    estimated_minutes: 60,
    resources: [],
    ...overrides,
  };
}

async function makePlan(courseId: number, options = DEFAULT_STUDY_PLAN_OPTIONS) {
  return store.replaceStudyPlan({
    courseId,
    title: "Sample plan",
    status: "ready",
    options,
    syllabusDocumentId: null,
    syllabusText: null,
    sourceDocumentIds: [],
    sourceFolderId: null,
    sourceHandpicked: false,
    language: "en",
    modelProvider: "api",
    modelName: "test-model",
    usedWebSearch: false,
    linksCheckedAt: null,
    chapters: [
      newChapter("Foundations", {
        resources: [
          {
            kind: "video",
            title: "Intro lecture",
            url: "https://example.com/intro",
            provider: "Example",
            language: "en",
            note: "",
            origin: "ai",
            link_status: "ok",
            status_detail: null,
            checked_at: null,
          },
        ],
      }),
      newChapter("Next steps", { stage: 2 }),
    ],
  });
}

describe("loadToday", () => {
  it("plans reviews, confident mistakes and the plan's next step for a course", async () => {
    const course = await createCourse("Sample Course");
    const plan = await makePlan(course.id);
    const quiz = await createGeneratedItem({
      courseId: course.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "quiz",
      title: "Sample quiz",
      contentJson: { questions: [{ type: "mcq", question: "Q", options: ["a", "b"], correctIndex: 0, explanation: "e" }] },
      sourceDocumentIds: [],
    });
    await recordQuizAnswers({
      item: quiz,
      source: "quiz",
      now: new Date(Date.now() - 5 * 86_400_000),
      entries: [
        {
          question: { type: "mcq", question: "Q", options: ["a", "b"], correctIndex: 0, explanation: "e" },
          answer: 1,
          confidence: "sure",
          result: { index: 0, type: "mcq", correct: false, feedback: "", explanation: "e", correctAnswer: "a" },
        },
      ],
    });

    const today = await loadToday({ courseId: course.id, minutes: 60 });
    expect(today.steps.map((s) => s.kind)).toEqual(["reviews", "mistakes", "chapter"]);
    expect(today.steps[0].title).toBe("Review 1 item");
    expect(today.steps[2]).toMatchObject({
      title: "Watch: Intro lecture",
      completion: { type: "resource", planId: plan.id, resourceId: plan.chapters[0].resources[0].id },
    });
  });

  it("absorbs missed scheduled days by rebuilding the schedule from today", async () => {
    const course = await createCourse("Sample Course");
    const plan = await makePlan(course.id, {
      ...DEFAULT_STUDY_PLAN_OPTIONS,
      schedule: true,
      studyDays: [0, 1, 2, 3, 4, 5, 6],
      minutesPerDay: 60,
    });
    await store.replaceOpenSessions(plan.id, [
      { chapterId: plan.chapters[0].id, date: "2020-01-01", minutes: 60, kind: "study" },
    ]);

    const result = await loadToday({ courseId: course.id });

    const sessions = (await store.getStudyPlan(plan.id))!.sessions;
    expect(sessions.some((s) => s.date === "2020-01-01")).toBe(false);
    expect(sessions.some((s) => s.date === localToday())).toBe(true);
    const chapterStep = result.steps.find((s) => s.kind === "chapter");
    expect(chapterStep?.sessionId?.planId).toBe(plan.id);
    expect(result.minutes).toBeGreaterThanOrEqual(60);
  });
});

describe("loadToday weak concepts", () => {
  it("doesn't suggest practising a concept you already recall well", async () => {
    const course = await createCourse("Sample Course");
    const deck = await createGeneratedItem({
      courseId: course.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: "Sample flashcards",
      contentJson: {
        cards: [
          { front: "a", back: "b", concept: "Known well" },
          { front: "c", back: "d", concept: "Known well" },
          { front: "e", back: "f", concept: "Shaky" },
          { front: "g", back: "h", concept: "Shaky" },
        ],
      },
      sourceDocumentIds: [],
    });
    const { recordCardAnswer } = await import("../review/answers");
    const cards = JSON.parse(deck.content_json).cards;
    const now = new Date();
    for (const [i, result] of [[0, "easy"], [1, "easy"], [2, "again"], [3, "again"]] as const) {
      await recordCardAnswer({ item: deck, card: cards[i], cardIndex: i, result, confidence: null, source: "deck", now: new Date(now.getTime() - 20 * 86_400_000) });
    }
    const today = await loadToday({ courseId: course.id, minutes: 120 });
    const concepts = today.steps.filter((s) => s.kind === "concept").map((s) => s.title);
    expect(concepts).toEqual(["Strengthen: Shaky"]);
  });
});

describe("loadToday in exam mode", () => {
  it("adds a due mock exam and drops new chapters in the final days", async () => {
    const course = await createCourse("Sample Course");
    await makePlan(course.id);
    await saveExamProfile({
      courseId: course.id,
      sourceDocumentIds: [],
      profile: { examCount: 1, durationMinutes: 90, totalPoints: 50, style: "", language: "English", topics: [{ concept: "A", share: 1 }], tasks: [] },
      model: null,
    });

    await setExamDate(course.id, inDays(7));
    let today = await loadToday({ courseId: course.id, minutes: 180 });
    expect(today.steps.map((s) => s.kind)).toEqual(["exam", "chapter"]);
    expect(today.steps[0]).toMatchObject({ minutes: 90, title: "Take a mock exam — 7 days to go" });

    await setExamDate(course.id, inDays(2));
    today = await loadToday({ courseId: course.id, minutes: 180 });
    expect(today.steps.map((s) => s.kind)).toEqual(["exam"]);

    await setExamDate(course.id, null);
    today = await loadToday({ courseId: course.id, minutes: 180 });
    expect(today.steps.map((s) => s.kind)).toEqual(["chapter"]);
  });
});

describe("chapterCandidates", () => {
  it("puts today's scheduled sessions before unscheduled plans' next chapters, and skips finished plans", async () => {
    const a = await makePlan((await createCourse("A")).id, { ...DEFAULT_STUDY_PLAN_OPTIONS, schedule: true });
    const b = await makePlan((await createCourse("B")).id);
    const today = "2026-03-02";
    const scheduled = {
      ...a,
      sessions: [
        { id: 1, plan_id: a.id, chapter_id: a.chapters[1].id, date: today, minutes: 30, kind: "review" as const, done_at: null, google_event_id: null },
        { id: 2, plan_id: a.id, chapter_id: a.chapters[0].id, date: "2026-03-03", minutes: 30, kind: "study" as const, done_at: null, google_event_id: null },
      ],
    };
    const finished = { ...b, chapters: b.chapters.map((c) => ({ ...c, completed_at: "2026-01-01 00:00:00" })) };
    const names = new Map([[a.course_id, "A"]]);
    const candidates = chapterCandidates([b, scheduled, finished], names, today);
    expect(candidates.map((c) => [c.planId, c.chapterTitle, c.next.type])).toEqual([
      [a.id, "Next steps", "practice"],
      [b.id, "Foundations", "resource"],
    ]);
  });
});

describe("picking chapters", () => {
  it("offers exactly the picked chapters, scheduled today or not, and lists the open ones", async () => {
    const plan = await makePlan((await createCourse("A")).id, { ...DEFAULT_STUDY_PLAN_OPTIONS, schedule: true });
    const today = "2026-03-02";
    const [first, second] = plan.chapters;
    const scheduled = {
      ...plan,
      sessions: [
        { id: 1, plan_id: plan.id, chapter_id: first.id, date: today, minutes: 30, kind: "study" as const, done_at: null, google_event_id: null },
      ],
    };
    const names = new Map([[plan.course_id, "A"]]);

    // Only the second chapter picked: it isn't scheduled today, and still shows up.
    const picked = chapterCandidates([scheduled], names, today, new Set([second.id]));
    expect(picked.map((c) => [c.chapterId, c.session])).toEqual([[second.id, null]]);
    // Both picked: today's session keeps its slot.
    const both = chapterCandidates([scheduled], names, today, new Set([first.id, second.id]));
    expect(both.map((c) => [c.chapterId, c.session?.minutes ?? null])).toEqual([
      [first.id, 30],
      [second.id, null],
    ]);
    expect(openChapters([scheduled], names).map((c) => c.chapterId)).toEqual(plan.chapters.map((c) => c.id));
  });

  it("skips a picked chapter that's finished and passed", async () => {
    const plan = await makePlan((await createCourse("B")).id);
    const done = { ...plan, chapters: plan.chapters.map((c, i) => (i === 0 ? { ...c, completed_at: "2026-01-01 00:00:00" } : c)) };
    const names = new Map([[plan.course_id, "B"]]);
    const ids = new Set(plan.chapters.map((c) => c.id));
    expect(chapterCandidates([done], names, "2026-03-02", ids).map((c) => c.chapterId)).not.toContain(plan.chapters[0].id);
    expect(openChapters([done], names).map((c) => c.chapterId)).not.toContain(plan.chapters[0].id);
  });

  it("loadToday plans the picked chapters and lists what's open", async () => {
    const plan = await makePlan((await createCourse("C")).id);
    const second = plan.chapters[1];
    const today = await loadToday({ courseId: plan.course_id, minutes: 60, chapterIds: [second.id] });
    expect(today.chapters.map((c) => c.chapterId)).toEqual(plan.chapters.map((c) => c.id));
    const chapterSteps = today.steps.filter((s) => s.kind === "chapter");
    expect(chapterSteps.length).toBeGreaterThan(0);
    expect(chapterSteps.every((s) => s.id.startsWith(`chapter:${second.id}:`))).toBe(true);
  });
});

describe("completeStep", () => {
  it("ticks off a resource and a subtopic, and marks a session done — only within its plan", async () => {
    const plan = await makePlan((await createCourse("Sample Course")).id);
    const other = await makePlan((await createCourse("Other Course")).id);
    const [first] = plan.chapters;

    expect(await completeStep({ type: "resource", planId: plan.id, resourceId: first.resources[0].id })).toBe(true);
    expect(await completeStep({ type: "subtopic", planId: plan.id, chapterId: first.id, index: 1 })).toBe(true);
    expect(await completeStep({ type: "subtopic", planId: other.id, chapterId: first.id, index: 0 })).toBe(false);
    expect(await completeStep({ type: "subtopic", planId: plan.id, chapterId: first.id, index: 9 })).toBe(false);
    expect(await completeStep({ type: "resource", planId: other.id, resourceId: first.resources[0].id })).toBe(false);

    const chapter = await store.getChapter(first.id);
    expect(chapter?.resources[0].done_at).not.toBeNull();
    expect(chapter?.subtopics.map((s) => s.done)).toEqual([false, true]);

    await store.replaceOpenSessions(plan.id, [{ chapterId: first.id, date: "2026-03-02", minutes: 30, kind: "study" }]);
    const [session] = (await store.getStudyPlan(plan.id))!.sessions;
    expect(await completeStep({ type: "session", planId: other.id, sessionId: session.id })).toBe(false);
    expect(await completeStep({ type: "session", planId: plan.id, sessionId: session.id })).toBe(true);
    expect((await store.getSession(session.id))?.done_at).not.toBeNull();
  });

  it("parses only well-formed completions", () => {
    expect(parseCompletion({ type: "resource", planId: 1, resourceId: 2 })).toEqual({ type: "resource", planId: 1, resourceId: 2 });
    expect(parseCompletion({ type: "subtopic", planId: 1, chapterId: 2, index: 0 })).toMatchObject({ index: 0 });
    expect(parseCompletion({ type: "subtopic", planId: 1, chapterId: 2, index: -1 })).toBeNull();
    expect(parseCompletion({ type: "session", planId: "1", sessionId: 2 })).toBeNull();
    expect(parseCompletion({ type: "other", planId: 1 })).toBeNull();
    expect(parseCompletion({ type: "session", planId: 1, sessionId: 2, minutes: 40 })).toMatchObject({ minutes: 40 });
  });

  it("only believes a measured session length that's plausible for the plan", () => {
    expect(actualMinutes(30, 45)).toBe(45);
    expect(actualMinutes(30, 4)).toBeUndefined(); // too short to mean anything
    expect(actualMinutes(30, 5)).toBeUndefined(); // under a quarter of the plan
    expect(actualMinutes(30, 200)).toBeUndefined(); // a tab left open
    expect(actualMinutes(30, undefined)).toBeUndefined();
  });
});
