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

const { createCourse } = await import("../models");
const { createCoachSet, createMixedSet, actOnProblem, reviewVerdict, ProblemSetError } = await import("./service");
const { normalizeProblems, interleaveByConcept } = await import("./validate");
const { publicProblem } = await import("./view");
const { parseProblemAction } = await import("./requests");
const reviewStore = await import("../review/store");
const { listMistakes } = await import("../review/mistakes");
const { emptyProgress } = await import("./types");

const step = (t: string) => ({ text: t, hint: `hint ${t}` });
const coachJson = {
  title: "x",
  problems: [
    { stage: "independent", concept: "Sums", statement: "Sum 1..10", steps: [step("formula"), step("55")], answer: "55" },
    { stage: "worked", concept: "Sums", statement: "Sum 1..4", steps: [step("formula"), step("10")], answer: "10" },
    { stage: "faded", concept: "Sums", statement: "Sum 1..6", steps: [step("formula"), step("n=6"), step("21")], blanks: [2, 0, 9], answer: "21" },
    { stage: "independent", concept: "Sums", statement: "Sum 1..100", steps: [step("formula"), step("5050")], answer: "5050" },
  ],
};

beforeEach(() => generateStructured.mockReset());

describe("normalizeProblems", () => {
  it("orders a coached set worked → faded → independent and drops invalid blanks", () => {
    const { problems } = normalizeProblems(coachJson, "coach");
    expect(problems.map((p) => p.stage)).toEqual(["worked", "faded", "independent", "independent"]);
    expect(problems[1].blanks).toEqual([2]);
  });

  it("makes every mixed problem independent and interleaves concepts", () => {
    const { problems } = normalizeProblems(
      {
        problems: ["A", "A", "A", "B", "B", "C"].map((c, i) => ({ stage: "worked", concept: c, statement: `P${i}`, steps: [step("s")], answer: "a" })),
      },
      "mixed"
    );
    expect(problems.every((p) => p.stage === "independent")).toBe(true);
    const concepts = problems.map((p) => p.concept);
    expect(concepts.every((c, i) => i === 0 || c !== concepts[i - 1])).toBe(true);
    expect(() => normalizeProblems({ problems: [] }, "coach")).toThrow();
  });

  it("interleaves where it can", () => {
    expect(interleaveByConcept([{ concept: "a" }, { concept: "a" }, { concept: "b" }]).map((x) => x.concept)).toEqual(["a", "b", "a"]);
  });
});

describe("publicProblem", () => {
  const [worked, faded, independent] = normalizeProblems(coachJson, "coach").problems;
  it("shows worked examples in full", () => {
    expect(publicProblem(worked, emptyProgress()).steps.every((s) => s.text)).toBe(true);
  });
  it("hides a faded problem's blanks until filled correctly or revealed", () => {
    expect(publicProblem(faded, emptyProgress()).steps.map((s) => s.text)).toEqual(["formula", "n=6", null]);
    expect(publicProblem(faded, { ...emptyProgress(), revealed: [2] }).steps[2].text).toBe("21");
    expect(publicProblem(faded, emptyProgress()).answer).toBeNull();
    expect(publicProblem(faded, { ...emptyProgress(), done: true }).answer).toBe("21");
  });
  it("hides an independent problem's working, answer and unused hints", () => {
    const hidden = publicProblem(independent, { ...emptyProgress(), hintsUsed: 1 });
    expect(hidden.steps).toEqual([
      { text: null, hint: "hint formula" },
      { text: null, hint: null },
    ]);
    expect(hidden.answer).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain("55");
    expect(publicProblem(independent, { ...emptyProgress(), done: true }).answer).toBe("55");
  });
});

describe("reviewVerdict", () => {
  it("discounts correct solutions that leaned on hints", () => {
    expect(reviewVerdict("correct", 0)).toEqual({ verdict: "correct", confidence: null });
    expect(reviewVerdict("correct", 1)).toEqual({ verdict: "correct", confidence: "unsure" });
    expect(reviewVerdict("correct", 3)).toEqual({ verdict: "partial", confidence: null });
    expect(reviewVerdict("incorrect", 3)).toEqual({ verdict: "incorrect", confidence: null });
  });
});

describe("parseProblemAction", () => {
  it("accepts known actions only", () => {
    expect(parseProblemAction({ action: "check", problem: 1, step: 2, text: "x" })).toEqual({ action: "check", problem: 1, step: 2, text: "x" });
    expect(parseProblemAction({ action: "hint", problem: 0 })).toEqual({ action: "hint", problem: 0 });
    expect(parseProblemAction({ action: "check", problem: 1, text: 3 })).toBeNull();
    expect(parseProblemAction({ action: "nope", problem: 1 })).toBeNull();
    expect(parseProblemAction({ action: "hint", problem: -1 })).toBeNull();
  });
});

describe("problem set flow", () => {
  it("coaches through a set and scores the first independent attempt for review", async () => {
    const course = await createCourse("Sample Course");
    generateStructured.mockResolvedValueOnce(coachJson);
    const set = await createCoachSet(course.id, { topic: "Arithmetic series" });
    expect(set.title).toBe("Coached: Arithmetic series");
    expect(generateStructured.mock.calls[0][0].system).toContain("Arithmetic series");

    let s = await actOnProblem(set.id, { action: "done", problem: 0 });
    expect(s.progress[0].done).toBe(true);

    generateStructured.mockResolvedValueOnce({ verdict: "incorrect", feedback: "Recheck the sum." });
    s = await actOnProblem(set.id, { action: "check", problem: 1, step: 2, text: "20" });
    expect(s.progress[1]).toMatchObject({ done: false, stepAnswers: { 2: { verdict: "incorrect" } } });
    s = await actOnProblem(set.id, { action: "reveal", problem: 1, step: 2 });
    expect(s.progress[1].done).toBe(true);

    s = await actOnProblem(set.id, { action: "hint", problem: 2 });
    expect(s.progress[2].hintsUsed).toBe(1);
    generateStructured.mockResolvedValueOnce({ verdict: "partial", feedback: "Almost." });
    s = await actOnProblem(set.id, { action: "check", problem: 2, text: "n(n+1)/2 = 50" });
    expect(s.progress[2]).toMatchObject({ done: false, solution: { verdict: "partial" } });
    generateStructured.mockResolvedValueOnce({ verdict: "correct", feedback: "Yes." });
    s = await actOnProblem(set.id, { action: "check", problem: 2, text: "55" });
    expect(s.progress[2].done).toBe(true);

    // Only the first attempt was scored, as a mistake on question 2.
    const reviews = await reviewStore.listReviewItemsForItem(s.practice_item_id!, "question");
    expect(reviews.map((r) => r.item_index)).toEqual([2]);
    expect((await listMistakes({ courseId: course.id })).map((m) => m.item_index)).toEqual([2]);

    // Giving up on the last one records it as not solved.
    s = await actOnProblem(set.id, { action: "reveal", problem: 3 });
    expect(s.progress[3].done).toBe(true);
    expect((await reviewStore.listReviewItemsForItem(s.practice_item_id!, "question")).map((r) => r.item_index).sort()).toEqual([2, 3]);

    await expect(actOnProblem(set.id, { action: "check", problem: 0, text: "x" })).rejects.toBeInstanceOf(ProblemSetError);
    await expect(actOnProblem(set.id, { action: "hint", problem: 1 })).rejects.toBeInstanceOf(ProblemSetError);
  });

  it("needs two topics for a mixed set", async () => {
    const course = await createCourse("Empty Course");
    await expect(createMixedSet(course.id)).rejects.toBeInstanceOf(ProblemSetError);
  });
});
