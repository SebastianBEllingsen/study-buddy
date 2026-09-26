import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestDb } from "../db/testHarness";

// Same setup as models.test.ts: "../db" points at a throwaway in-memory
// SQLite database bootstrapped with the production schema.
let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});

const { createCourse, createGeneratedItem, logFlashcardReview, listStudyActivity, listDueFlashcardItems, deleteGeneratedItem } =
  await import("../models");
const store = await import("./store");
const mistakesModule = await import("./mistakes");
const { recordCardAnswer, recordQuizAnswers, SAME_SESSION_MS } = await import("./answers");
const { migrateLegacyFlashcardHistory, ensureFsrsMigrated, resetFsrsMigrationMemo } = await import("./legacyMigration");
const { findOrCreateConcepts, listConceptsForCourse } = await import("./concepts");
const { Rating, State } = await import("../fsrs");

const cards = [
  { front: "Term A", back: "Definition A", concept: "Topic one" },
  { front: "Term B", back: "Definition B" },
  { front: "Term C", back: "Definition C" },
];
const questions = [
  { type: "mcq" as const, question: "Pick one", options: ["x", "y"], correctIndex: 0, explanation: "e", concept: "Topic two" },
  { type: "short_answer" as const, question: "Explain", modelAnswer: "Because", explanation: "e" },
];

async function setup() {
  const course = await createCourse(`Sample Course ${Math.random()}`);
  const deck = await createGeneratedItem({
    courseId: course.id,
    folderId: null,
    sourceFolderId: null,
    sourceHandpicked: false,
    mode: "flashcards",
    title: "Sample flashcards",
    contentJson: { cards },
    sourceDocumentIds: [],
  });
  const quiz = await createGeneratedItem({
    courseId: course.id,
    folderId: null,
    sourceFolderId: null,
    sourceHandpicked: false,
    mode: "quiz",
    title: "Sample quiz",
    contentJson: { questions },
    sourceDocumentIds: [],
  });
  return { course, deck, quiz };
}

const DAY = 86_400_000;
const T0 = new Date("2026-03-02T10:00:00Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);

function result(index: number, correct: boolean, correctAnswer = "x") {
  return { index, type: "mcq" as const, correct, feedback: "", explanation: "e", correctAnswer };
}

beforeEach(async () => {
  resetFsrsMigrationMemo();
  // Every test starts with the one-time migration already done, except the
  // ones that exercise it.
  await testDb.db.update(testDb.schema.app_settings).set({ fsrs_migrated_at: "2026-01-01 00:00:00" });
});

describe("recordReview", () => {
  it("creates the item's FSRS state on the first review and logs every review", async () => {
    const { deck } = await setup();
    const first = await store.recordReview({
      generatedItemId: deck.id,
      kind: "card",
      itemIndex: 0,
      rating: Rating.Good,
      correct: true,
      confidence: "sure",
      source: "deck",
      now: T0,
    });
    expect(first.reps).toBe(1);
    expect(first.state).toBe(State.Review);
    const second = await store.recordReview({
      generatedItemId: deck.id,
      kind: "card",
      itemIndex: 0,
      rating: Rating.Again,
      correct: false,
      confidence: null,
      source: "queue",
      now: at(3),
    });
    expect(second.id).toBe(first.id);
    expect(second.lapses).toBe(1);
    const logs = await testDb.db.select().from(testDb.schema.review_logs);
    expect(logs.filter((l) => l.review_item_id === first.id).map((l) => [l.rating, l.source, l.confidence])).toEqual([
      [Rating.Good, "deck", "sure"],
      [Rating.Again, "queue", null],
    ]);
  });
});

describe("recordCardAnswer", () => {
  it("schedules the card, logs the flashcard review and tags its concept", async () => {
    const { deck, course } = await setup();
    const recorded = await recordCardAnswer({
      item: deck,
      card: cards[0],
      cardIndex: 0,
      result: "good",
      confidence: null,
      source: "deck",
      now: T0,
    });
    expect(recorded.scheduled).toBe(true);
    expect(recorded.dueAt! > "2026-03-02 10:00:00").toBe(true);
    const [row] = await store.listReviewItemsForItem(deck.id, "card");
    const [concept] = await listConceptsForCourse(course.id);
    expect(concept.name).toBe("Topic one");
    expect(row.concept_id).toBe(concept.id);
    const reviews = await testDb.db.select().from(testDb.schema.flashcard_reviews);
    expect(reviews.some((r) => r.generated_item_id === deck.id && r.card_index === 0)).toBe(true);
  });

  it("doesn't move the schedule for a second answer in the same session", async () => {
    const { deck } = await setup();
    await recordCardAnswer({ item: deck, card: cards[1], cardIndex: 1, result: "again", confidence: null, source: "deck", now: T0 });
    const again = await recordCardAnswer({
      item: deck,
      card: cards[1],
      cardIndex: 1,
      result: "good",
      confidence: null,
      source: "deck",
      now: new Date(T0.getTime() + SAME_SESSION_MS - 1000),
    });
    expect(again.scheduled).toBe(false);
    const [row] = await store.listReviewItemsForItem(deck.id, "card");
    expect(row.reps).toBe(1);
  });

  it("logs a mistake for Again and resolves it after correct recall on two later days", async () => {
    const { deck } = await setup();
    const answer = (result: "again" | "good", now: Date) =>
      recordCardAnswer({ item: deck, card: cards[2], cardIndex: 2, result, confidence: "sure", source: "queue", now });

    await answer("again", T0);
    let open = await mistakesModule.listMistakes({ status: "open" });
    const mine = open.filter((m) => m.generated_item_id === deck.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "card", item_index: 2, prompt: "Term C", correct_answer: "Definition C", confidence: "sure" });

    await answer("good", at(1));
    open = await mistakesModule.listMistakes({ status: "open" });
    expect(open.some((m) => m.generated_item_id === deck.id)).toBe(true);

    await answer("good", at(4));
    open = await mistakesModule.listMistakes({ status: "open" });
    expect(open.some((m) => m.generated_item_id === deck.id)).toBe(false);
    const resolved = await mistakesModule.listMistakes({ status: "resolved" });
    expect(resolved.some((m) => m.generated_item_id === deck.id)).toBe(true);
  });
});

