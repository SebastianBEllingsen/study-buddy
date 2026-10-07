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

const { createCourse } = await import("../models");
const { generateCodeSet, actOnCodeSet, codePracticeContent, outputsMatch, CodeSetError } = await import("./service");
const { normalizeCodeExercises, normalizeReview } = await import("./validate");
const { parseCodeAction } = await import("./requests");
const { listMistakes } = await import("../review/mistakes");

const base = { title: "T", concept: "Pointers", hints: ["h1"] };
const write = {
  ...base,
  kind: "write",
  prompt: "Write `inc`.",
  starter: "int inc(int x) { return 0; }",
  tests: [{ name: "inc", code: "CHECK_EQ(inc(1), 2);", hidden: false }],
  solution: "int inc(int x) { return x + 1; }",
};
const predict = {
  ...base,
  kind: "predict",
  title: "What prints?",
  prompt: "",
  starter: '#include <iostream>\nint main() { std::cout << 7 / 2; }',
  answer: "3",
};
const read = {
  ...base,
  kind: "read",
  title: "Who owns it?",
  prompt: "Who frees the buffer?",
  starter: "void f() { auto p = std::make_unique<int>(1); }",
  answer: "The unique_ptr frees it when f returns.",
};

beforeEach(() => generateStructured.mockReset());

// Open mistakes on one set's practice quiz (the database is shared by every test here).
async function mistakesOf(itemId: number) {
  return (await listMistakes({ status: "open" })).filter((m) => m.generated_item_id === itemId);
}

async function setOf(...exercises: unknown[]) {
  const course = await createCourse(`Programming ${Math.random()}`);
  generateStructured.mockResolvedValueOnce({ exercises });
  return generateCodeSet(course.id, { language: "cpp", chapterId: null, topic: "Pointers" });
}

describe("exercise kinds", () => {
  it("validates each kind on what it needs", () => {
    const list = normalizeCodeExercises("cpp", {
      exercises: [
        write,
        predict,
        read,
        { ...write, kind: "nonsense" }, // unknown kind falls back to write
        { ...read, answer: "" }, // no answer: unusable
        { ...predict, starter: "  " }, // nothing to read: unusable
        { ...write, kind: "debug", starter: "" }, // nothing to debug: unusable
      ],
    });
    expect(list.map((e) => e.kind)).toEqual(["write", "predict", "read", "write"]);
    expect(list[1]).toMatchObject({ tests: [], solution: "", answer: "3", prompt: "What does this program print, exactly?" });
    expect(list[0].answer).toBe("");
  });

  it("treats exercises saved before kinds existed as write exercises", async () => {
    const set = await setOf({ ...write, kind: undefined });
    expect(set.exercises[0].kind).toBe("write");
    expect(set.progress[0]).toMatchObject({ answer: "", review: null });
  });

  it("puts the code to read into the review question, and the right answer behind it", () => {
    const content = codePracticeContent({
      language: "cpp",
      exercises: normalizeCodeExercises("cpp", { exercises: [write, predict, { ...write, kind: "debug", starter: "int f() {}" }] }),
    } as never);
    const [w, p, d] = content.questions;
    expect(w.type === "short_answer" && w.modelAnswer).toContain("return x + 1");
    expect(w.question).not.toContain("return 0");
    expect(p.question).toContain("std::cout << 7 / 2");
    expect(p.type === "short_answer" && p.modelAnswer).toBe("3");
    expect(d.question).toContain("int f() {}");
  });
});

describe("predict the output", () => {
  it("matches ignoring trailing spaces and edge blank lines, not the content", () => {
    expect(outputsMatch("3 \n\n", "3")).toBe(true);
    expect(outputsMatch("a  \nb\r\n", "a\nb")).toBe(true);
    expect(outputsMatch("3.5", "3")).toBe(false);
  });

  it("stays open on a wrong answer, and finishes into review on the right one", async () => {
    const set = await setOf(predict);
    let next = await actOnCodeSet(set.id, { action: "answer", exercise: 0, answer: "3.5" });
    expect(next.progress[0]).toMatchObject({ answer: "3.5", runs: 1, done: false, passed: false });
    expect(next.practice_item_id).toBeNull();
    next = await actOnCodeSet(set.id, { action: "answer", exercise: 0, answer: "3\n" });
    expect(next.progress[0]).toMatchObject({ passed: true, done: true, runs: 2 });
    expect(next.practice_item_id).not.toBeNull();
  });

  it("counts a revealed answer as not solved", async () => {
    const set = await setOf(predict);
    const next = await actOnCodeSet(set.id, { action: "reveal", exercise: 0 });
    expect(next.progress[0]).toMatchObject({ passed: false, done: true, revealed: true });
  });
});

