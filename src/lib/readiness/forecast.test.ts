import { describe, expect, it } from "vitest";
import { Rating, scheduleReview } from "../fsrs";
import { buildForecast, daysUntil, type ForecastSource } from "./forecast";

const NOW = new Date(2026, 2, 2, 12, 0);
const reviewed = (index: number, kind: "card" | "question") => ({
  ...scheduleReview(null, Rating.Good, new Date(2026, 2, 1, 12, 0), { fuzz: false }).memory,
  kind,
  item_index: index,
});

const sources: ForecastSource[] = [
  {
    mode: "flashcards",
    content: {
      cards: [
        { front: "a", back: "b", concept: "Graphs" },
        { front: "c", back: "d", concept: "Graphs" },
        { front: "e", back: "f" },
      ],
    },
    reviews: [reviewed(0, "card")],
  },
  {
    mode: "quiz",
    content: {
      questions: [
        { type: "short_answer", question: "q", modelAnswer: "a", explanation: "e", concept: "Logic" },
        { type: "short_answer", question: "q2", modelAnswer: "a", explanation: "e", concept: "Logic" },
      ],
    },
    reviews: [reviewed(0, "question")],
  },
];

describe("daysUntil", () => {
  it("counts whole local days", () => {
    expect(daysUntil("2026-03-02", NOW)).toBe(0);
    expect(daysUntil("2026-03-16", NOW)).toBe(14);
  });
});

describe("buildForecast", () => {
  it("projects recall to exam day, holds learned items at the target if kept up, and skips unanswered questions", () => {
    const f = buildForecast(sources, {
      examDate: "2026-04-01",
      now: NOW,
      retention: 0.9,
      chapterByConcept: new Map([["graphs", { id: 7, title: "Graph theory" }]]),
    });
    expect(f.daysLeft).toBe(30);
    expect(f.overall).toMatchObject({ items: 4, reviewed: 2 });
    const graphs = f.concepts.find((c) => c.name === "Graphs")!;
    expect(graphs).toMatchObject({ items: 2, reviewed: 1, chapterId: 7 });
    expect(graphs.ifKeptUp).toBeCloseTo(0.45, 5);
    expect(graphs.ifStopped).toBeLessThan(graphs.ifKeptUp);
    expect(f.concepts.find((c) => c.name === "Logic")).toMatchObject({ items: 1, reviewed: 1 });
    expect(f.concepts.find((c) => c.name === "Untagged")).toMatchObject({ items: 1, reviewed: 0, ifKeptUp: 0 });
    expect(f.chapters).toEqual([expect.objectContaining({ name: "Graph theory", chapterId: 7, items: 2 })]);
    // Weakest first.
    expect(f.concepts[0].name).toBe("Untagged");
  });

  it("forecasts nearer exams higher when you stop reviewing", () => {
    const soon = buildForecast(sources, { examDate: "2026-03-04", now: NOW, retention: 0.9, chapterByConcept: new Map() });
    const late = buildForecast(sources, { examDate: "2026-06-01", now: NOW, retention: 0.9, chapterByConcept: new Map() });
    expect(soon.overall.ifStopped).toBeGreaterThan(late.overall.ifStopped);
  });
});