describe("recordQuizAnswers", () => {
  it("rates by verdict and confidence and logs wrong answers with what was given", async () => {
    const { quiz, course } = await setup();
    await recordQuizAnswers({
      item: quiz,
      source: "quiz",
      now: T0,
      entries: [
        { question: questions[0], answer: 1, confidence: "sure", result: result(0, false, "x") },
        {
          question: questions[1],
          answer: "Because it is",
          confidence: "unsure",
          result: { ...result(1, true, "Because"), type: "short_answer", verdict: "correct" },
        },
      ],
    });
    const items = await store.listReviewItemsForItem(quiz.id, "question");
    expect(items.map((i) => i.item_index).sort()).toEqual([0, 1]);
    const logs = await testDb.db.select().from(testDb.schema.review_logs);
    const byItem = new Map(items.map((i) => [i.id, i.item_index]));
    const ratings = logs.filter((l) => byItem.has(l.review_item_id)).map((l) => [byItem.get(l.review_item_id), l.rating]);
    expect(ratings).toEqual(
      expect.arrayContaining([
        [0, Rating.Again],
        [1, Rating.Hard],
      ])
    );
    const open = (await mistakesModule.listMistakes({ courseId: course.id })).filter((m) => m.generated_item_id === quiz.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ prompt: "Pick one", given_answer: "y", correct_answer: "x", concept_name: "Topic two" });
  });

  it("updates the open mistake instead of adding another on a repeat miss", async () => {
    const { quiz } = await setup();
    const miss = (now: Date, answer: number) =>
      recordQuizAnswers({
        item: quiz,
        source: "queue",
        now,
        entries: [{ question: questions[0], answer, confidence: null, result: result(0, false) }],
      });
    await miss(T0, 1);
    await miss(at(2), 1);
    const open = (await mistakesModule.listMistakes()).filter((m) => m.generated_item_id === quiz.id);
    expect(open).toHaveLength(1);
  });
});

describe("recoveredSinceLastMiss", () => {
  const log = (day: string, correct: boolean) => ({ reviewed_at: `${day} 10:00:00`, correct });
  it("needs correct recalls on two separate days after the latest miss, not the miss day", () => {
    expect(mistakesModule.recoveredSinceLastMiss([log("2026-01-01", false), log("2026-01-01", true), log("2026-01-02", true)])).toBe(false);
    expect(mistakesModule.recoveredSinceLastMiss([log("2026-01-01", false), log("2026-01-02", true), log("2026-01-03", true)])).toBe(true);
    expect(
      mistakesModule.recoveredSinceLastMiss([
        log("2026-01-01", false),
        log("2026-01-02", true),
        log("2026-01-03", false),
        log("2026-01-04", true),
      ])
    ).toBe(false);
    expect(mistakesModule.recoveredSinceLastMiss([log("2026-01-02", true), log("2026-01-03", true)])).toBe(false);
  });
});

