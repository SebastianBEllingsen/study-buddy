import { describe, it, expect } from "vitest";
import {
  assertQuizContentShape,
  assertFlashcardsContentShape,
  assertGradingResultShape,
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