describe("read the code", () => {
  it("waits for the learner's own verdict after comparing with the model answer", async () => {
    const set = await setOf(read, read);
    let next = await actOnCodeSet(set.id, { action: "answer", exercise: 0, answer: "the unique_ptr, at the end" });
    expect(next.progress[0]).toMatchObject({ answer: "the unique_ptr, at the end", done: false });
    next = await actOnCodeSet(set.id, { action: "answer", exercise: 0, answer: "the unique_ptr, at the end", selfCorrect: true });
    expect(next.progress[0]).toMatchObject({ passed: true, done: true, revealed: true });
    next = await actOnCodeSet(set.id, { action: "answer", exercise: 1, answer: "no idea", selfCorrect: false });
    expect(next.progress[1]).toMatchObject({ passed: false, done: true });
  });

  it("refuses the wrong kind of action for an exercise", async () => {
    const set = await setOf(write, read);
    await expect(actOnCodeSet(set.id, { action: "answer", exercise: 0, answer: "x" })).rejects.toThrow(CodeSetError);
    await expect(
      actOnCodeSet(set.id, { action: "run", exercise: 1, code: "x", error: null, tests: [{ name: "a", passed: true, message: null }] })
    ).rejects.toThrow(CodeSetError);
  });
});

describe("AI review of a solution", () => {
  const solve = (setId: number) =>
    actOnCodeSet(setId, { action: "run", exercise: 0, code: write.solution, error: null, tests: [{ name: "inc", passed: true, message: null }] });

  it("only reviews solved exercises", async () => {
    const set = await setOf(write);
    await expect(actOnCodeSet(set.id, { action: "review", exercise: 0 })).rejects.toThrow(/Solve the exercise first/);
    expect(generateStructured).toHaveBeenCalledTimes(1); // just the exercises
  });

  it("stores the review, and sends the learner's code and the reference to the model", async () => {
    const set = await setOf(write);
    await solve(set.id);
    generateStructured.mockResolvedValueOnce({
      verdict: "good",
      summary: "Clean and correct.",
      points: [{ kind: "edge-case", text: "INT_MAX overflows." }],
    });
    const next = await actOnCodeSet(set.id, { action: "review", exercise: 0 });
    expect(next.progress[0].review).toEqual({
      verdict: "good",
      summary: "Clean and correct.",
      points: [{ kind: "edge-case", text: "INT_MAX overflows." }],
    });
    const call = generateStructured.mock.calls.at(-1)![0];
    expect(call.system).toContain("senior C++ engineer");
    expect(call.user).toContain(write.solution);
    // Merely "good": nothing goes into the mistake log.
    expect(await mistakesOf(next.practice_item_id!)).toHaveLength(0);
  });

  it("logs a real problem as a mistake, with the point as its misconception", async () => {
    const set = await setOf(write);
    await solve(set.id);
    generateStructured.mockResolvedValueOnce({
      verdict: "needs_work",
      summary: "Passes, but fragile.",
      points: [{ kind: "memory", text: "The buffer is never freed." }],
    });
    const next = await actOnCodeSet(set.id, { action: "review", exercise: 0 });
    const open = await mistakesOf(next.practice_item_id!);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ generated_item_id: expect.any(Number), item_index: 0, misconception: "The buffer is never freed." });
    expect(open[0].given_answer).toBe(write.solution);
  });
});

describe("normalizeReview", () => {
  it("keeps the verdict consistent with the points, and defaults unknown kinds", () => {
    expect(normalizeReview({ verdict: "great", summary: "ok", points: [{ kind: "weird", text: "x" }] })).toEqual({
      verdict: "good",
      summary: "ok",
      points: [{ kind: "style", text: "x" }],
    });
    expect(normalizeReview({ verdict: "needs_work", summary: "bad", points: [] }).verdict).toBe("good");
    expect(normalizeReview({ summary: "fine", points: [] }).verdict).toBe("great");
  });

  it("limits the points and rejects an empty review", () => {
    const points = Array.from({ length: 9 }, (_, i) => ({ kind: "style", text: `p${i}` }));
    expect(normalizeReview({ verdict: "good", summary: "s", points }).points).toHaveLength(5);
    expect(() => normalizeReview({ points: [] })).toThrow();
    expect(() => normalizeReview(null)).toThrow();
  });
});

