import { describe, it, expect } from "vitest";
import { computeDueCardIndices, deckDueCardIndices } from "./spacedRepetition";

describe("computeDueCardIndices", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");

  it("treats a card with no schedule row as due", () => {
    expect(computeDueCardIndices([], 3, now)).toEqual([0, 1, 2]);
  });

  it("treats a card whose due_at is in the past as due", () => {
    const schedule = [{ card_index: 0, due_at: "2026-01-01 00:00:00" }];
    expect(computeDueCardIndices(schedule, 1, now)).toEqual([0]);
  });

  it("treats a card whose due_at is exactly now as due (inclusive)", () => {
    const schedule = [{ card_index: 0, due_at: "2026-01-10 00:00:00" }];
    expect(computeDueCardIndices(schedule, 1, now)).toEqual([0]);
  });

  it("excludes a card whose due_at is in the future", () => {
    const schedule = [{ card_index: 0, due_at: "2026-02-01 00:00:00" }];
    expect(computeDueCardIndices(schedule, 1, now)).toEqual([]);
  });

  it("mixes due and not-due cards correctly", () => {
    const schedule = [
      { card_index: 0, due_at: "2026-01-01 00:00:00" }, // due
      { card_index: 1, due_at: "2026-02-01 00:00:00" }, // not due
      // card_index 2 has no schedule row at all -> due
    ];
    expect(computeDueCardIndices(schedule, 3, now)).toEqual([0, 2]);
  });
});

describe("deckDueCardIndices", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const schedule = [{ card_index: 0, due_at: "2026-01-01 00:00:00" }];
  const cards = [
    { front: "a", back: "a" },
    { front: "b", back: "b" },
  ];

  it("defaults to reminders on", () => {
    expect(deckDueCardIndices(schedule, { cards }, now)).toEqual([0, 1]);
    expect(deckDueCardIndices(schedule, { cards, reminders: true }, now)).toEqual([0, 1]);
  });

  it("has nothing due when the deck's reminders are off", () => {
    expect(deckDueCardIndices(schedule, { cards, reminders: false }, now)).toEqual([]);
  });

  it("holds flagged cards back", () => {
    const flagged = [cards[0], { ...cards[1], flag: { by: "student" as const, issue: "Wrong", at: "2026-01-01" } }];
    expect(deckDueCardIndices(schedule, { cards: flagged }, now)).toEqual([0]);
  });
});
