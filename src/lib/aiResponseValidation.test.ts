import { describe, it, expect } from "vitest";
import {
  assertQuizContentShape,
  assertFlashcardsContentShape,
  assertGradingResultShape,
  normalizeStudyPlanOutline,
  normalizeResourceSuggestions,
  normalizeStudyPlanSupplement,
  normalizeStudyPlanReplan,
  InvalidAiResponseError,
} from "./aiResponseValidation";

describe("assertQuizContentShape", () => {
  it("accepts a well-formed short-answer question", () => {
    expect(() =>
      assertQuizContentShape({
        questions: [{ type: "short_answer", question: "Q?", explanation: "E", modelAnswer: "A" }],
      })
    ).not.toThrow();
  });

  it("accepts a well-formed mcq/multi_select question with options", () => {
    expect(() =>
      assertQuizContentShape({
        questions: [
          { type: "mcq", question: "Q?", explanation: "E", options: ["a", "b"], correctIndex: 0 },
          {
            type: "multi_select",
            question: "Q2?",
            explanation: "E2",
            options: ["a", "b"],
            correctIndices: [0, 1],
          },
        ],
      })
    ).not.toThrow();
  });

  it("rejects a missing questions array", () => {
    expect(() => assertQuizContentShape({})).toThrow(InvalidAiResponseError);
    expect(() => assertQuizContentShape(null)).toThrow(InvalidAiResponseError);
    expect(() => assertQuizContentShape("not an object")).toThrow(InvalidAiResponseError);
  });

  it("rejects a question missing required text fields", () => {
    expect(() => assertQuizContentShape({ questions: [{ question: "Q?" }] })).toThrow(
      InvalidAiResponseError
    );
  });

  it("rejects an mcq question missing options", () => {
    expect(() =>
      assertQuizContentShape({ questions: [{ type: "mcq", question: "Q?", explanation: "E" }] })
    ).toThrow(InvalidAiResponseError);
  });

  it("rejects a multi_select question missing correctIndices", () => {
    expect(() =>
      assertQuizContentShape({
        questions: [{ type: "multi_select", question: "Q?", explanation: "E", options: ["a"] }],
      })
    ).toThrow(InvalidAiResponseError);
  });

  // Regression coverage: these fields used to sail through unchecked and
  // reach the client as-is — e.g. attempt/route.ts's `q.options[q.correctIndex]`
  // for an out-of-range index produces `correctAnswer: undefined`, which got
  // stored in answers_json and shown to the student as "the correct answer"
  // instead of being caught here as a regenerable AI response error.
  it("rejects an mcq question with an out-of-range correctIndex", () => {
    expect(() =>
      assertQuizContentShape({
        questions: [{ type: "mcq", question: "Q?", explanation: "E", options: ["a", "b"], correctIndex: 2 }],
      })
    ).toThrow(InvalidAiResponseError);
  });

  it("rejects an mcq question with a missing/non-integer correctIndex", () => {
    expect(() =>
      assertQuizContentShape({
        questions: [{ type: "mcq", question: "Q?", explanation: "E", options: ["a", "b"] }],
      })
    ).toThrow(InvalidAiResponseError);
    expect(() =>
      assertQuizContentShape({
        questions: [
          { type: "mcq", question: "Q?", explanation: "E", options: ["a", "b"], correctIndex: 0.5 },
        ],
      })
    ).toThrow(InvalidAiResponseError);
  });

  it("rejects a multi_select question with an out-of-range correctIndices entry", () => {
    expect(() =>
      assertQuizContentShape({
        questions: [
          {
            type: "multi_select",
            question: "Q?",
            explanation: "E",
            options: ["a", "b"],
            correctIndices: [0, 5],
          },
        ],
      })
    ).toThrow(InvalidAiResponseError);
  });

  it("rejects a short_answer question missing its modelAnswer", () => {
    expect(() =>
      assertQuizContentShape({ questions: [{ type: "short_answer", question: "Q?", explanation: "E" }] })
    ).toThrow(InvalidAiResponseError);
  });
});

describe("assertFlashcardsContentShape", () => {
  it("accepts well-formed cards", () => {
    expect(() => assertFlashcardsContentShape({ cards: [{ front: "F", back: "B" }] })).not.toThrow();
  });

  it("rejects a missing cards array", () => {
    expect(() => assertFlashcardsContentShape({})).toThrow(InvalidAiResponseError);
  });

  it("rejects a card missing front/back text", () => {
    expect(() => assertFlashcardsContentShape({ cards: [{ front: "F" }] })).toThrow(
      InvalidAiResponseError
    );
  });
});

