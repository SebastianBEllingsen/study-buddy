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
const { codeExercisesSystemPrompt, codeProjectSystemPrompt } = await import("../prompts/code");
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
    const [ex] = normalizeCodeExercises("python", {
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
    expect(() => normalizeCodeExercises("python", { exercises: [] })).toThrow();
    expect(() => normalizeCodeExercises("python", "nope")).toThrow();
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
    expect(parseNewCodeSet({ language: "python", topic: " Loops " })).toEqual({ language: "python", chapterId: null, topic: "Loops", count: 4, project: false });
    // A project only for languages that can build from several files.
    expect(parseNewCodeSet({ language: "cpp", topic: "KV store", project: true })?.project).toBe(true);
    expect(parseNewCodeSet({ language: "python", topic: "KV store", project: true })?.project).toBe(false);
    // Project actions carry files in place of code.
    expect(parseCodeAction({ action: "save", exercise: 0, files: [{ name: "a.cpp", content: "x" }] })).toEqual({ action: "save", exercise: 0, code: "", files: [{ name: "a.cpp", content: "x" }] });
    expect(parseCodeAction({ action: "save", exercise: 0, files: [] })).toBeNull();
    expect(parseCodeAction({ action: "save", exercise: 0, files: [{ name: "a.cpp" }] })).toBeNull();
    expect(parseNewCodeSet({ language: "cpp", topic: "Pointers", count: 2 })?.count).toBe(2);
    // Out of range or not a whole number: the default.
    expect(parseNewCodeSet({ language: "cpp", topic: "Pointers", count: 99 })?.count).toBe(4);
    expect(parseNewCodeSet({ language: "cpp", topic: "Pointers", count: 1.5 })?.count).toBe(4);
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

  it("offers the numerical packages to Python exercises only, and asks for tolerant float tests", () => {
    const topic = { name: "ODEs", summary: "", subtopics: [] };
    const python = codeExercisesSystemPrompt("Sample Course", topic, "python", "English", []);
    expect(python).toContain("numpy, scipy, matplotlib and sympy");
    expect(python).toContain("tolerance");
    expect(codeExercisesSystemPrompt("Sample Course", topic, "javascript", "English", [])).not.toContain("numpy");
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

describe("C++ prompt", () => {
  const topic = { name: "Pointers", summary: "", subtopics: [] };
  it("teaches the test macros and the sanitizers, and asks for standalone code", () => {
    const prompt = codeExercisesSystemPrompt("Programming", topic, "cpp", "English", []);
    for (const word of ["CHECK_EQ", "CHECK_NEAR", "run_main", "AddressSanitizer", "#include", "Core Guidelines"]) {
      expect(prompt).toContain(word);
    }
    expect(prompt).not.toContain("numpy");
  });

  it("asks for the number of exercises wanted", () => {
    expect(codeExercisesSystemPrompt("P", topic, "cpp", "English", [], 2)).toContain("Write 2 exercises");
    expect(codeExercisesSystemPrompt("P", topic, "cpp", "English", [], 1)).toContain("Write 1 exercise");
    expect(codeExercisesSystemPrompt("P", topic, "cpp", "English", [])).toContain("Write 4 exercises");
  });
});

describe("each language's prompt", () => {
  const topic = { name: "Joins", summary: "", subtopics: [] };
  it("carries that language's own guidance and test style", () => {
    const expected = {
      python: ["`assert` statements", "numpy"],
      javascript: ["assert.equal"],
      cpp: ["CHECK_EQ", "Core Guidelines"],
      csharp: ["CheckEqual", ".NET design guidelines", "using directives"],
      sql: ['"setup"', "SQLite", '"expect"', "never \"predict\""],
    } as const;
    for (const [language, words] of Object.entries(expected)) {
      const prompt = codeExercisesSystemPrompt("Course", topic, language as never, "English", []);
      for (const word of words) expect(prompt, `${language}: ${word}`).toContain(word);
    }
  });

  it("keeps one language's guidance out of another's", () => {
    const sql = codeExercisesSystemPrompt("Course", topic, "sql", "English", []);
    expect(sql).not.toContain("CHECK_EQ");
    expect(sql).not.toContain("numpy");
    expect(codeExercisesSystemPrompt("Course", topic, "cpp", "English", [])).not.toContain('"setup"');
  });

  it("asks for project milestones with files, solution files and the interface fixed up front", () => {
    const prompt = codeProjectSystemPrompt("Course", topic, "cpp", "English", 3);
    for (const word of ['"kind": "project"', "solutionFiles", "pragma once", "CHECK_EQ", "Milestone", "public signatures"]) {
      expect(prompt).toContain(word);
    }
    expect(codeProjectSystemPrompt("Course", topic, "csharp", "English")).toContain("CheckEqual");
  });
});

