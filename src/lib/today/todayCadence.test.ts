import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "../db/testHarness";

// A plan's Today frequency, through loadToday and the real database. Its own
// file so that courses made by other tests can't take the day's slots.
let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});
vi.mock("../googleCalendar", () => ({ createEvent: vi.fn(), deleteEvent: vi.fn() }));

const { createCourse, createGeneratedItem, deleteCourse, listCourseNames } = await import("../models");
const store = await import("../studyPlan/store");
const { DEFAULT_STUDY_PLAN_OPTIONS } = await import("../studyPlan/options");
const { loadToday } = await import("./loadToday");
const { activeDaysByCourse } = await import("./activity");
const { recordQuizAnswers } = await import("../review/answers");
type Options = import("../studyPlan/types").StudyPlanOptions;

beforeEach(async () => {
  for (const c of await listCourseNames(null)) await deleteCourse(c.id);
});

const question = { type: "mcq" as const, question: "Q", options: ["a", "b"], correctIndex: 0, explanation: "e" };

async function courseWithPlan(name: string, options: Partial<Options> = {}) {
  const course = await createCourse(name);
  const plan = await store.replaceStudyPlan({
    courseId: course.id,
    title: `${name} plan`,
    status: "ready",
    options: { ...DEFAULT_STUDY_PLAN_OPTIONS, ...options },
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
      {
        title: `${name} chapter`,
        summary: "",
        subtopics: ["First idea"],
        prerequisites: [],
        stage: 1,
        linked_document_ids: [],
        estimated_minutes: 60,
        resources: [],
      },
    ],
  });
  // `studyPlanChapterId` set: the plan's own chapter quiz; unset: a quiz made for the course.
  const makeQuiz = (chapterId?: number) =>
    createGeneratedItem({
      courseId: course.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "quiz",
      title: `${name} quiz`,
      contentJson: { questions: [question] },
      sourceDocumentIds: [],
      ...(chapterId !== undefined && { studyPlanChapterId: chapterId }),
    });
  const quiz = await makeQuiz(plan.chapters[0].id);
  const courseQuiz = await makeQuiz();
  // The plan gets work `daysAgo` days ago (a couple of hours earlier, to stay clear of midnight).
  const answer = (item: typeof quiz) => (daysAgo: number) =>
    recordQuizAnswers({
      item,
      source: "quiz",
      now: new Date(Date.now() - daysAgo * 86_400_000 - 2 * 3_600_000),
      entries: [
        {
          question,
          answer: 0,
          confidence: "sure",
          result: { index: 0, type: "mcq", correct: true, feedback: "", explanation: "e", correctAnswer: "a" },
        },
      ],
    });
  return { course, plan, studyDaysAgo: answer(quiz), courseReviewDaysAgo: answer(courseQuiz) };
}

async function chapterSteps(courseId: number | null = null) {
  return (await loadToday({ courseId, minutes: 120 })).steps.filter((s) => s.kind === "chapter");
}

describe("activeDaysByCourse", () => {
  it("lists the local days with a review in each course, and nothing for a quiet one", async () => {
    const busy = await courseWithPlan("Busy course");
    const quiet = await courseWithPlan("Quiet course");
    // Oldest first: a repeat answer to the same question within hours isn't recorded.
    await busy.studyDaysAgo(3);
    await busy.studyDaysAgo(1);
    const days = await activeDaysByCourse([busy.course.id, quiet.course.id], new Date());
    expect(days.get(busy.course.id)?.size).toBe(2);
    expect(days.get(quiet.course.id)?.size).toBe(0);
    expect(await activeDaysByCourse([], new Date())).toEqual(new Map());
  });
});