describe("assertGradingResultShape", () => {
  it("accepts a well-formed result matching the expected count", () => {
    expect(() =>
      assertGradingResultShape({ results: [{ verdict: "correct", feedback: "Nice" }] }, 1)
    ).not.toThrow();
  });

  it("rejects a missing results array", () => {
    expect(() => assertGradingResultShape({}, 1)).toThrow(InvalidAiResponseError);
  });

  it("rejects a result count mismatch", () => {
    expect(() =>
      assertGradingResultShape({ results: [{ verdict: "correct", feedback: "Nice" }] }, 2)
    ).toThrow(InvalidAiResponseError);
  });

  it("rejects an invalid verdict value", () => {
    expect(() =>
      assertGradingResultShape({ results: [{ verdict: "great", feedback: "Nice" }] }, 1)
    ).toThrow(InvalidAiResponseError);
  });

  it("rejects a result missing feedback", () => {
    expect(() => assertGradingResultShape({ results: [{ verdict: "correct" }] }, 1)).toThrow(
      InvalidAiResponseError
    );
  });
});

describe("normalizeStudyPlanOutline", () => {
  it("throws without chapters or with an untitled chapter", () => {
    expect(() => normalizeStudyPlanOutline({})).toThrow(InvalidAiResponseError);
    expect(() => normalizeStudyPlanOutline({ chapters: [] })).toThrow(InvalidAiResponseError);
    expect(() => normalizeStudyPlanOutline({ chapters: [{ summary: "x" }] })).toThrow(InvalidAiResponseError);
  });

  it("coerces optional fields to safe defaults", () => {
    expect(
      normalizeStudyPlanOutline({
        chapters: [{ title: " Foundations ", subtopics: ["a", 3, ""], prerequisites: [1, "2"], stage: "1" }],
      })
    ).toEqual({
      title: "Study plan",
      chapters: [
        {
          title: "Foundations",
          summary: "",
          subtopics: ["a"],
          prerequisites: [1],
          stage: 1,
          estimatedMinutes: null,
          matchedDocuments: [],
        },
      ],
    });
  });
});

describe("normalizeStudyPlanOutline estimatedMinutes", () => {
  it("rounds and clamps the estimate, dropping nonsense", () => {
    const minutes = (estimatedMinutes: unknown) =>
      normalizeStudyPlanOutline({ chapters: [{ title: "T", estimatedMinutes }] }).chapters[0].estimatedMinutes;
    expect(minutes(92.6)).toBe(93);
    expect(minutes(2)).toBe(10);
    expect(minutes(1e9)).toBe(12_000);
    expect(minutes(-5)).toBeNull();
    expect(minutes("lots")).toBeNull();
  });
});

describe("normalizeResourceSuggestions", () => {
  it("throws without a resources array", () => {
    expect(() => normalizeResourceSuggestions({})).toThrow(InvalidAiResponseError);
  });

  it("drops malformed entries and defaults an unknown kind to article", () => {
    expect(
      normalizeResourceSuggestions({
        resources: [
          { kind: "playlist", title: "Series", url: " https://example.org/p ", language: "EN", note: "why" },
          { kind: "podcast", title: "Talk", url: "https://example.org/t" },
          { title: "No url" },
          "junk",
        ],
      })
    ).toEqual([
      { kind: "playlist", title: "Series", url: "https://example.org/p", provider: undefined, language: "en", note: "why" },
      { kind: "article", title: "Talk", url: "https://example.org/t", provider: undefined, language: undefined, note: "" },
    ]);
  });
});

describe("normalizeStudyPlanSupplement", () => {
  it("throws without either list", () => {
    expect(() => normalizeStudyPlanSupplement({})).toThrow(InvalidAiResponseError);
  });

  it("keeps well-formed updates and new chapters, dropping the rest", () => {
    expect(
      normalizeStudyPlanSupplement({
        updates: [{ chapter: 2, newSubtopics: ["a", 1], matchedDocuments: ["x.pdf"] }, { chapter: "2" }],
        newChapters: [{ title: "New", subtopics: ["b"], prerequisites: [1], estimatedMinutes: 60 }, { summary: "no title" }],
      })
    ).toEqual({
      updates: [{ chapter: 2, newSubtopics: ["a"], matchedDocuments: ["x.pdf"] }],
      newChapters: [
        { title: "New", summary: "", subtopics: ["b"], prerequisites: [1], estimatedMinutes: 60, matchedDocuments: [] },
      ],
    });
    expect(normalizeStudyPlanSupplement({ updates: [] })).toEqual({ updates: [], newChapters: [] });
  });
});

describe("normalizeStudyPlanReplan", () => {
  it("clamps minutes, drops zero and malformed adjustments", () => {
    expect(
      normalizeStudyPlanReplan({
        adjustments: [
          { chapter: 1, extraReviewMinutes: 999 },
          { chapter: 2, extraReviewMinutes: 0 },
          { chapter: "3", extraReviewMinutes: 30 },
        ],
        message: " Keep going. ",
      })
    ).toEqual({ adjustments: [{ chapter: 1, extraReviewMinutes: 240 }], message: "Keep going." });
    expect(() => normalizeStudyPlanReplan("nope")).toThrow(InvalidAiResponseError);
  });
});
