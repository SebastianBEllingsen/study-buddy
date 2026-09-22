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

vi.mock("./models", () => ({
  createGeneratedItem: vi.fn(async (params: Record<string, unknown>) => ({ id: 1, ...params })),
  getCourse: vi.fn(),
  getFolder: vi.fn(),
  getNewDocumentsForItem: vi.fn(),
  updateGeneratedItemContent: vi.fn(),
  getAppSettings: vi.fn().mockResolvedValue({ aiEfficiencyMode: false }),
}));

const { generateForCourse } = await import("./generate");

function fakeContext(chunkCount: number): CourseContext {
  return {
    courseId: 1,
    courseName: "Test Course",
    folderId: null,
    handpicked: false,
    scopeLabel: "All material",
    documentIds: [1],
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
