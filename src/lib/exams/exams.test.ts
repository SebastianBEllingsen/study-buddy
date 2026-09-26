import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestDb } from "../db/testHarness";

let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});
const generateStructured = vi.fn();
const generateText = vi.fn();
vi.mock("../aiClient", () => ({
  generateStructured: (...a: unknown[]) => generateStructured(...a),
  generateText: (...a: unknown[]) => generateText(...a),
  getModelInfo: vi.fn().mockResolvedValue({ provider: "api", model: "test-model" }),
}));

const { createCourse, createDocument, getGeneratedItem, markDocumentExtracted } = await import("../models");
const { findOrCreateConcepts } = await import("../review/concepts");
const { analyzePastExams, NoPastExamsError } = await import("./analyze");
const { generateMockExam, NoExamProfileError } = await import("./generate");
const { gradeAttempt } = await import("./grade");
const store = await import("./store");
const { listMistakes } = await import("../review/mistakes");
const reviewStore = await import("../review/store");

const profile = {
  examCount: 1,
  durationMinutes: 120,
  totalPoints: 20,
  style: "Two tasks with subtasks.",
  language: "English",
  topics: [{ concept: "Sets", share: 1 }],
  tasks: [{ title: "Set proof", concept: "Sets", points: 10, kind: "proof", difficulty: 2 }],
};
const examJson = {
  title: "Mock exam",
  tasks: [
    { title: "Union", prompt: "Show $A \\cup A = A$.", points: 10, concept: "Sets", kind: "proof", rubric: [{ criterion: "Both inclusions", points: 10 }], solution: "Both ways." },
    { title: "Count", prompt: "How many subsets has a 3-set?", points: 10, concept: "Counting", kind: "short_answer", rubric: [{ criterion: "Answer 8", points: 10 }], solution: "8" },
  ],
};

async function courseWithExamDoc() {
  const course = await createCourse(`Sample Course ${Math.random()}`);
  const doc = await createDocument({
    courseId: course.id,
    folderId: null,
    filename: "final_exam_2024.pdf",
    filePath: "final_exam_2024.pdf",
    fileBase64: null,
  });
  await markDocumentExtracted({ id: doc.id, extractedText: "1. Prove that ...", pageCount: 1, charCount: 16 });
  return { course, doc };
}

beforeEach(() => {
  generateStructured.mockReset();
  generateText.mockReset();
});

