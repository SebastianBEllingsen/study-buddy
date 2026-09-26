import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CourseContext } from "./context";

// generateForCourse pulls in the whole DB layer transitively through
// ./models and ./context — mocked out entirely so this only exercises the
// chunk-distribution logic (the thing this test file exists to cover),
// never touching a real database.
const generateStructured = vi.fn();
const generateText = vi.fn();
vi.mock("./aiClient", () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
  generateText: (...args: unknown[]) => generateText(...args),
  getModelInfo: vi.fn().mockResolvedValue({ provider: "test", model: "test" }),
}));

const buildCourseContext = vi.fn();
vi.mock("./context", () => ({
  buildCourseContext: (...args: unknown[]) => buildCourseContext(...args),
  chunkCourseContext: (context: CourseContext) => context.combinedText.split("|"),
  combineDocumentText: vi.fn(),
}));

const createGeneratedItem = vi.fn(async (params: Record<string, unknown>) => ({ id: 1, ...params }));
const getCourse = vi.fn();
vi.mock("./models", () => ({
  createGeneratedItem: (params: Record<string, unknown>) => createGeneratedItem(params),
  getCourse: (...args: unknown[]) => getCourse(...args),
  getFolder: vi.fn(),
  getNewDocumentsForItem: vi.fn(),
  updateGeneratedItemContent: vi.fn(),
  getAppSettings: vi.fn().mockResolvedValue({ aiEfficiencyMode: false }),
}));

const { generateForCourse, chapterTopicText, topicText, NoDocumentsError } = await import("./generate");

function fakeContext(chunkCount: number): CourseContext {
  return {
    courseId: 1,
    courseName: "Test Course",
    folderId: null,
    handpicked: false,
    scopeLabel: "All material",
    documentIds: [1],
    noteIds: [],
    sources: [{ kind: "document", id: 1, title: "sample.pdf" }],
    combinedText: Array.from({ length: chunkCount }, (_, i) => `chunk ${i}`).join("|"),
    estimatedTokens: 999_999,
    needsChunking: true,
  };
}

// Pulls the "Generate exactly N questions total" instruction (or the
// unstructured-settings "N total" phrasing) out of a quiz system prompt so
// tests can check what total each chunked call actually asked for, without
// re-implementing quizComposition's own formatting logic here.
function totalFromQuizPrompt(system: string): number {
  const structured = system.match(/Generate exactly (\d+) questions total/);
  if (structured) return Number(structured[1]);
  const simple = system.match(/\((\d+) total\)/);
  if (simple) return Number(simple[1]);
  throw new Error(`Could not find a question total in prompt: ${system}`);
}

beforeEach(() => {
  generateStructured.mockReset();
  generateText.mockReset();
  buildCourseContext.mockReset();
  generateStructured.mockResolvedValue({ questions: [] });
});