describe("request parsing for the new actions", () => {
  it("parses answers (with an optional self-assessment) and review requests", () => {
    expect(parseCodeAction({ action: "answer", exercise: 1, answer: "3" })).toEqual({ action: "answer", exercise: 1, answer: "3" });
    expect(parseCodeAction({ action: "answer", exercise: 1, answer: "3", selfCorrect: false })).toEqual({
      action: "answer",
      exercise: 1,
      answer: "3",
      selfCorrect: false,
    });
    expect(parseCodeAction({ action: "answer", exercise: 1 })).toBeNull();
    expect(parseCodeAction({ action: "answer", exercise: 1, answer: "x".repeat(6000) })).toBeNull();
    expect(parseCodeAction({ action: "review", exercise: 0 })).toEqual({ action: "review", exercise: 0 });
  });
});

describe("project milestones", () => {
  const files = [
    { name: "stack.hpp", content: "#pragma once\nstruct Stack { void push(int); };" },
    { name: "stack.cpp", content: '#include "stack.hpp"\nvoid Stack::push(int) {}' },
  ];
  const solutionFiles = [files[0], { name: "stack.cpp", content: '#include "stack.hpp"\nvoid Stack::push(int) { /* done */ }' }];
  const milestone = {
    ...base,
    kind: "project",
    title: "Milestone 1: the stack",
    prompt: "Implement `Stack::push` in `stack.cpp`.",
    files,
    solutionFiles,
    tests: [{ name: "push", code: "Stack s; s.push(1);", hidden: false }],
  };

  it("validates a milestone's files, and drops it where projects don't apply", () => {
    const [m] = normalizeCodeExercises("cpp", { exercises: [milestone] });
    expect(m).toMatchObject({ kind: "project", starter: "", solution: "", files, solutionFiles });
    // Python and SQL can't build from several files.
    expect(() => normalizeCodeExercises("python", { exercises: [milestone] })).toThrow();
    expect(() => normalizeCodeExercises("sql", { exercises: [milestone] })).toThrow();
    // A milestone needs both sets of files, valid names, and tests.
    for (const broken of [
      { ...milestone, files: [] },
      { ...milestone, solutionFiles: undefined },
      { ...milestone, files: [{ name: "../x.cpp", content: "" }] },
      { ...milestone, files: [{ name: "x.py", content: "" }] },
      { ...milestone, tests: [] },
    ]) {
      expect(() => normalizeCodeExercises("cpp", { exercises: [broken] })).toThrow();
    }
  });

  it("starts from the starter files, keeps the learner's files when run, and joins them for review", async () => {
    const set = await setOf(milestone);
    expect(set.progress[0].files).toEqual(files);
    const edited = [files[0], { name: "stack.cpp", content: '#include "stack.hpp"\nvoid Stack::push(int v) { (void)v; }' }, { name: "extra.hpp", content: "#pragma once" }];
    const next = await actOnCodeSet(set.id, {
      action: "run",
      exercise: 0,
      code: "",
      files: edited,
      error: null,
      tests: [{ name: "push", passed: true, message: null }],
    });
    expect(next.progress[0]).toMatchObject({ passed: true, done: true, files: edited });
    // The practice question shows the starter files; its model answer is the reference files, each named.
    const q = codePracticeContent(next).questions[0];
    expect(q.question).toContain("// stack.hpp");
    expect(q.type === "short_answer" && q.modelAnswer).toContain("// stack.cpp");
    expect(q.type === "short_answer" && q.modelAnswer).toContain("/* done */");
  });

  it("refuses files that don't suit the language, or on a single-file exercise", async () => {
    const set = await setOf(milestone, write);
    const bad = [{ name: "notes.txt", content: "x" }];
    await expect(actOnCodeSet(set.id, { action: "save", exercise: 0, code: "", files: bad })).rejects.toThrow(/Those files can't be used/);
    await expect(actOnCodeSet(set.id, { action: "save", exercise: 1, code: "x", files })).rejects.toThrow(/single file/);
  });

  it("reviews a solved project from its files", async () => {
    const set = await setOf(milestone);
    await actOnCodeSet(set.id, { action: "run", exercise: 0, code: "", files, error: null, tests: [{ name: "push", passed: true, message: null }] });
    generateStructured.mockResolvedValueOnce({ verdict: "good", summary: "Fine.", points: [] });
    await actOnCodeSet(set.id, { action: "review", exercise: 0 });
    const user = generateStructured.mock.calls.at(-1)![0].user as string;
    expect(user).toContain("// stack.hpp");
    expect(user).toContain("/* done */");
  });
});

