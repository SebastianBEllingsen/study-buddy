import { describe, expect, it } from "vitest";
import { applyCheckFlags, describeQuestion, factCheckSystemPrompt, factCheckUserPrompt, parseFactCheck } from "./factCheck";
import { normalizeConflicts } from "./conflicts";
import { normalizeFixSuggestion } from "./fixItem";
import { flashcardsSystemPrompt } from "./flashcards";
import { quizSystemPrompt, retryQuizSystemPrompt } from "./quiz";
import { notesSystemPrompt } from "./notes";


const sources = [
  { kind: "document" as const, id: 1, title: "Lecture 1.pdf" },
  { kind: "note" as const, id: 7, title: "Summary" },
];

describe("generation prompts", () => {
  it("explain source trust and ask cards and questions for their source", () => {
    for (const system of [flashcardsSystemPrompt("Sample Course"), quizSystemPrompt("Sample Course")]) {
      expect(system).toContain("[authoritative material]");
      expect(system).toContain('"source"');
    }
    expect(notesSystemPrompt("Sample Course")).toContain("[personal notes]");
    expect(retryQuizSystemPrompt("Sample Course")).not.toContain('"source"');
  });
});

describe("fact-check", () => {
  it("lists items by index and marks the keyed answer", () => {
    const text = describeQuestion({ type: "multi_select", question: "Q", options: ["a", "b", "c"], correctIndices: [0, 2], explanation: "e" });
    expect(text).toContain("A. a  (marked correct)");
    expect(text).not.toContain("B. b  (marked");
    expect(factCheckUserPrompt(["x", "y"])).toContain("### Item 1\ny");
    expect(factCheckUserPrompt(["x"])).toContain("well-established knowledge");
    expect(factCheckSystemPrompt("Sample Course", "German")).toContain("in German");
  });

  it("keeps one well-formed issue per existing item", () => {
    expect(
      parseFactCheck(
        {
          issues: [
            { index: 1, issue: " Wrong sign. " },
            { index: 1, issue: "Duplicate" },
            { index: 9, issue: "Out of range" },
            { index: 0, issue: "" },
            "junk",
          ],
        },
        3
      )
    ).toEqual([{ index: 1, issue: "Wrong sign." }]);
    expect(parseFactCheck(null, 3)).toEqual([]);
  });

  it("flags the items it found without overwriting an existing flag", () => {
    const existing = { by: "student" as const, issue: "Mine", at: "t0" };
    const items = applyCheckFlags(
      [{ front: "a" }, { front: "b" }, { front: "c", flag: existing }],
      [
        { index: 1, issue: "Wrong" },
        { index: 2, issue: "Also wrong" },
      ],
      "t1"
    );
    expect(items[0].flag).toBeUndefined();
    expect(items[1].flag).toEqual({ by: "check", issue: "Wrong", at: "t1" });
    expect(items[2].flag).toBe(existing);
  });
});

describe("normalizeConflicts", () => {
  it("resolves source names and drops one-sided or unnamed conflicts", () => {
    const result = normalizeConflicts(
      {
        conflicts: [
          {
            topic: "Boiling point",
            claims: [
              { source: "Lecture 1.pdf", says: "100 °C at sea level" },
              { source: "summary", says: "90 °C at sea level" },
            ],
            likelyCorrect: "Lecture 1.pdf",
            explanation: "Water boils at 100 °C at standard pressure.",
          },
          { topic: "One-sided", claims: [{ source: "Summary", says: "x" }] },
          { topic: "Same source twice", claims: [{ source: "Summary", says: "x" }, { source: "summary", says: "y" }] },
          { claims: [] },
        ],
      },
      sources
    );
    expect(result).toHaveLength(1);
    expect(result[0].claims.map((c) => c.source)).toEqual([sources[0], sources[1]]);
    expect(result[0].likelyCorrect).toEqual(sources[0]);
  });

  it("keeps a claim whose source name didn't match, unlinked", () => {
    const [conflict] = normalizeConflicts(
      { conflicts: [{ topic: "T", claims: [{ source: "Summary", says: "x" }, { source: "Other.pdf", says: "y" }] }] },
      sources
    );
    expect(conflict.claims[1]).toEqual({ source: null, name: "Other.pdf", says: "y" });
    expect(conflict.likelyCorrect).toBeNull();
  });
});

describe("normalizeFixSuggestion", () => {
  it("accepts a confirmation or a complete fix", () => {
    expect(normalizeFixSuggestion({ verdict: "correct", note: "It's right." }, "flashcards")).toEqual({
      verdict: "correct",
      note: "It's right.",
    });
    expect(normalizeFixSuggestion({ verdict: "fixed", note: "n", item: { front: "F", back: "B" } }, "flashcards")).toEqual({
      verdict: "fixed",
      note: "n",
      item: { front: "F", back: "B" },
    });
  });

  it("rejects a missing verdict or an incomplete fix", () => {
    expect(() => normalizeFixSuggestion({ note: "?" }, "flashcards")).toThrow();
    expect(() => normalizeFixSuggestion({ verdict: "fixed", item: { question: "Q" } }, "quiz")).toThrow();
  });
});
