import { describe, expect, it } from "vitest";
import { buildFocusQueue, buildQueue, conceptKeys, interleave, questionForQueue, type QueueSource } from "./queueBuild";
import type { QueueReview } from "./queueBuild";

const NOW = new Date("2026-03-02T10:00:00Z");

function review(kind: "card" | "question", index: number, due_at: string): QueueReview {
  return { kind, item_index: index, due_at };
}

function deck(itemId: number, cardCount: number, reviews: QueueReview[] = [], reminders?: boolean): QueueSource {
  return {
    itemId,
    itemTitle: `Deck ${itemId}`,
    courseId: 1,
    courseName: "Sample Course",
    mode: "flashcards",
    content: {
      cards: Array.from({ length: cardCount }, (_, i) => ({ front: `F${itemId}.${i}`, back: "B" })),
      ...(reminders === undefined ? {} : { reminders }),
    },
    reviews,
  };
}

function quiz(itemId: number, reviews: QueueReview[]): QueueSource {
  return {
    itemId,
    itemTitle: `Quiz ${itemId}`,
    courseId: 1,
    courseName: "Sample Course",
    mode: "quiz",
    content: {
      questions: [
        { type: "mcq", question: "Q0", options: ["a", "b"], correctIndex: 1, explanation: "e", concept: "Topic" },
        { type: "short_answer", question: "Q1", modelAnswer: "secret", explanation: "e" },
      ],
    },
    reviews,
  };
}

describe("interleave", () => {
  it("takes one from each group in turn", () => {
    expect(interleave<number | string>([[1, 2, 3], ["a"], [], ["x", "y"]])).toEqual([1, "a", "x", 2, "y", 3]);
  });
});

describe("buildQueue", () => {
  it("includes due cards and questions but not ones due later, and never unanswered questions", () => {
    const { entries, counts } = buildQueue(
      [
        deck(1, 2, [review("card", 0, "2026-03-01 00:00:00"), review("card", 1, "2026-03-09 00:00:00")]),
        quiz(2, [review("question", 1, "2026-03-02 09:00:00")]),
      ],
      { now: NOW, newCardAllowance: 10, limit: 100 }
    );
    expect(entries.map((e) => e.key)).toEqual(["1:card:0", "2:question:1"]);
    expect(counts).toEqual({ dueCards: 1, dueQuestions: 1, newCards: 0 });
  });

  it("interleaves sets, most overdue first", () => {
    const { entries } = buildQueue(
      [
        deck(1, 2, [review("card", 0, "2026-03-01 05:00:00"), review("card", 1, "2026-03-01 06:00:00")]),
        deck(2, 2, [review("card", 0, "2026-02-20 00:00:00"), review("card", 1, "2026-02-21 00:00:00")]),
      ],
      { now: NOW, newCardAllowance: 0, limit: 100 }
    );
    expect(entries.map((e) => e.key)).toEqual(["2:card:0", "1:card:0", "2:card:1", "1:card:1"]);
  });

  it("caps new cards at the day's allowance and spreads them through the reviews", () => {
    const { entries, counts } = buildQueue(
      [
        deck(1, 4, [review("card", 0, "2026-03-01 00:00:00"), review("card", 1, "2026-03-01 00:00:00")]),
        deck(2, 3),
      ],
      { now: NOW, newCardAllowance: 2, limit: 100 }
    );
    expect(counts.newCards).toBe(2);
    const newKeys = entries.filter((e) => e.isNew).map((e) => e.key);
    expect(newKeys).toEqual(["1:card:2", "2:card:0"]);
    expect(entries[0].isNew).toBe(false);
    expect(entries[entries.length - 1].isNew).toBe(true);
    expect(entries.findIndex((e) => e.isNew)).toBeLessThan(entries.length - 1);
  });

  it("skips decks with reminders off and respects the limit", () => {
    const { entries } = buildQueue([deck(1, 5, [], false), deck(2, 5)], { now: NOW, newCardAllowance: 20, limit: 3 });
    expect(entries.map((e) => e.itemId)).toEqual([2, 2, 2]);
  });

  it("treats a negative allowance as none", () => {
    expect(buildQueue([deck(1, 3)], { now: NOW, newCardAllowance: -4, limit: 10 }).entries).toEqual([]);
  });

  it("sends questions without their answer key", () => {
    const { entries } = buildQueue([quiz(2, [review("question", 0, "2026-03-01 00:00:00")])], {
      now: NOW,
      newCardAllowance: 0,
      limit: 10,
    });
    expect(entries[0]).toMatchObject({ kind: "question", concept: "Topic" });
    expect(JSON.stringify(entries[0])).not.toContain("correctIndex");
    expect(
      questionForQueue({ type: "multi_select", question: "Q", options: ["a", "b", "c"], correctIndices: [0, 2], explanation: "e" })
    ).toEqual({ type: "multi_select", question: "Q", options: ["a", "b", "c"], answerCount: 2 });
    expect(JSON.stringify(questionForQueue({ type: "short_answer", question: "Q", modelAnswer: "secret", explanation: "e" }))).not.toContain(
      "secret"
    );
  });
});

