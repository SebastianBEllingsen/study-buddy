import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestDb } from "../db/testHarness";

let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});
const generateStructured = vi.fn();
vi.mock("../aiClient", () => ({ generateStructured: (...a: unknown[]) => generateStructured(...a) }));

const { createCourse, createGeneratedItem, getGeneratedItem } = await import("../models");
const { tagCourseConcepts, countUntagged, untaggedEntries, normalizeConceptTags, applyConceptTags } = await import(
  "./tagConcepts"
);
const { listConceptsForCourse } = await import("./concepts");
const store = await import("./store");
const { Rating } = await import("../fsrs");

beforeEach(() => generateStructured.mockReset());

describe("untaggedEntries / applyConceptTags", () => {
  it("lists only untagged items with their answer text and writes tags by index", () => {
    const quiz = {
      questions: [
        { type: "mcq" as const, question: "Q0", options: ["a", "b"], correctIndex: 1, explanation: "e" },
        { type: "short_answer" as const, question: "Q1", modelAnswer: "m", explanation: "e", concept: "Done" },
        { type: "multi_select" as const, question: "Q2", options: ["a", "b", "c"], correctIndices: [0, 2], explanation: "e" },
      ],
    };
    expect(untaggedEntries("quiz", quiz)).toEqual([
      { index: 0, prompt: "Q0", answer: "b" },
      { index: 2, prompt: "Q2", answer: "a, c" },
    ]);
    const tagged = applyConceptTags("quiz", quiz, new Map([[2, "Sets"]])) as typeof quiz;
    expect(tagged.questions.map((q) => (q as { concept?: string }).concept)).toEqual([undefined, "Done", "Sets"]);
  });

  it("keeps only in-range, named tags", () => {
    const tags = normalizeConceptTags(
      { tags: [{ n: 1, concept: " A " }, { n: 3, concept: "B" }, { n: 2, concept: "" }, { n: "1", concept: "C" }] },
      2
    );
    expect([...tags]).toEqual([[1, "A"]]);
    expect(() => normalizeConceptTags({}, 2)).toThrow();
  });
});

describe("tagCourseConcepts", () => {
  it("tags untagged cards, stores concepts and points existing review state at them", async () => {
    const course = await createCourse("Sample Course");
    const deck = await createGeneratedItem({
      courseId: course.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: "Sample flashcards",
      contentJson: { cards: [{ front: "F0", back: "B0" }, { front: "F1", back: "B1", concept: "Existing" }, { front: "F2", back: "B2" }] },
      sourceDocumentIds: [],
    });
    await store.recordReview({
      generatedItemId: deck.id,
      kind: "card",
      itemIndex: 2,
      rating: Rating.Good,
      correct: true,
      confidence: null,
      source: "deck",
    });
    expect(await countUntagged(course.id)).toEqual({ items: 1, entries: 2 });
    generateStructured.mockResolvedValue({ tags: [{ n: 1, concept: "Alpha" }, { n: 2, concept: "Beta" }] });

    expect(await tagCourseConcepts(course.id)).toEqual({ taggedItems: 1, remainingItems: 0 });

    const user = generateStructured.mock.calls[0][0].user as string;
    expect(user).toContain("1. F0");
    expect(user).toContain("2. F2");
    const content = JSON.parse((await getGeneratedItem(deck.id))!.content_json);
    expect(content.cards.map((c: { concept?: string }) => c.concept)).toEqual(["Alpha", "Existing", "Beta"]);
    const concepts = await listConceptsForCourse(course.id);
    const beta = concepts.find((c) => c.name === "Beta");
    const [row] = await store.listReviewItemsForItem(deck.id, "card");
    expect(row.concept_id).toBe(beta?.id);
    expect(await countUntagged(course.id)).toEqual({ items: 0, entries: 0 });
  });
});
