import { describe, expect, it } from "vitest";
import { normalizeExamProfile, normalizeMockExam, normalizeRubric, normalizeTaskGrading } from "./validate";
import type { MockExamTask } from "./types";

describe("normalizeExamProfile", () => {
  it("normalizes topic shares, clamps numbers and cleans tasks", () => {
    const profile = normalizeExamProfile({
      examCount: 3,
      durationMinutes: 5000,
      totalPoints: "100",
      style: " Numbered subtasks. ",
      language: "German",
      topics: [
        { concept: "Graphs", share: 30 },
        { concept: "Logic", share: 10 },
        { concept: "", share: 5 },
      ],
      tasks: [{ title: "Prove it", concept: "Logic", points: 10, kind: "proof", difficulty: 7 }, { title: "", concept: "x" }],
    });
    expect(profile.durationMinutes).toBe(600);
    expect(profile.totalPoints).toBe(100);
    expect(profile.style).toBe("Numbered subtasks.");
    expect(profile.topics).toEqual([
      { concept: "Graphs", share: 0.75 },
      { concept: "Logic", share: 0.25 },
    ]);
    expect(profile.tasks).toEqual([{ title: "Prove it", concept: "Logic", points: 10, kind: "proof", difficulty: 3 }]);
  });

  it("rejects an analysis with no topics", () => {
    expect(() => normalizeExamProfile({ topics: [] })).toThrow();
  });
});

describe("normalizeRubric", () => {
  it("rescales criteria to add up to the task's points in half points", () => {
    const rubric = normalizeRubric([{ criterion: "Setup", points: 1 }, { criterion: "Result", points: 2 }], 10);
    expect(rubric.reduce((n, c) => n + c.points, 0)).toBe(10);
    expect(rubric.every((c) => c.points * 2 === Math.round(c.points * 2))).toBe(true);
    expect(normalizeRubric([], 6)).toEqual([{ criterion: "Correct, complete answer", points: 6 }]);
  });
});

describe("normalizeMockExam", () => {
  it("keeps tasks with prompts and defaults the rest", () => {
    const exam = normalizeMockExam({
      title: "Practice exam",
      tasks: [
        { title: "T1", prompt: "Compute $x$.", points: 8, concept: "Algebra", kind: "calculation", rubric: [{ criterion: "c", points: 8 }], solution: "x=1" },
        { title: "empty" },
        { prompt: "Explain.", kind: "weird" },
      ],
    });
    expect(exam.tasks).toHaveLength(2);
    expect(exam.tasks[1]).toMatchObject({ title: "Explain.", concept: "General", kind: "other", points: 10 });
    expect(() => normalizeMockExam({ tasks: [] })).toThrow();
  });
});

describe("normalizeTaskGrading", () => {
  const task: MockExamTask = {
    title: "T",
    prompt: "P",
    points: 10,
    concept: "C",
    kind: "calculation",
    rubric: [
      { criterion: "Method", points: 6 },
      { criterion: "Result", points: 4 },
    ],
    solution: "S",
  };

  it("clamps awarded points to the rubric and keeps a misconception only when points were lost", () => {
    const result = normalizeTaskGrading(
      {
        transcription: "x = 2",
        criteria: [
          { awarded: 9, comment: "good" },
          { awarded: 1.3, comment: "off by one" },
        ],
        feedback: "Nearly.",
        misconception: "Confuses x and y",
      },
      task
    );
    expect(result.criteria.map((c) => [c.criterion, c.awarded, c.max])).toEqual([
      ["Method", 6, 6],
      ["Result", 1.5, 4],
    ]);
    expect(result).toMatchObject({ points: 7.5, maxPoints: 10, misconception: "Confuses x and y", transcription: "x = 2" });

    const full = normalizeTaskGrading({ criteria: [{ awarded: 6 }, { awarded: 4 }], misconception: "none really", transcription: null }, task);
    expect(full.misconception).toBeNull();
    expect(full.transcription).toBeNull();
    expect(() => normalizeTaskGrading({}, task)).toThrow();
  });
});
