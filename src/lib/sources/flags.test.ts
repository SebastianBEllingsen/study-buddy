import { describe, expect, it } from "vitest";
import type { FlashcardsContent, QuizContent } from "../types";
import { cleanEntry, flaggedEntries, FlagError, keepEntry, removeEntry, replaceEntry, reportEntry } from "./flags";

const source = { kind: "document" as const, id: 4, title: "sample.pdf" };
const deck: FlashcardsContent = {
  cards: [
    { front: "Term A", back: "Definition A", concept: "Topic", source },
    { front: "Term B", back: "Definition B", frontMedia: [{ type: "image", src: "/api/blobs/1" }] },
  ],
  reminders: false,
};
const quiz: QuizContent = {
  questions: [
    { type: "mcq", question: "Pick", options: ["x", "y"], correctIndex: 0, explanation: "e", source },
    { type: "short_answer", question: "Explain", modelAnswer: "Because", explanation: "e" },
  ],
};

describe("reportEntry", () => {
  it("flags the item as reported by the student, with a default note", () => {
    const next = reportEntry("flashcards", deck, 1, "  ", "2026-01-01T00:00:00Z") as FlashcardsContent;
    expect(next.cards[1].flag).toEqual({ by: "student", issue: "Reported as wrong during review.", at: "2026-01-01T00:00:00Z" });
    expect(next.cards[0].flag).toBeUndefined();
    expect(next.reminders).toBe(false);
  });

  it("rejects an index that doesn't exist", () => {
    expect(() => reportEntry("quiz", quiz, 5, "x", "t")).toThrow(FlagError);
  });
});

describe("keepEntry / removeEntry", () => {
  it("keep clears the flag and nothing else", () => {
    const flagged = reportEntry("quiz", quiz, 0, "Wrong", "t");
    const kept = keepEntry("quiz", flagged, 0) as QuizContent;
    expect(kept.questions[0]).toEqual(quiz.questions[0]);
  });

  it("remove drops just that item", () => {
    expect((removeEntry("flashcards", deck, 0) as FlashcardsContent).cards.map((c) => c.front)).toEqual(["Term B"]);
  });
});

describe("replaceEntry", () => {
  it("swaps in the correction, keeping source and concept and clearing the flag", () => {
    const flagged = reportEntry("flashcards", deck, 0, "Wrong", "t");
    const fixed = replaceEntry("flashcards", flagged, 0, { front: "Term A", back: "Right definition" }) as FlashcardsContent;
    expect(fixed.cards[0]).toEqual({ front: "Term A", back: "Right definition", concept: "Topic", source });
  });

  it("keeps a card's media", () => {
    const fixed = replaceEntry("flashcards", deck, 1, { front: "Term B", back: "New" }) as FlashcardsContent;
    expect(fixed.cards[1].frontMedia).toEqual(deck.cards[1].frontMedia);
  });

  it("can turn a single-choice question into select-all", () => {
    const fixed = replaceEntry("quiz", quiz, 0, {
      type: "multi_select",
      question: "Pick",
      options: ["x", "y"],
      correctIndices: [0, 1],
      explanation: "Both",
    }) as QuizContent;
    expect(fixed.questions[0]).toMatchObject({ type: "multi_select", correctIndices: [0, 1], source });
  });
});

describe("cleanEntry", () => {
  it("rejects incomplete cards and questions", () => {
    expect(() => cleanEntry("flashcards", { front: "Only a front", back: " " })).toThrow(FlagError);
    expect(() => cleanEntry("quiz", { type: "mcq", question: "Q", options: ["a"], explanation: "e" })).toThrow(FlagError);
    expect(() => cleanEntry("quiz", null)).toThrow(FlagError);
  });
});

describe("flaggedEntries", () => {
  it("lists flagged items with their index", () => {
    const flagged = reportEntry("quiz", quiz, 1, "Ambiguous", "t");
    expect(flaggedEntries("quiz", flagged)).toEqual([
      { index: 1, entry: (flagged as QuizContent).questions[1], flag: { by: "student", issue: "Ambiguous", at: "t" } },
    ]);
  });
});
