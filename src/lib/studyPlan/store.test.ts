import { describe, it, expect, vi } from "vitest";
import type { TestDb } from "../db/testHarness";

// Same setup as models.test.ts: "../db" points at a throwaway in-memory
// SQLite database bootstrapped with the production schema.
let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});

const {
  createCourse,
  deleteCourse,
  createDocument,
  deleteDocument,
  createGeneratedItem,
  deleteGeneratedItem,
  createQuizAttempt,
  completeQuizAttempt,
  logFlashcardReview,
  getGeneratedItem,
} = await import("../models");
const store = await import("./store");
const { DEFAULT_STUDY_PLAN_OPTIONS } = await import("./options");

function resource(url: string, overrides: Partial<import("./store").NewResource> = {}): import("./store").NewResource {
  return {
    kind: "article",
    title: url,
    url,
    provider: null,
    language: "en",
    note: "why",
    origin: "ai",
    link_status: "ok",
    status_detail: null,
    checked_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

function newPlan(courseId: number, chapters: import("./store").NewChapter[]): import("./store").NewStudyPlan {
  return {
    courseId,
    title: "Sample plan",
    status: "ready",
    options: DEFAULT_STUDY_PLAN_OPTIONS,
    syllabusDocumentId: null,
    syllabusText: "1. Foundations",
    sourceDocumentIds: [],
    sourceFolderId: null,
    sourceHandpicked: false,
    language: "en",
    modelProvider: "api",
    modelName: "test-model",
    usedWebSearch: true,
    linksCheckedAt: "2026-01-01 00:00:00",
    chapters,
  };
}

function chapter(title: string, overrides: Partial<import("./store").NewChapter> = {}): import("./store").NewChapter {
  return {
    title,
    summary: `${title} summary`,
    subtopics: ["First idea", "Second idea"],
    prerequisites: [],
    stage: 1,
    linked_document_ids: [],
    estimated_minutes: null,
    resources: [],
    ...overrides,
  };
}

describe("study plan store", () => {
  it("creates a plan with chapters, prerequisites mapped to ids, and resources in order", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(
      newPlan(course.id, [
        chapter("Foundations", { resources: [resource("https://example.org/a"), resource("https://example.org/b")] }),
        chapter("Methods", { stage: 2, prerequisites: [0] }),
      ])
    );
    expect(plan.title).toBe("Sample plan");
    expect(plan.options).toEqual(DEFAULT_STUDY_PLAN_OPTIONS);
    expect(plan.chapters.map((c) => c.title)).toEqual(["Foundations", "Methods"]);
    expect(plan.chapters[0].subtopics).toEqual([
      { text: "First idea", done: false },
      { text: "Second idea", done: false },
    ]);
    expect(plan.chapters[1].prerequisite_ids).toEqual([plan.chapters[0].id]);
    expect(plan.chapters[0].resources.map((r) => r.url)).toEqual(["https://example.org/a", "https://example.org/b"]);
    expect(await store.getStudyPlanForCourse(course.id)).toEqual(plan);
  });

  it("replaces the course's plan, carrying progress over by chapter title", async () => {
    const course = await createCourse("Sample Course");
    const first = await store.replaceStudyPlan(
      newPlan(course.id, [chapter("Foundations", { resources: [resource("https://example.org/a")] })])
    );
    const foundations = first.chapters[0];
    await store.updateChapter(foundations.id, {
      subtopics: [
        { text: "First idea", done: true },
        { text: "Second idea", done: false },
      ],
    });
    await store.updateResource(foundations.resources[0].id, { done: true });
    await store.addResource(foundations.id, resource("https://example.org/mine", { origin: "user" }));

    const second = await store.replaceStudyPlan(
      newPlan(course.id, [
        chapter("  foundations ", {
          subtopics: ["First idea", "A new idea"],
          resources: [resource("https://example.org/a"), resource("https://example.org/c")],
        }),
        chapter("Methods"),
      ])
    );

    expect(await store.getStudyPlan(first.id)).toBeUndefined();
    const [carried, fresh] = second.chapters;
    expect(carried.subtopics).toEqual([
      { text: "First idea", done: true },
      { text: "A new idea", done: false },
    ]);
    expect(carried.resources.map((r) => [r.url, !!r.done_at, r.origin])).toEqual([
      ["https://example.org/a", true, "ai"],
      ["https://example.org/c", false, "ai"],
      ["https://example.org/mine", false, "user"],
    ]);
    expect(fresh.subtopics.every((s) => !s.done)).toBe(true);
  });

  it("is deleted along with its course, and survives its syllabus document being deleted", async () => {
    const course = await createCourse("Sample Course");
    const doc = await createDocument({ courseId: course.id, folderId: null, filename: "syllabus.pdf", filePath: "/tmp/x.pdf", fileBase64: null });
    const plan = await store.replaceStudyPlan({
      ...newPlan(course.id, [chapter("Foundations", { resources: [resource("https://example.org/a")] })]),
      syllabusDocumentId: doc.id,
    });
    await deleteDocument(doc.id);
    expect((await store.getStudyPlan(plan.id))?.syllabus_document_id).toBeNull();

    await deleteCourse(course.id);
    expect(await store.getStudyPlan(plan.id)).toBeUndefined();
    expect(await store.getChapterRow(plan.chapters[0].id)).toBeUndefined();
    expect(await store.getResourceRow(plan.chapters[0].resources[0].id)).toBeUndefined();
  });

  it("adds, edits, reorders and deletes chapters", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(newPlan(course.id, [chapter("A"), chapter("B", { stage: 2 })]));
    const added = await store.createChapter(plan.id, { title: "C", subtopics: ["x"] });
    expect(added.position).toBe(2);
    expect(added.stage).toBe(3);

    await store.updateChapter(added.id, { title: "C2", stage: 1, completed: true });
    const row = await store.getChapterRow(added.id);
    expect(row).toMatchObject({ title: "C2", stage: 1 });
    expect(row?.completed_at).not.toBeNull();

    const [a, b] = plan.chapters;
    await store.reorderChapters(plan.id, [added.id, b.id, a.id]);
    expect((await store.getStudyPlan(plan.id))?.chapters.map((c) => c.title)).toEqual(["C2", "B", "A"]);

    await store.deleteChapter(b.id);
    expect((await store.getStudyPlan(plan.id))?.chapters.map((c) => c.title)).toEqual(["C2", "A"]);
  });

  it("edits a resource, resetting its check when the URL changes", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(
      newPlan(course.id, [chapter("A", { resources: [resource("https://example.org/a")] })])
    );
    const id = plan.chapters[0].resources[0].id;
    await store.updateResource(id, { note: "new note" });
    expect(await store.getResourceRow(id)).toMatchObject({ note: "new note", link_status: "ok" });
    await store.updateResource(id, { url: "https://example.org/b" });
    expect(await store.getResourceRow(id)).toMatchObject({ url: "https://example.org/b", link_status: "unchecked" });
    await store.setResourceLinkCheck(id, { status: "dead", detail: "Page not found", url: "https://example.org/b" });
    expect(await store.getResourceRow(id)).toMatchObject({ link_status: "dead", status_detail: "Page not found" });
  });

  it("swaps AI resources for new ones but keeps the user's own, after them", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(
      newPlan(course.id, [chapter("A", { resources: [resource("https://example.org/old")] })])
    );
    const chapterId = plan.chapters[0].id;
    await store.addResource(chapterId, resource("https://example.org/mine", { origin: "user" }));

    await store.replaceAiResources(chapterId, [resource("https://example.org/new1"), resource("https://example.org/new2")]);
    const chapterAfter = await store.getChapter(chapterId);
    expect(chapterAfter?.resources.map((r) => r.url)).toEqual([
      "https://example.org/new1",
      "https://example.org/new2",
      "https://example.org/mine",
    ]);
  });

  it("reorders resources only within their chapter", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(
      newPlan(course.id, [
        chapter("A", { resources: [resource("https://example.org/1"), resource("https://example.org/2")] }),
        chapter("B", { resources: [resource("https://example.org/3")] }),
      ])
    );
    const [r1, r2] = plan.chapters[0].resources;
    const other = plan.chapters[1].resources[0];
    await store.reorderResources(plan.chapters[0].id, [r2.id, r1.id, other.id]);
    const after = await store.getStudyPlan(plan.id);
    expect(after?.chapters[0].resources.map((r) => r.id)).toEqual([r2.id, r1.id]);
    expect(after?.chapters[1].resources[0].position).toBe(0);
  });

  it("keeps a done mark when the same link is suggested again", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(
      newPlan(course.id, [chapter("A", { resources: [resource("https://example.org/a"), resource("https://example.org/b")] })])
    );
    const chapterId = plan.chapters[0].id;
    await store.updateResource(plan.chapters[0].resources[0].id, { done: true });
    await store.replaceAiResources(chapterId, [resource("https://example.org/a"), resource("https://example.org/c")]);
    const resources = (await store.getChapter(chapterId))?.resources ?? [];
    expect(resources.map((r) => [r.url, !!r.done_at])).toEqual([
      ["https://example.org/a", true],
      ["https://example.org/c", false],
    ]);
  });

  it("records levels only on the plan's own chapters, and updates status", async () => {
    const courseA = await createCourse("Sample Course A");
    const courseB = await createCourse("Sample Course B");
    const planA = await store.replaceStudyPlan({ ...newPlan(courseA.id, [chapter("A")]), status: "draft_topics" });
    const planB = await store.replaceStudyPlan(newPlan(courseB.id, [chapter("B")]));
    await store.setChapterLevels(
      planA.id,
      new Map([
        [planA.chapters[0].id, "known"],
        [planB.chapters[0].id, "known"],
      ])
    );
    expect((await store.getChapterRow(planA.chapters[0].id))?.current_level).toBe("known");
    expect((await store.getChapterRow(planB.chapters[0].id))?.current_level).toBeNull();

    expect(planA.status).toBe("draft_topics");
    await store.setPlanStatus(planA.id, "failed", { errorMessage: "boom" });
    expect(await store.getStudyPlan(planA.id)).toMatchObject({ status: "failed", error_message: "boom" });
    await store.setPlanStatus(planA.id, "ready", { errorMessage: null, usedWebSearch: true });
    expect(await store.getStudyPlan(planA.id)).toMatchObject({ status: "ready", error_message: null, used_web_search: true });
  });

  it("carries a done AI link into a rebuilt chapter even before new links are found", async () => {
    const course = await createCourse("Sample Course");
    const first = await store.replaceStudyPlan(
      newPlan(course.id, [chapter("A", { resources: [resource("https://example.org/a"), resource("https://example.org/b")] })])
    );
    await store.updateResource(first.chapters[0].resources[0].id, { done: true });
    const second = await store.replaceStudyPlan(newPlan(course.id, [chapter("A")]));
    expect(second.chapters[0].resources.map((r) => [r.url, !!r.done_at])).toEqual([["https://example.org/a", true]]);
  });

  it("lists a chapter's generated items with their best score, and its mastery", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(newPlan(course.id, [chapter("A"), chapter("B")]));
    const [a, b] = plan.chapters;
    const quiz = await createGeneratedItem({
      courseId: course.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "quiz",
      title: "Quiz — A",
      contentJson: { questions: [] },
      sourceDocumentIds: [],
      studyPlanChapterId: a.id,
    });
    const deck = await createGeneratedItem({
      courseId: course.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: "Flashcards — A",
      contentJson: { cards: [] },
      sourceDocumentIds: [],
      studyPlanChapterId: a.id,
    });
    for (const score of [40, 90]) {
      const attempt = await createQuizAttempt(quiz.id);
      await completeQuizAttempt({ id: attempt.id, score, answersJson: [] });
    }
    await createQuizAttempt(quiz.id); // unfinished — ignored
    await logFlashcardReview({ generatedItemId: deck.id, cardIndex: 0, result: "good" });

    const loaded = await store.getStudyPlan(plan.id);
    const chapterA = loaded?.chapters.find((c) => c.id === a.id);
    expect(chapterA?.items.map((i) => [i.mode, i.best_score])).toEqual([
      ["quiz", 90],
      ["flashcards", null],
    ]);
    // (5×0.4 + 5×0.9 + 1×0.8) / 11, all just now
    expect(chapterA?.mastery).toBeCloseTo((2 + 4.5 + 0.8) / 11);
    expect(loaded?.chapters.find((c) => c.id === b.id)).toMatchObject({ items: [], mastery: null });

    // Deleting the chapter keeps the items, just unlinked.
    await store.deleteChapter(a.id);
    expect((await getGeneratedItem(quiz.id))?.study_plan_chapter_id).toBeNull();
    await deleteGeneratedItem(deck.id);
  });

  it("extends a chapter without duplicating what's there", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(
      newPlan(course.id, [chapter("A", { subtopics: ["First idea"], linked_document_ids: [] })])
    );
    const id = plan.chapters[0].id;
    await store.updateChapter(id, { subtopics: [{ text: "First idea", done: true }] });
    await store.extendChapter(id, { subtopics: [" first IDEA ", "New idea", "New idea"], documentIds: [3, 3] });
    const extended = await store.getChapter(id);
    expect(extended?.subtopics).toEqual([
      { text: "First idea", done: true },
      { text: "New idea", done: false },
    ]);
    expect(extended?.linked_document_ids).toEqual([3]);
  });

  it("creates a chapter with prerequisites, documents and an estimate", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(newPlan(course.id, [chapter("A")]));
    const created = await store.createChapter(plan.id, {
      title: "B",
      stage: 4,
      prerequisiteIds: [plan.chapters[0].id],
      linkedDocumentIds: [9],
      estimatedMinutes: 90,
    });
    expect(created).toMatchObject({
      stage: 4,
      prerequisite_ids: [plan.chapters[0].id],
      linked_document_ids: [9],
      estimated_minutes: 90,
    });
  });

  it("replaces open sessions but keeps finished ones, and lists open ones for the calendar", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(newPlan(course.id, [chapter("A"), chapter("B")]));
    const [a, b] = plan.chapters;
    await store.replaceOpenSessions(plan.id, [
      { chapterId: a.id, date: "2099-01-05", minutes: 60, kind: "study" },
      { chapterId: b.id, date: "2099-01-06", minutes: 30, kind: "review" },
    ]);
    const [first, second] = (await store.getStudyPlan(plan.id))?.sessions ?? [];
    await store.setSessionDone(first.id, true);
    await store.setSessionGoogleEventId(second.id, "google-123");
    expect(await store.listCalendarSessions("2099-01-01", "2099-12-31")).toEqual([]);
    await store.setSessionGoogleEventId(second.id, null);
    expect(await store.listCalendarSessions("2099-01-01", "2099-12-31")).toEqual([
      expect.objectContaining({ id: second.id, chapter_title: "B", course_name: "Sample Course", kind: "review" }),
    ]);

    await store.replaceOpenSessions(plan.id, [{ chapterId: b.id, date: "2099-02-01", minutes: 45, kind: "study" }]);
    const after = (await store.getStudyPlan(plan.id))?.sessions ?? [];
    expect(after.map((s) => [s.date, !!s.done_at])).toEqual([
      ["2099-01-05", true],
      ["2099-02-01", false],
    ]);

    // A chapter's sessions go with it.
    await store.deleteChapter(b.id);
    expect((await store.getStudyPlan(plan.id))?.sessions.map((s) => s.chapter_id)).toEqual([a.id]);
  });

  it("saves plan options and the documents a plan has seen", async () => {
    const course = await createCourse("Sample Course");
    const plan = await store.replaceStudyPlan(newPlan(course.id, [chapter("A")]));
    await store.setPlanOptions(plan.id, { ...plan.options, practice: true, preset: "guided" });
    await store.setPlanSourceDocumentIds(plan.id, [4, 5]);
    expect(await store.getStudyPlan(plan.id)).toMatchObject({
      preset: "guided",
      options: expect.objectContaining({ practice: true }),
      source_document_ids: [4, 5],
    });
  });
});
