import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestDb } from "../db/testHarness";

let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});
const generateStructured = vi.fn();
vi.mock("../aiClient", () => ({
  generateStructured: (...a: unknown[]) => generateStructured(...a),
}));

const { createCourse, getGeneratedItem } = await import("../models");
const { generateCodeSet, actOnCodeSet, allPassed, CodeSetError } = await import("./service");
const { normalizeCodeExercises } = await import("./validate");
const { parseCodeAction, parseNewCodeSet } = await import("./requests");
const { codeExercisesSystemPrompt } = await import("../prompts/code");
const reviewStore = await import("../review/store");

const exercise = {
  title: "Add",
  concept: "Functions",
  prompt: "Write `add(a, b)`.",
  starter: "def add(a, b):\n    pass\n",
  tests: [
    { name: "adds", code: "assert add(1, 2) == 3", hidden: false },
    { name: "negatives", code: "assert add(-1, -1) == -2", hidden: true },
  ],
  solution: "def add(a, b):\n    return a + b\n",
  hints: ["Use +."],
};

beforeEach(() => generateStructured.mockReset());

describe("normalizeCodeExercises", () => {
  it("keeps complete exercises, one visible test at least, unique test names", () => {
    const [ex] = normalizeCodeExercises({
      exercises: [
        {
          ...exercise,
          tests: [
            { name: "same", code: "assert 1", hidden: true },
            { name: "same", code: "assert 2", hidden: true },
            { name: "empty", code: "  " },
          ],
        },
        { title: "No tests", prompt: "x", solution: "y", tests: [] },
      ],
    });
    expect(ex.tests.map((t) => [t.name, t.hidden])).toEqual([
      ["same", false],
      ["same (2)", true],
    ]);
  });

  it("rejects output without usable exercises", () => {
    expect(() => normalizeCodeExercises({ exercises: [] })).toThrow();
    expect(() => normalizeCodeExercises("nope")).toThrow();
  });
});

describe("request parsing", () => {
  it("parses actions and new sets", () => {
    expect(parseCodeAction({ action: "run", exercise: 0, code: "x", error: null, tests: [{ name: "t", passed: true }] })).toEqual({
      action: "run",
      exercise: 0,
      code: "x",
      error: null,
      tests: [{ name: "t", passed: true, message: null }],
    });
    expect(parseCodeAction({ action: "run", exercise: 0, code: "x", tests: [{ name: "t" }] })).toBeNull();
    expect(parseCodeAction({ action: "hint", exercise: -1 })).toBeNull();
    expect(parseNewCodeSet({ language: "python", topic: " Loops " })).toEqual({ language: "python", chapterId: null, topic: "Loops" });
    expect(parseNewCodeSet({ language: "cobol", topic: "Loops" })).toBeNull();
    expect(parseNewCodeSet({ language: "python" })).toBeNull();
  });
});

describe("prompt", () => {
  it("asks for tests in the language's own style", () => {
    const topic = { name: "Loops", summary: "", subtopics: [] };
    expect(codeExercisesSystemPrompt("Sample Course", topic, "python", "English", [])).toContain("`assert` statements");
    expect(codeExercisesSystemPrompt("Sample Course", topic, "javascript", "English", [])).toContain("assert.equal");
  });
});

describe("allPassed", () => {
  it("needs a clean run with at least one test, all passing", () => {
    expect(allPassed({ error: null, tests: [{ passed: true }] })).toBe(true);
    expect(allPassed({ error: null, tests: [] })).toBe(false);
    expect(allPassed({ error: "SyntaxError", tests: [{ passed: true }] })).toBe(false);
    expect(allPassed({ error: null, tests: [{ passed: true }, { passed: false }] })).toBe(false);
  });
});

async function freshSet() {
  const course = await createCourse(`Sample Course ${Math.random()}`);
  generateStructured.mockResolvedValueOnce({ exercises: [exercise, { ...exercise, title: "Add again" }] });
  return generateCodeSet(course.id, { language: "python", chapterId: null, topic: "Functions" });
}

const pass = { error: null, tests: [{ name: "adds", passed: true, message: null }] };

describe("code sets", () => {
  it("are written from a topic, starting from the starter code", async () => {
    const set = await freshSet();
    expect(set.title).toBe("Python: Functions");
    expect(set.progress[0]).toMatchObject({ code: exercise.starter, done: false });
    expect(generateStructured.mock.calls[0][0].system).toContain('"Functions"');
  });

  it("finish when every test passes, and go into review once", async () => {
    const set = await freshSet();
    await actOnCodeSet(set.id, { action: "run", exercise: 0, code: "wrong", error: null, tests: [{ name: "adds", passed: false, message: "x" }] });
    let next = await actOnCodeSet(set.id, { action: "run", exercise: 0, code: exercise.solution, ...pass });
    expect(next.progress[0]).toMatchObject({ passed: true, done: true, runs: 2, code: exercise.solution });
    next = await actOnCodeSet(set.id, { action: "run", exercise: 0, code: exercise.solution, ...pass });
    const item = await getGeneratedItem(next.practice_item_id!);
    expect(item?.title).toBe("Code practice — Python: Functions");
    const reviews = await reviewStore.listReviewItemsForItem(item!.id, "question");
    expect(reviews.map((r) => r.item_index)).toEqual([0]);
    const logs = await testDb.db.select().from(testDb.schema.review_logs);
    expect(logs.filter((l) => l.review_item_id === reviews[0].id)).toHaveLength(1);
  });

  it("count as not solved when the solution is revealed first", async () => {
    const set = await freshSet();
    await actOnCodeSet(set.id, { action: "hint", exercise: 1 });
    const next = await actOnCodeSet(set.id, { action: "reveal", exercise: 1 });
    expect(next.progress[1]).toMatchObject({ revealed: true, done: true, passed: false, hintsUsed: 1 });
    const reviews = await reviewStore.listReviewItemsForItem(next.practice_item_id!, "question");
    const logs = await testDb.db.select().from(testDb.schema.review_logs);
    expect(logs.find((l) => l.review_item_id === reviews[0].id)?.correct).toBe(false);
  });

  it("autosave doesn't score anything", async () => {
    const set = await freshSet();
    const next = await actOnCodeSet(set.id, { action: "save", exercise: 0, code: "draft" });
    expect(next.progress[0]).toMatchObject({ code: "draft", runs: 0, done: false });
    expect(next.practice_item_id).toBeNull();
    await expect(actOnCodeSet(set.id, { action: "hint", exercise: 9 })).rejects.toBeInstanceOf(CodeSetError);
  });
});
