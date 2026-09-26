import { describe, expect, it } from "vitest";
import { examForAttempt, parseAnswers, parseDuration } from "./requests";
import { isAnswerImageUrl } from "./answerImages";
import { looksLikePastExam, pastExamRank } from "./detect";
import type { MockExam } from "./types";

describe("parseAnswers", () => {
  it("accepts one answer per task with allowed image URLs only", () => {
    const ok = [{ text: "a", images: ["data:image/jpeg;base64,AAAA", "/api/blobs/answer/x.jpg"] }, { text: "", images: [] }];
    expect(parseAnswers(ok, 2)).toEqual(ok);
    expect(parseAnswers(ok, 3)).toBeNull();
    expect(parseAnswers([{ text: "a", images: ["https://example.com/x.jpg"] }], 1)).toBeNull();
    expect(parseAnswers([{ text: "a", images: ["/api/blobs/note/x.jpg"] }], 1)).toBeNull();
    expect(parseAnswers([{ text: 1, images: [] }], 1)).toBeNull();
    expect(parseAnswers("x", 1)).toBeNull();
  });
});

describe("isAnswerImageUrl", () => {
  it("allows data URLs, local answer blobs and Supabase public answer objects", () => {
    expect(isAnswerImageUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isAnswerImageUrl("data:text/html;base64,AAAA")).toBe(false);
    expect(isAnswerImageUrl("/api/blobs/answer/a.png")).toBe(true);
    expect(isAnswerImageUrl("/api/blobs/answer/../../etc")).toBe(false);
    expect(isAnswerImageUrl("https://abc.supabase.co/storage/v1/object/public/files/answer/a.jpg")).toBe(true);
    expect(isAnswerImageUrl("https://abc.supabase.co/storage/v1/object/public/files/cover/a.jpg")).toBe(false);
    expect(isAnswerImageUrl(42)).toBe(false);
  });
});

describe("parseDuration", () => {
  it("is optional but bounded", () => {
    expect(parseDuration(undefined)).toBeUndefined();
    expect(parseDuration(90)).toBe(90);
    expect(parseDuration(5)).toBeNull();
    expect(parseDuration("90")).toBeNull();
  });
});

describe("looksLikePastExam", () => {
  it("spots common exam file names", () => {
    expect(looksLikePastExam("final_exam_2023.pdf")).toBe(true);
    expect(looksLikePastExam("Midterm-Spring.pdf")).toBe(true);
    expect(looksLikePastExam("lecture-notes-week3.pdf")).toBe(false);
    expect(looksLikePastExam("contest.pdf")).toBe(false);
    expect(pastExamRank("Exam_2021_tasks+solutions.pdf")).toBe(2);
    expect(pastExamRank("Test 1 attempt review.pdf")).toBe(1);
  });
});

describe("examForAttempt", () => {
  const exam: MockExam = {
    id: 1,
    course_id: 1,
    title: "Mock exam 1",
    duration_minutes: 60,
    total_points: 10,
    practice_item_id: null,
    created_at: "2026-01-01 00:00:00",
    tasks: [{ title: "T", prompt: "P", points: 10, concept: "C", kind: "other", rubric: [{ criterion: "c", points: 10 }], solution: "secret" }],
  };
  it("hides rubrics and solutions until the attempt is graded", () => {
    expect(JSON.stringify(examForAttempt(exam, { status: "in_progress" }))).not.toContain("secret");
    expect(JSON.stringify(examForAttempt(exam, { status: "grading" }))).not.toContain("secret");
    expect(examForAttempt(exam, { status: "graded" }).tasks[0].solution).toBe("secret");
  });
});