describe("what counts as working on a plan", () => {
  const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  it("doesn't count reviewing the course's other cards", async () => {
    const { course, courseReviewDaysAgo } = await courseWithPlan("Reviewed course");
    await courseReviewDaysAgo(1);
    expect((await activeDaysByCourse([course.id], new Date())).get(course.id)?.size).toBe(0);
  });

  it("counts a finished plan session, whether scheduled or recorded from Today", async () => {
    const { course, plan } = await courseWithPlan("Session course");
    await store.addDoneSession(plan.id, plan.chapters[0].id, dayOf(new Date()), 25);
    const days = (await activeDaysByCourse([course.id], new Date())).get(course.id);
    expect([...(days ?? [])]).toEqual([dayOf(new Date())]);
  });

  it("counts a ticked subtopic, but not a chapter nobody has ticked anything in", async () => {
    const { course, plan } = await courseWithPlan("Subtopic course");
    await store.updateChapter(plan.chapters[0].id, { title: "Renamed" });
    expect((await activeDaysByCourse([course.id], new Date())).get(course.id)?.size).toBe(0);
    await store.updateChapter(plan.chapters[0].id, { subtopics: [{ text: "First idea", done: true }] });
    expect((await activeDaysByCourse([course.id], new Date())).get(course.id)?.size).toBe(1);
  });

  it("keeps an every-day plan from being cleared by reviews, but clears it once Today records the work", async () => {
    const { course, plan, courseReviewDaysAgo } = await courseWithPlan("Daily and reviewed", { todayCadence: "daily" });
    await courseReviewDaysAgo(0);
    expect((await chapterSteps())[0].why).toBe("your every-day plan");
    await store.addDoneSession(plan.id, plan.chapters[0].id, dayOf(new Date()), 20);
    expect((await chapterSteps())[0].why).not.toBe("your every-day plan");
    expect(course.id).toBeGreaterThan(0);
  });
});

describe("a plan's Today frequency on a scheduled plan", () => {
  it("still gets its chapter on a day with no session, when it's set to every day", async () => {
    await courseWithPlan("Scheduled auto", { schedule: true });
    await courseWithPlan("Scheduled daily", { schedule: true, todayCadence: "daily" });
    expect((await chapterSteps()).map((s) => s.courseName)).toEqual(["Scheduled daily"]);
  });
});

describe("a plan's Today frequency", () => {
  it("gives a plan set to every day a step before the rotation, and says why", async () => {
    await courseWithPlan("Rotation course");
    await courseWithPlan("Daily course", { todayCadence: "daily" });
    const steps = await chapterSteps();
    expect(steps[0]).toMatchObject({ courseName: "Daily course", why: "your every-day plan" });
    expect(steps.map((s) => s.courseName)).toContain("Rotation course");
  });

  it("stops asking for an every-day plan once the course has been worked on today", async () => {
    const { studyDaysAgo } = await courseWithPlan("Daily and done", { todayCadence: "daily" });
    await studyDaysAgo(0);
    const [step] = await chapterSteps();
    expect(step.why).not.toBe("your every-day plan");
  });

  it("rests an every-other-day plan the day after it was studied, and not after a gap", async () => {
    const rested = await courseWithPlan("Rested course", { todayCadence: "every_other_day" });
    await rested.studyDaysAgo(1);
    const gap = await courseWithPlan("Gap course", { todayCadence: "every_other_day" });
    await gap.studyDaysAgo(2);
    const names = (await chapterSteps()).map((s) => s.courseName);
    expect(names).not.toContain("Rested course");
    expect(names).toContain("Gap course");
  });

  it("leaves a plan alone when Today is opened for that course: asking for it is asking to study it", async () => {
    const rested = await courseWithPlan("Rested but opened", { todayCadence: "every_other_day" });
    await rested.studyDaysAgo(1);
    expect((await chapterSteps(rested.course.id)).map((s) => s.courseName)).toEqual(["Rested but opened"]);
    const daily = await courseWithPlan("Daily but opened", { todayCadence: "daily" });
    expect((await chapterSteps(daily.course.id))[0].why).not.toBe("your every-day plan");
  });

  it("pushes a weekly plan forward while short of its days, then lets it rotate", async () => {
    await courseWithPlan("Plain course");
    const onTrack = await courseWithPlan("On track course", { todayCadence: "weekly", todayPerWeek: 2 });
    await onTrack.studyDaysAgo(3);
    await onTrack.studyDaysAgo(1);
    const behind = await courseWithPlan("Behind course", { todayCadence: "weekly", todayPerWeek: 3 });
    await behind.studyDaysAgo(1);
    const steps = await chapterSteps();
    expect(steps[0]).toMatchObject({ courseName: "Behind course", why: "1 of 3 study days in the last week" });
    expect(steps.find((s) => s.courseName === "On track course")?.why).not.toMatch(/study days/);
  });

  it("honours chapters picked by hand even on a rest day", async () => {
    const rested = await courseWithPlan("Rested but picked", { todayCadence: "every_other_day" });
    await rested.studyDaysAgo(1);
    const plan = await store.getStudyPlanForCourse(rested.course.id);
    const picked = await loadToday({ courseId: null, minutes: 60, chapterIds: [plan!.chapters[0].id] });
    expect(picked.steps.some((s) => s.kind === "chapter" && s.courseName === "Rested but picked")).toBe(true);
  });
});