describe("reconcileReviewItemsAfterRemoval", () => {
  it("drops removed cards' state and mistakes and shifts later ones down", async () => {
    const { deck } = await setup();
    for (const i of [0, 1, 2]) {
      await recordCardAnswer({ item: deck, card: cards[i], cardIndex: i, result: "again", confidence: null, source: "deck", now: T0 });
    }
    await store.reconcileReviewItemsAfterRemoval(deck.id, "card", [1]);
    const items = await store.listReviewItemsForItem(deck.id, "card");
    expect(items.map((i) => i.item_index).sort()).toEqual([0, 1]);
    const mistakes = (await mistakesModule.listMistakes()).filter((m) => m.generated_item_id === deck.id);
    expect(mistakes.map((m) => [m.item_index, m.prompt]).sort()).toEqual([
      [0, "Term A"],
      [1, "Term C"],
    ]);
  });
});

describe("legacy SM-2 history migration", () => {
  it("replays every card's old reviews through FSRS once", async () => {
    const { deck } = await setup();
    await testDb.db.insert(testDb.schema.flashcard_reviews).values([
      { generated_item_id: deck.id, card_index: 0, last_result: "good", reviewed_at: "2026-01-01 10:00:00" },
      { generated_item_id: deck.id, card_index: 0, last_result: "good", reviewed_at: "2026-01-05 10:00:00" },
      { generated_item_id: deck.id, card_index: 1, last_result: "again", reviewed_at: "2026-01-02 10:00:00" },
      // beyond the deck's cards: ignored
      { generated_item_id: deck.id, card_index: 9, last_result: "good", reviewed_at: "2026-01-02 10:00:00" },
    ]);
    const first = await migrateLegacyFlashcardHistory();
    expect(first.cards).toBeGreaterThanOrEqual(2);
    const items = await store.listReviewItemsForItem(deck.id, "card");
    expect(items.map((i) => [i.item_index, i.reps]).sort()).toEqual([
      [0, 2],
      [1, 1],
    ]);
    const logs = await testDb.db.select().from(testDb.schema.review_logs);
    expect(logs.filter((l) => items.some((i) => i.id === l.review_item_id)).every((l) => l.source === "legacy")).toBe(true);

    const rerun = await migrateLegacyFlashcardHistory();
    expect(rerun.cards).toBe(0);
  });

  it("runs from ensureFsrsMigrated only while the flag is unset", async () => {
    const { deck } = await setup();
    await logFlashcardReview({ generatedItemId: deck.id, cardIndex: 2, result: "easy" });
    await testDb.db.update(testDb.schema.app_settings).set({ fsrs_migrated_at: null });
    resetFsrsMigrationMemo();
    await ensureFsrsMigrated();
    expect((await store.listReviewItemsForItem(deck.id, "card")).map((i) => i.item_index)).toContain(2);
    const [settings] = await testDb.db.select().from(testDb.schema.app_settings);
    expect(settings.fsrs_migrated_at).not.toBeNull();
  });
});

describe("due counts and activity", () => {
  it("counts unreviewed cards as due and reviewed-ahead cards as not due", async () => {
    const { deck } = await setup();
    await recordCardAnswer({ item: deck, card: cards[0], cardIndex: 0, result: "easy", confidence: null, source: "deck" });
    const due = (await listDueFlashcardItems()).find((d) => d.itemId === deck.id);
    expect(due?.dueCount).toBe(2);
  });

  it("counts questions answered in the review session as study activity", async () => {
    const { quiz } = await setup();
    const now = new Date();
    await recordQuizAnswers({
      item: quiz,
      source: "queue",
      now,
      entries: [{ question: questions[0], answer: 0, confidence: null, result: result(0, true) }],
    });
    const activity = await listStudyActivity();
    expect(activity.dates).toContain(now.toISOString().slice(0, 10));
  });

  it("removes review state with its item", async () => {
    const { deck } = await setup();
    await recordCardAnswer({ item: deck, card: cards[0], cardIndex: 0, result: "again", confidence: null, source: "deck", now: T0 });
    await deleteGeneratedItem(deck.id);
    expect(await store.listReviewItemsForItem(deck.id)).toEqual([]);
    expect((await mistakesModule.listMistakes({ status: "all" })).some((m) => m.generated_item_id === deck.id)).toBe(false);
  });
});

describe("findOrCreateConcepts", () => {
  it("matches names case-insensitively and creates each once", async () => {
    const { course } = await setup();
    const first = await findOrCreateConcepts(course.id, ["Graphs", "graphs ", "Trees"]);
    expect(first.size).toBe(2);
    const second = await findOrCreateConcepts(course.id, ["GRAPHS"]);
    expect(second.get("graphs")).toBe(first.get("graphs"));
    expect(await listConceptsForCourse(course.id)).toHaveLength(2);
  });
});
