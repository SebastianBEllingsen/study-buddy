import { describe, expect, it } from "vitest";
import { scheduleReview, Rating } from "../fsrs";
import { summarizeKnowledge, type KnowledgeSource } from "./knowledgeSummary";

const NOW = new Date("2026-03-10T10:00:00Z");
const reviewed = (index: number, kind: "card" | "question", at: string) => ({
  ...scheduleReview(null, Rating.Good, new Date(at), { fuzz: false }).memory,
  kind,
  item_index: index,
});

describe("summarizeKnowledge", () => {
  it("groups by concept, counts never-reviewed items as 0 recall and sorts weakest first", () => {
    const sources: KnowledgeSource[] = [
      {
        mode: "flashcards",
        content: {
          cards: [
            { front: "a", back: "b", concept: "Sorting" },
            { front: "c", back: "d", concept: "sorting" },
            { front: "e", back: "f" },
            { front: "g", back: "h", concept: "Graphs" },
          ],
        },
        reviews: [reviewed(0, "card", "2026-03-09T10:00:00Z"), reviewed(3, "card", "2026-03-09T10:00:00Z")],
      },
      {
        mode: "quiz",
        content: {
          questions: [{ type: "short_answer", question: "q", modelAnswer: "a", explanation: "e", concept: "Graphs" }],
        },
        reviews: [reviewed(0, "question", "2026-03-09T10:00:00Z"), reviewed(0, "card", "2026-01-01T10:00:00Z")],
      },
    ];
    const summary = summarizeKnowledge(sources, {
      now: NOW,
      chapterByConcept: new Map([["graphs", 4]]),
      openMistakesByConcept: new Map([["sorting", 2]]),
    });
    expect(summary.untagged).toBe(1);
    expect(summary.concepts.map((c) => [c.name, c.items, c.reviewed, c.openMistakes, c.chapterId])).toEqual([
      ["Sorting", 2, 1, 2, null],
      ["Graphs", 2, 2, 0, 4],
    ]);
    const [sorting, graphs] = summary.concepts;
    expect(sorting.recall).toBeGreaterThan(0);
    expect(sorting.recall).toBeLessThan(0.6);
    expect(graphs.recall).toBeGreaterThan(0.8);
  });
});