describe("a plan that is off", () => {
  // Two cards on a concept you keep missing, answered long enough ago to be weak now.
  async function makeConceptWeak(courseId: number, concept: string) {
    const deck = await createGeneratedItem({
      courseId,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: `${concept} cards`,
      contentJson: { cards: [{ front: "a", back: "b", concept }, { front: "c", back: "d", concept }] },
      sourceDocumentIds: [],
    });
    const { recordCardAnswer } = await import("../review/answers");
    const cards = JSON.parse(deck.content_json).cards;
    for (const i of [0, 1]) {
      await recordCardAnswer({
        item: deck,
        card: cards[i],
        cardIndex: i,
        result: "again",
        confidence: null,
        source: "deck",
        now: new Date(Date.now() - 20 * 86_400_000),
      });
    }
  }

  it("gets no chapter step in the mixed view, whatever you did lately", async () => {
    await courseWithPlan("Active course");
    const paused = await courseWithPlan("Paused course", { todayCadence: "off" });
    await paused.studyDaysAgo(5);
    const names = (await chapterSteps()).map((s) => s.courseName);
    expect(names).toEqual(["Active course"]);
  });

  it("is still there when you open Today for that course, or pick its chapter", async () => {
    const paused = await courseWithPlan("Paused but opened", { todayCadence: "off" });
    expect((await chapterSteps(paused.course.id)).map((s) => s.courseName)).toEqual(["Paused but opened"]);
    const plan = await store.getStudyPlanForCourse(paused.course.id);
    const picked = await loadToday({ courseId: null, minutes: 60, chapterIds: [plan!.chapters[0].id] });
    expect(picked.steps.some((s) => s.kind === "chapter" && s.courseName === "Paused but opened")).toBe(true);
  });

  it("gets no 'Strengthen' step for its weak concepts in the mixed view, but still in its own Today", async () => {
    const active = await courseWithPlan("Active with a weak concept");
    await makeConceptWeak(active.course.id, "Active shaky");
    const paused = await courseWithPlan("Paused with a weak concept", { todayCadence: "off" });
    await makeConceptWeak(paused.course.id, "Paused shaky");
    const titles = async (courseId: number | null) =>
      (await loadToday({ courseId, minutes: 120 })).steps.filter((s) => s.kind === "concept").map((s) => s.title);
    expect(await titles(null)).toEqual(["Strengthen: Active shaky"]);
    expect(await titles(paused.course.id)).toEqual(["Strengthen: Paused shaky"]);
  });

  it("leaves reviews and mistakes alone", async () => {
    const paused = await courseWithPlan("Paused with reviews", { todayCadence: "off" });
    await makeConceptWeak(paused.course.id, "Anything"); // cards that are due
    const steps = (await loadToday({ courseId: null, minutes: 60 })).steps;
    expect(steps.some((s) => s.kind === "reviews")).toBe(true);
    expect(steps.some((s) => s.kind === "chapter")).toBe(false);
  });
});