describe("generateForCourse — chunked quiz generation", () => {
  it("distributes the 12-question total across chunks instead of asking every chunk for 12", async () => {
    buildCourseContext.mockResolvedValue(fakeContext(4));

    await generateForCourse(1, "quiz");

    expect(generateStructured).toHaveBeenCalledTimes(4);
    const totals = generateStructured.mock.calls.map(([params]) => totalFromQuizPrompt(params.system));
    expect(totals.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it("skips chunks assigned zero questions rather than calling the model for them", async () => {
    // 25 chunks, only 12 total questions to distribute — distributeCount
    // gives the last 13 chunks a count of 0, which should mean 12 calls,
    // not 25 (this is the actual over-generation bug: before the fix, this
    // scenario produced 25 * 12 = 300 questions from 25 model calls).
    buildCourseContext.mockResolvedValue(fakeContext(25));

    await generateForCourse(1, "quiz");

    expect(generateStructured).toHaveBeenCalledTimes(12);
    const totals = generateStructured.mock.calls.map(([params]) => totalFromQuizPrompt(params.system));
    expect(totals.every((n) => n === 1)).toBe(true);
    expect(totals.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it("still asks a single (unchunked) call for the full 12", async () => {
    buildCourseContext.mockResolvedValue({ ...fakeContext(1), needsChunking: false, combinedText: "short course" });

    await generateForCourse(1, "quiz");

    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(totalFromQuizPrompt(generateStructured.mock.calls[0][0].system)).toBe(12);
  });
});

describe("generateForCourse — chunked flashcard generation", () => {
  it("distributes the 20-card total across chunks instead of asking every chunk for 20", async () => {
    buildCourseContext.mockResolvedValue(fakeContext(5));
    generateStructured.mockResolvedValue({ cards: [] });

    await generateForCourse(1, "flashcards");

    expect(generateStructured).toHaveBeenCalledTimes(5);
    const totals = generateStructured.mock.calls.map(
      ([params]) => Number(params.system.match(/Generate around (\d+) cards/)?.[1])
    );
    expect(totals.every((n) => !Number.isNaN(n))).toBe(true);
    expect(totals.reduce((a, b) => a + b, 0)).toBe(20);
  });
});

describe("generateForCourse for a study-plan chapter", () => {
  const chapter = { id: 42, title: "Foundations", summary: "The basics.", subtopics: ["Idea A", "Idea B"] };

  beforeEach(() => {
    createGeneratedItem.mockClear();
    getCourse.mockResolvedValue({ id: 1, name: "Test Course" });
    generateStructured.mockResolvedValue({ cards: [{ front: "Q", back: "A" }] });
  });

  it("uses the chapter's documents, titles the item after the chapter, and links it", async () => {
    buildCourseContext.mockResolvedValue({ ...fakeContext(1), needsChunking: false, combinedText: "doc text" });
    await generateForCourse(1, "flashcards", { documentIds: [7], studyPlanChapter: chapter });
    expect(buildCourseContext).toHaveBeenCalledWith(1, expect.objectContaining({ documentIds: [7] }));
    expect(createGeneratedItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Flashcards — Foundations", studyPlanChapterId: 42 })
    );
  });

  it("teaches from the chapter's topics when it has no documents", async () => {
    buildCourseContext.mockClear();
    await generateForCourse(1, "flashcards", { documentIds: null, studyPlanChapter: chapter });
    expect(buildCourseContext).not.toHaveBeenCalled();
    const { user } = generateStructured.mock.calls.at(-1)![0];
    expect(user).toContain("no course documents");
    expect(user).toContain("- Idea B");
    expect(createGeneratedItem).toHaveBeenCalledWith(expect.objectContaining({ sourceDocumentIds: [] }));
  });

  it("falls back to the topics when the linked documents have gone", async () => {
    buildCourseContext.mockResolvedValue({ ...fakeContext(1), documentIds: [], combinedText: "", needsChunking: false });
    await generateForCourse(1, "flashcards", { documentIds: [7], studyPlanChapter: chapter });
    expect(generateStructured.mock.calls.at(-1)![0].user).toContain("Chapter: Foundations");
  });

  it("still refuses an ordinary generation with no documents", async () => {
    buildCourseContext.mockResolvedValue({ ...fakeContext(1), documentIds: [], combinedText: "" });
    await expect(generateForCourse(1, "flashcards")).rejects.toBeInstanceOf(NoDocumentsError);
  });

  it("writes the topic text with the no-documents note first", () => {
    expect(chapterTopicText({ title: "T", summary: "", subtopics: [] }).split("\n")[0]).toMatch(/no course documents/);
  });
});

describe("generateForCourse — sources and fact-check", () => {
  beforeEach(() => {
    createGeneratedItem.mockClear();
    getCourse.mockResolvedValue({ id: 1, name: "Test Course" });
  });

  it("links each card to the section it names and flags what the check finds", async () => {
    buildCourseContext.mockResolvedValue({
      ...fakeContext(1),
      needsChunking: false,
      combinedText: "--- Document: sample.pdf [authoritative material] ---\ntext",
      noteIds: [3],
      sources: [
        { kind: "document", id: 1, title: "sample.pdf" },
        { kind: "note", id: 3, title: "My summary" },
      ],
    });
    generateStructured
      .mockResolvedValueOnce({
        cards: [
          { front: "Q1", back: "A1", source: "sample.pdf" },
          { front: "Q2", back: "A2", source: "my summary" },
          { front: "Q3", back: "A3", source: "unknown.pdf" },
        ],
      })
      .mockResolvedValueOnce({ issues: [{ index: 1, issue: "The answer should be B." }] });

    await generateForCourse(1, "flashcards");

    expect(generateStructured).toHaveBeenCalledTimes(2);
    const check = generateStructured.mock.calls[1][0];
    expect(check.user).toContain("Front: Q2");
    expect(check.user).toContain("sample.pdf");
    const { contentJson } = createGeneratedItem.mock.calls.at(-1)![0] as { contentJson: { cards: Record<string, unknown>[] } };
    expect(contentJson.cards[0].source).toEqual({ kind: "document", id: 1, title: "sample.pdf" });
    expect(contentJson.cards[1].source).toEqual({ kind: "note", id: 3, title: "My summary" });
    expect(contentJson.cards[2].source).toBeUndefined();
    expect(contentJson.cards[1].flag).toMatchObject({ by: "check", issue: "The answer should be B." });
    expect(contentJson.cards[0].flag).toBeUndefined();
  });

  it("keeps the items unflagged when the check itself fails", async () => {
    buildCourseContext.mockResolvedValue({ ...fakeContext(1), needsChunking: false, combinedText: "text" });
    generateStructured
      .mockResolvedValueOnce({ cards: [{ front: "Q", back: "A" }] })
      .mockRejectedValueOnce(new Error("provider down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await generateForCourse(1, "flashcards");

    const { contentJson } = createGeneratedItem.mock.calls.at(-1)![0] as { contentJson: { cards: Record<string, unknown>[] } };
    expect(contentJson.cards[0].flag).toBeUndefined();
    error.mockRestore();
  });

  it("generates from marked notes even when the scope has no documents", async () => {
    buildCourseContext.mockResolvedValue({
      ...fakeContext(1),
      documentIds: [],
      noteIds: [3],
      needsChunking: false,
      combinedText: "--- Note: My summary [authoritative material] ---\ntext",
    });
    generateStructured.mockResolvedValue({ cards: [] });
    await expect(generateForCourse(1, "flashcards")).resolves.toBeTruthy();
  });
});

describe("generateForCourse from a typed topic", () => {
  beforeEach(() => {
    createGeneratedItem.mockClear();
    getCourse.mockResolvedValue({ id: 1, name: "Test Course" });
    generateStructured.mockResolvedValue({ cards: [] });
  });

  it("generates from the topic when the scope has no material", async () => {
    buildCourseContext.mockResolvedValue({ ...fakeContext(1), documentIds: [], combinedText: "", needsChunking: false });
    await generateForCourse(1, "flashcards", { topic: "  Recursion " });
    expect(generateStructured.mock.calls[0][0].user).toContain("Topic: Recursion");
    expect(createGeneratedItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Flashcards — Recursion", sourceDocumentIds: [] })
    );
  });

  it("ignores the topic when there is material", async () => {
    buildCourseContext.mockResolvedValue({ ...fakeContext(1), needsChunking: false, combinedText: "doc text" });
    await generateForCourse(1, "flashcards", { topic: "Recursion" });
    expect(generateStructured.mock.calls[0][0].user).toContain("doc text");
    expect(generateStructured.mock.calls[0][0].user).not.toContain("Topic: Recursion");
  });

  it("still refuses an empty scope with a blank topic", async () => {
    buildCourseContext.mockResolvedValue({ ...fakeContext(1), documentIds: [], combinedText: "" });
    await expect(generateForCourse(1, "flashcards", { topic: "   " })).rejects.toBeInstanceOf(NoDocumentsError);
  });

  it("tells the model to teach from established knowledge", () => {
    expect(topicText("Recursion")).toMatch(/well-established knowledge/);
  });
});