describe("mock exam pipeline", () => {
  it("analyses past exams, writes an exam, grades an attempt and feeds review", async () => {
    const { course, doc } = await courseWithExamDoc();
    await expect(analyzePastExams(course.id, [999])).rejects.toBeInstanceOf(NoPastExamsError);

    generateStructured.mockResolvedValueOnce(profile);
    await analyzePastExams(course.id, [doc.id]);
    expect(generateStructured.mock.calls[0][0].user).toContain("final_exam_2024.pdf");
    expect((await store.getExamProfile(course.id))?.sourceDocumentIds).toEqual([doc.id]);

    generateStructured.mockResolvedValueOnce(examJson);
    const exam = await generateMockExam(course.id, { durationMinutes: 60 });
    expect(exam).toMatchObject({ title: "Mock exam 1", duration_minutes: 60, total_points: 20 });
    expect(generateStructured.mock.calls[1][0].system).toContain("60 minutes");

    const attempt = await store.createAttempt(exam.id, 2);
    await store.saveAnswers(attempt.id, [
      { text: "One inclusion only", images: [] },
      { text: "", images: [] },
    ]);
    generateText.mockResolvedValueOnce(
      JSON.stringify({ transcription: null, criteria: [{ awarded: 4, comment: "half" }], feedback: "Show the other way.", misconception: "Thinks one inclusion is enough" })
    );
    await gradeAttempt(attempt.id);

    // The blank answer is graded without an AI call.
    expect(generateText).toHaveBeenCalledTimes(1);
    const graded = await store.getAttempt(attempt.id);
    expect(graded).toMatchObject({ status: "graded", score: 4 });
    expect(graded?.results?.[1]).toMatchObject({ points: 0, feedback: "No answer given." });

    const withItem = await store.getMockExam(exam.id);
    const item = await getGeneratedItem(withItem!.practice_item_id!);
    expect(item?.title).toBe("Exam practice — Mock exam 1");
    expect((await reviewStore.listReviewItemsForItem(item!.id, "question")).map((r) => r.item_index).sort()).toEqual([0, 1]);
    const mistakes = (await listMistakes({ courseId: course.id })).filter((m) => m.generated_item_id === item!.id);
    expect(mistakes.map((m) => [m.item_index, m.misconception])).toEqual(
      expect.arrayContaining([
        [0, "Thinks one inclusion is enough"],
        [1, null],
      ])
    );
  });

  it("marks the attempt failed with the reason when grading breaks", async () => {
    const { course, doc } = await courseWithExamDoc();
    generateStructured.mockResolvedValueOnce(profile).mockResolvedValueOnce(examJson);
    await analyzePastExams(course.id, [doc.id]);
    const exam = await generateMockExam(course.id);
    const attempt = await store.createAttempt(exam.id, 2);
    await store.saveAnswers(attempt.id, [
      { text: "x", images: [] },
      { text: "y", images: [] },
    ]);
    generateText.mockRejectedValue(new Error("rate limited"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await gradeAttempt(attempt.id);
    expect(await store.getAttempt(attempt.id)).toMatchObject({ status: "failed", error_message: "rate limited" });
  });

  it("lists exams with their attempts and deletes them", async () => {
    const { course, doc } = await courseWithExamDoc();
    generateStructured.mockResolvedValueOnce(profile).mockResolvedValueOnce(examJson);
    await analyzePastExams(course.id, [doc.id]);
    const exam = await generateMockExam(course.id);
    await store.createAttempt(exam.id, 2);
    const [listed] = await store.listMockExams(course.id);
    expect(listed).toMatchObject({ id: exam.id, taskCount: 2, attempts: [expect.objectContaining({ status: "in_progress" })] });
    await store.deleteMockExam(exam.id);
    expect(await store.listMockExams(course.id)).toEqual([]);
  });

  it("pauses and resumes the clock, adding up paused time", async () => {
    const { course, doc } = await courseWithExamDoc();
    generateStructured.mockResolvedValueOnce(profile).mockResolvedValueOnce(examJson);
    await analyzePastExams(course.id, [doc.id]);
    const exam = await generateMockExam(course.id);
    const attempt = await store.createAttempt(exam.id, 2);
    await store.setAttemptPaused(attempt, true);
    const paused = await store.getAttempt(attempt.id);
    expect(paused?.paused_at).not.toBeNull();
    const later = new Date(Date.parse(`${paused!.paused_at!.replace(" ", "T")}Z`) + 90_000);
    await store.setAttemptPaused(paused!, false, later);
    expect(await store.getAttempt(attempt.id)).toMatchObject({ paused_at: null, paused_seconds: 90 });
    await store.deleteAttempt(attempt.id);
    expect(await store.getAttempt(attempt.id)).toBeNull();
  });
});

describe("skill checks (no past exams)", () => {
  it("refuses a course with nothing to test", async () => {
    const course = await createCourse(`Sample Course ${Math.random()}`);
    await expect(generateMockExam(course.id)).rejects.toBeInstanceOf(NoExamProfileError);
  });

  it("tests the practised concepts, with no past-exam sample", async () => {
    const course = await createCourse(`Sample Course ${Math.random()}`);
    await findOrCreateConcepts(course.id, ["Loops", "Recursion"]);
    generateStructured.mockResolvedValueOnce(examJson);
    const exam = await generateMockExam(course.id);
    expect(exam).toMatchObject({ title: "Skill check 1", duration_minutes: 60 });
    const { system, user } = generateStructured.mock.calls[0][0];
    expect(system).toContain("skill check");
    expect(system).toContain("Loops 50%");
    expect(system).not.toContain("past exams look like");
    expect(user).not.toContain("past exam");
  });

  it("draws on the material when there are no topics yet", async () => {
    const { course } = await courseWithExamDoc();
    generateStructured.mockResolvedValueOnce(examJson);
    await generateMockExam(course.id);
    expect(generateStructured.mock.calls[0][0].system).toContain("take the main topics from the material outline");
    expect(generateStructured.mock.calls[0][0].user).toContain("Outline of the course material");
  });
});
