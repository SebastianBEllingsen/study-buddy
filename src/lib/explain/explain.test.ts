import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestDb } from "../db/testHarness";

let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});
const generateStructured = vi.fn();
const generateText = vi.fn();
vi.mock("../aiClient", () => ({
  generateStructured: (...a: unknown[]) => generateStructured(...a),
  generateText: (...a: unknown[]) => generateText(...a),
}));

const { createCourse, getGeneratedItem } = await import("../models");
const planStore = await import("../studyPlan/store");
const { DEFAULT_STUDY_PLAN_OPTIONS } = await import("../studyPlan/options");
const { startExplainSession, explainTurn, ExplainSessionError, GAP_DECK_TITLE } = await import("./flow");
const { normalizeExplainResult } = await import("./validate");
const { MAX_NOVICE_QUESTIONS } = await import("./types");

const evaluation = {
  summary: "Mostly there.",
  coverage: [
    { concept: "Base case", status: "covered", note: "Good." },
    { concept: "Inductive step", status: "missing", note: "Not mentioned." },
  ],
  errors: ["Said induction needs no base case."],
  cards: [{ front: "What does the inductive step show?", back: "P(k) implies P(k+1).", concept: "Inductive step" }],
};

async function courseWithChapter() {
  const course = await createCourse("Sample Course");
  const plan = await planStore.replaceStudyPlan({
    courseId: course.id,
    title: "Sample plan",
    status: "ready",
    options: DEFAULT_STUDY_PLAN_OPTIONS,
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
        title: "Induction",
        summary: "Proof by induction.",
        subtopics: ["Base case", "Inductive step"],
        prerequisites: [],
        stage: 1,
        linked_document_ids: [],
        estimated_minutes: null,
        resources: [],
      },
    ],
  });
  return { course, chapter: plan.chapters[0] };
}

beforeEach(() => {
  generateStructured.mockReset();
  generateText.mockReset();
});

describe("blurt", () => {
  it("evaluates against the chapter and adds gap cards to the course's gap deck", async () => {
    const { course, chapter } = await courseWithChapter();
    const session = await startExplainSession({ courseId: course.id, kind: "blurt", chapterId: chapter.id });
    expect(session.topic).toBe("Induction");

    generateStructured.mockResolvedValue(evaluation);
    const done = await explainTurn(session.id, { text: "You check the first case and then..." });
    expect(generateStructured.mock.calls[0][0].system).toContain("- Inductive step");
    expect(done.status).toBe("done");
    expect(done.result?.coverage.map((c) => c.status)).toEqual(["covered", "missing"]);

    const deck = await getGeneratedItem(done.practice_item_id!);
    expect(deck?.title).toBe(GAP_DECK_TITLE);
    expect(JSON.parse(deck!.content_json).cards).toEqual([evaluation.cards[0]]);

    // A second session adds to the same deck.
    const again = await startExplainSession({ courseId: course.id, kind: "blurt", topic: "Recursion" });
    const second = await explainTurn(again.id, { text: "Functions calling themselves." });
    expect(second.practice_item_id).toBe(done.practice_item_id);
    expect(JSON.parse((await getGeneratedItem(done.practice_item_id!))!.content_json).cards).toHaveLength(2);

    await expect(explainTurn(session.id, { text: "more" })).rejects.toBeInstanceOf(ExplainSessionError);
  });

  it("rejects a chapter from another course and an empty topic", async () => {
    const { chapter } = await courseWithChapter();
    const other = await createCourse("Other Course");
    await expect(startExplainSession({ courseId: other.id, kind: "blurt", chapterId: chapter.id })).rejects.toBeInstanceOf(
      ExplainSessionError
    );
    await expect(startExplainSession({ courseId: other.id, kind: "feynman", topic: "  " })).rejects.toBeInstanceOf(
      ExplainSessionError
    );
  });
});

describe("feynman", () => {
  it("asks up to the question limit, then evaluates the conversation", async () => {
    const { course } = await courseWithChapter();
    const session = await startExplainSession({ courseId: course.id, kind: "feynman", topic: "Recursion" });
    await expect(explainTurn(session.id, { text: "" })).rejects.toBeInstanceOf(ExplainSessionError);

    generateText.mockResolvedValue("  But why does it stop? ");
    let state = await explainTurn(session.id, { text: "A function that calls itself." });
    expect(state.messages.at(-1)).toEqual({ role: "novice", text: "But why does it stop?" });
    for (let i = 1; i < MAX_NOVICE_QUESTIONS; i++) state = await explainTurn(session.id, { text: `Answer ${i}` });
    expect(generateText).toHaveBeenCalledTimes(MAX_NOVICE_QUESTIONS);

    generateStructured.mockResolvedValue(evaluation);
    state = await explainTurn(session.id, { text: "Final answer" });
    expect(state.status).toBe("done");
    expect(generateStructured.mock.calls[0][0].user).toContain("Novice: But why does it stop?");
  });

  it("evaluates early when the student finishes", async () => {
    const { course } = await courseWithChapter();
    const session = await startExplainSession({ courseId: course.id, kind: "feynman", topic: "Recursion" });
    generateStructured.mockResolvedValue({ ...evaluation, cards: [] });
    const state = await explainTurn(session.id, { text: "It's a loop, basically.", finish: true });
    expect(generateText).not.toHaveBeenCalled();
    expect(state).toMatchObject({ status: "done", practice_item_id: null });
  });
});

describe("normalizeExplainResult", () => {
  it("keeps valid coverage and cards and caps them", () => {
    const result = normalizeExplainResult({
      summary: "s",
      coverage: [{ concept: "A", status: "covered" }, { concept: "B", status: "sort of" }],
      errors: ["x", 3],
      cards: Array.from({ length: 14 }, (_, i) => ({ front: `F${i}`, back: "B" })).concat([{ front: "", back: "x" }]),
    });
    expect(result.coverage).toEqual([{ concept: "A", status: "covered", note: "" }]);
    expect(result.errors).toEqual(["x"]);
    expect(result.cards).toHaveLength(10);
    expect(result.cards[0].concept).toBe("A");
    expect(() => normalizeExplainResult({ coverage: [] })).toThrow();
  });
});