describe("buildFocusQueue / conceptKeys", () => {
  it("builds entries for the given keys in order, due or not, skipping gone ones", () => {
    const sources = [
      deck(1, 3, [review("card", 2, "2099-01-01 00:00:00")], false),
      quiz(2, []),
    ];
    const entries = buildFocusQueue(sources, ["2:question:1", "1:card:2", "1:card:9", "3:card:0", "1:card:2"], 10);
    expect(entries.map((e) => [e.key, e.isNew])).toEqual([
      ["2:question:1", true],
      ["1:card:2", false],
    ]);
    expect(buildFocusQueue(sources, ["1:card:0", "1:card:1"], 1)).toHaveLength(1);
  });

  it("finds a concept's items, never-reviewed first then least recently due", () => {
    const tagged: QueueSource = {
      ...deck(4, 0),
      content: {
        cards: [
          { front: "a", back: "b", concept: "Graphs" },
          { front: "c", back: "d", concept: "Trees" },
          { front: "e", back: "f", concept: "graphs" },
        ],
      },
      reviews: [review("card", 0, "2026-03-05 00:00:00")],
    };
    expect(conceptKeys([tagged, quiz(2, [])], "graphs")).toEqual(["4:card:2", "4:card:0"]);
    expect(conceptKeys([quiz(2, [])], "topic")).toEqual(["2:question:0"]);
  });
});

describe("flagged items", () => {
  const flag = { by: "check" as const, issue: "Contradicts the lecture", at: "2026-03-01" };

  function flaggedDeck(): QueueSource {
    const source = deck(1, 2, [review("card", 0, "2026-03-01 00:00:00")]);
    const content = source.content as unknown as { cards: Record<string, unknown>[] };
    content.cards[0] = { ...content.cards[0], flag, concept: "Topic" };
    content.cards[1] = { ...content.cards[1], flag };
    return source;
  }

  function flaggedQuiz(): QueueSource {
    const source = quiz(2, [review("question", 0, "2026-03-01 00:00:00")]);
    const content = source.content as unknown as { questions: Record<string, unknown>[] };
    content.questions[0] = { ...content.questions[0], flag };
    return source;
  }

  it("are held out of the daily queue, due or new", () => {
    const { entries, counts } = buildQueue([flaggedDeck(), flaggedQuiz()], { now: NOW, newCardAllowance: 10, limit: 100 });
    expect(entries).toEqual([]);
    expect(counts).toEqual({ dueCards: 0, dueQuestions: 0, newCards: 0 });
  });

  it("are skipped by focused sessions and concept lookups", () => {
    expect(buildFocusQueue([flaggedDeck(), flaggedQuiz()], ["1:card:0", "2:question:0", "2:question:1"], 10).map((e) => e.key)).toEqual([
      "2:question:1",
    ]);
    expect(conceptKeys([flaggedDeck(), flaggedQuiz()], "topic")).toEqual([]);
  });
});
