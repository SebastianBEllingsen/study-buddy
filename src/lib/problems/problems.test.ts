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
const { createCoachSet, createMixedSet, actOnProblem, modelExpression, reviewVerdict, ProblemSetError } = await import("./service");
const { normalizeProblems, interleaveByConcept, reconcileVerdict } = await import("./validate");
const { checkUserPrompt, checkSystemPrompt, coachSystemPrompt } = await import("../prompts/problems");
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

describe("final-answer expressions", () => {
  const withExpr = (answerExpr: unknown, stage = "independent") =>
    normalizeProblems(
      { problems: [{ stage, concept: "Sums", statement: "s", steps: [step("a"), step("b")], blanks: [1], answer: "55", answerExpr }] },
      "coach"
    ).problems[0];

  it("keeps a one-line expression and drops anything else", () => {
    expect(withExpr("n*(n+1)/2").answerExpr).toBe("n*(n+1)/2");
    expect(withExpr("  3/4  ").answerExpr).toBe("3/4");
    for (const bad of ["", "   ", "a\nb", 42, null, undefined]) expect(withExpr(bad).answerExpr).toBeUndefined();
    expect(withExpr("x".repeat(500)).answerExpr).toHaveLength(200);
  });

  it("never reaches the browser — it only learns there's one to check against", () => {
    const problem = withExpr("n*(n+1)/2");
    const shown = publicProblem(problem, emptyProgress());
    expect(shown.checkable).toBe(true);
    expect(JSON.stringify(shown)).not.toContain("n*(n+1)/2");
    expect(publicProblem(problem, { ...emptyProgress(), done: true })).not.toHaveProperty("answerExpr");
    // No expression, or not a problem solved alone: nothing to check.
    expect(publicProblem(withExpr(""), emptyProgress()).checkable).toBe(false);
    expect(publicProblem(withExpr("3/4", "faded"), emptyProgress()).checkable).toBe(false);
  });

  it("is asked for when a set is written, and handed to the prompt as fact when checking", () => {
    const topic = { name: "Sums", summary: "", subtopics: [] };
    expect(coachSystemPrompt("Sample Course", topic, "English", null)).toContain('"answerExpr"');
    const problem = withExpr("3/4");
    const prompt = (match: "equal" | "close" | "different" | "unreadable") =>
      checkUserPrompt(problem, "solution", "my work", { text: "0.75", match });
    expect(prompt("equal")).toContain('"0.75" is EQUIVALENT to the model');
    expect(prompt("different")).toContain("NOT equivalent to");
    expect(prompt("close")).toContain("numerically close");
    // Unreadable (or no answer typed) says nothing, and the model answer's expression isn't in the prompt.
    expect(prompt("unreadable")).not.toContain("Computer algebra");
    expect(checkUserPrompt(problem, "solution", "my work")).not.toContain("Computer algebra");
    expect(prompt("equal")).not.toContain("3/4\nComputer");
    expect(checkSystemPrompt("English")).toContain("computer algebra check");
  });

  it("bounds the language model's verdict by what algebra found", () => {
    expect(reconcileVerdict("correct", "different")).toBe("partial");
    expect(reconcileVerdict("incorrect", "equal")).toBe("partial");
    // Everything else is left to the model.
    for (const [verdict, match] of [
      ["correct", "equal"], ["correct", "close"], ["correct", "unreadable"], ["correct", undefined],
      ["partial", "different"], ["incorrect", "different"], ["incorrect", "close"], ["partial", "equal"],
    ] as const) {
      expect(reconcileVerdict(verdict, match)).toBe(verdict);
    }
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

  it("takes a final answer and its comparison with a check, and asks for the model's expression", () => {
    const final = { text: " 3/4 ", match: "equal" };
    expect(parseProblemAction({ action: "check", problem: 2, text: "w", final })).toMatchObject({ final: { text: "3/4", match: "equal" } });
    // A malformed one is dropped, not an error: the check still goes ahead.
    for (const bad of [null, "x", {}, { text: "3", match: "yes" }, { text: "  ", match: "equal" }, { text: "x".repeat(501), match: "equal" }]) {
      expect(parseProblemAction({ action: "check", problem: 2, text: "w", final: bad })).toMatchObject({ action: "check", final: undefined });
    }
    expect(parseProblemAction({ action: "expr", problem: 2, text: " 3/4 " })).toEqual({ action: "expr", problem: 2, text: "3/4" });
    for (const bad of [{ action: "expr", problem: 2 }, { action: "expr", problem: 2, text: " " }, { action: "expr", problem: 2, text: 5 }]) {
      expect(parseProblemAction(bad)).toBeNull();
    }
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

  it("hands out the model's expression only for a problem solved alone, and clamps the verdict by the algebra check", async () => {
    const course = await createCourse("Expr Course");
    generateStructured.mockResolvedValueOnce({
      title: "x",
      problems: [
        { stage: "worked", concept: "Sums", statement: "a", steps: [step("s")], answer: "1", answerExpr: "1" },
        { stage: "independent", concept: "Sums", statement: "Sum 1..10", steps: [step("formula"), step("55")], answer: "55", answerExpr: "55" },
      ],
    });
    const set = await createCoachSet(course.id, { topic: "Sums" });
    expect(await modelExpression(set.id, 0)).toBeNull(); // the worked example
    expect(await modelExpression(set.id, 1)).toBe("55");
    await expect(modelExpression(set.id, 9)).rejects.toBeInstanceOf(ProblemSetError);

    // The AI says correct, but the algebra says the final answer differs: partial, and the check is recorded.
    generateStructured.mockResolvedValueOnce({ verdict: "correct", feedback: "Looks right." });
    const s = await actOnProblem(set.id, { action: "check", problem: 1, text: "my work", final: { text: "56", match: "different" } });
    expect(s.progress[1].solution).toMatchObject({ verdict: "partial", finalAnswer: { text: "56", match: "different" } });
    expect(s.progress[1].done).toBe(false);
    // The prompt carried the fact.
    expect(generateStructured.mock.calls.at(-1)?.[0].user).toContain("NOT equivalent to");
  });

  it("needs two topics for a mixed set", async () => {
    const course = await createCourse("Empty Course");
    await expect(createMixedSet(course.id)).rejects.toBeInstanceOf(ProblemSetError);
  });
});
