import { describe, it, expect, vi } from "vitest";
import type { TestDb } from "../db/testHarness";

let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});

const { createCourse, createGeneratedItem } = await import("../models");
const { recordQuizAnswers } = await import("../review/answers");
const { loadInsights } = await import("./load");
const { calibrationTable, calibrationVerdict, topMisconceptions } = await import("./summary");

const q = { type: "mcq" as const, question: "Q", options: ["a", "b"], correctIndex: 0, explanation: "e" };

describe("calibrationTable / calibrationVerdict", () => {
  it("tallies accuracy per confidence and names overconfidence", () => {
    const logs = [
      ...Array.from({ length: 6 }, (_, i) => ({ confidence: "sure", correct: i < 3 })),
      { confidence: "guess", correct: true },
      { confidence: null, correct: true },
    ];
    const table = calibrationTable(logs);
    expect(table).toEqual([
      { confidence: "guess", answers: 1, correct: 1, accuracy: 1 },
      { confidence: "unsure", answers: 0, correct: 0, accuracy: null },
      { confidence: "sure", answers: 6, correct: 3, accuracy: 0.5 },
    ]);
    expect(calibrationVerdict(table)).toContain("overconfident");
    expect(calibrationVerdict(calibrationTable([{ confidence: "sure", correct: true }]))).toBeNull();
    const good = calibrationTable(Array.from({ length: 6 }, () => ({ confidence: "sure", correct: true })));
    expect(calibrationVerdict(good)).toBe("Your confidence matches your results well.");
  });

  it("lists the newest misconceptions", () => {
    expect(
      topMisconceptions([
        { misconception: "old", concept_name: "A", created_at: "2026-01-01 00:00:00" },
        { misconception: null, concept_name: "B", created_at: "2026-01-03 00:00:00" },
        { misconception: "new", concept_name: null, created_at: "2026-01-02 00:00:00" },
      ])
    ).toEqual([
      { misconception: "new", concept: null },
      { misconception: "old", concept: "A" },
    ]);
  });
});

describe("loadInsights", () => {
  it("summarizes the week for one course only", async () => {
    const course = await createCourse("Sample Course");
    const other = await createCourse("Other Course");
    const make = (courseId: number) =>
      createGeneratedItem({
        courseId,
        folderId: null,
        sourceFolderId: null,
        sourceHandpicked: false,
        mode: "quiz",
        title: "Quiz",
        contentJson: { questions: [q] },
        sourceDocumentIds: [],
      });
    const mine = await make(course.id);
    const theirs = await make(other.id);
    const answer = (item: Awaited<ReturnType<typeof make>>, correct: boolean) =>
      recordQuizAnswers({
        item,
        source: "queue",
        entries: [
          {
            question: q,
            answer: correct ? 0 : 1,
            confidence: "sure",
            result: { index: 0, type: "mcq", correct, feedback: "", explanation: "e", correctAnswer: "a" },
          },
        ],
      });
    await answer(mine, false);
    await answer(theirs, true);

    const insights = await loadInsights(course.id);
    expect(insights.week).toMatchObject({ reviews: 1, reviewAccuracy: 0, newMistakes: 1, activeDays: 1 });
    expect(insights.calibration.find((r) => r.confidence === "sure")).toMatchObject({ answers: 1, correct: 0 });
    const all = await loadInsights(null);
    expect(all.week.reviews).toBe(2);
  });
});
