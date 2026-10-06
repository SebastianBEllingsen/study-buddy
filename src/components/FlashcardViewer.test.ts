// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { handleFlashcardKeyDown, mixTurns } from "./FlashcardViewer";

describe("handleFlashcardKeyDown", () => {
  it("toggles the card when space is pressed outside a form field", () => {
    const onFlip = vi.fn();
    const onRate = vi.fn();
    const event = new KeyboardEvent("keydown", { key: " ", code: "Space" });
    Object.defineProperty(event, "target", { value: document.createElement("div"), configurable: true });

    const handled = handleFlashcardKeyDown({
      event,
      flipped: false,
      onFlip,
      onRate,
    });

    expect(handled).toBe(true);
    expect(onFlip).toHaveBeenCalledTimes(1);
    expect(onRate).not.toHaveBeenCalled();
  });

  it("ignores space while typing in an input", () => {
    const onFlip = vi.fn();
    const onRate = vi.fn();
    const event = new KeyboardEvent("keydown", { key: " ", code: "Space" });
    Object.defineProperty(event, "target", { value: document.createElement("input"), configurable: true });

    const handled = handleFlashcardKeyDown({
      event,
      flipped: false,
      onFlip,
      onRate,
    });

    expect(handled).toBe(false);
    expect(onFlip).not.toHaveBeenCalled();
    expect(onRate).not.toHaveBeenCalled();
  });

  it("rates the card when a number key is pressed after reveal", () => {
    const onFlip = vi.fn();
    const onRate = vi.fn();
    const event = new KeyboardEvent("keydown", { key: "3", code: "Digit3" });
    Object.defineProperty(event, "target", { value: document.createElement("div"), configurable: true });

    const handled = handleFlashcardKeyDown({
      event,
      flipped: true,
      onFlip,
      onRate,
    });

    expect(handled).toBe(true);
    expect(onRate).toHaveBeenCalledWith("good");
    expect(onFlip).not.toHaveBeenCalled();
  });

  it("picks a confidence with 1-3 before the reveal when supported", () => {
    const onConfidence = vi.fn();
    const onRate = vi.fn();
    const event = new KeyboardEvent("keydown", { key: "3", code: "Digit3" });
    Object.defineProperty(event, "target", { value: document.createElement("div"), configurable: true });

    expect(handleFlashcardKeyDown({ event, flipped: false, onFlip: vi.fn(), onRate, onConfidence })).toBe(true);
    expect(onConfidence).toHaveBeenCalledWith("sure");
    expect(onRate).not.toHaveBeenCalled();
  });

  it("ignores number keys before the reveal without a confidence handler, and 4 either way", () => {
    const make = (key: string) => {
      const event = new KeyboardEvent("keydown", { key });
      Object.defineProperty(event, "target", { value: document.createElement("div"), configurable: true });
      return event;
    };
    expect(handleFlashcardKeyDown({ event: make("1"), flipped: false, onFlip: vi.fn(), onRate: vi.fn() })).toBe(false);
    const onConfidence = vi.fn();
    expect(
      handleFlashcardKeyDown({ event: make("4"), flipped: false, onFlip: vi.fn(), onRate: vi.fn(), onConfidence })
    ).toBe(false);
    expect(onConfidence).not.toHaveBeenCalled();
  });
});

describe("mixTurns", () => {
  it("keeps the regular order and adds every reverse turn", () => {
    const turns = mixTurns([0, 1, 2], [5, 6], () => 0.5);
    expect(turns.filter((t) => !t.reverse).map((t) => t.index)).toEqual([0, 1, 2]);
    expect(turns.filter((t) => t.reverse).map((t) => t.index).sort()).toEqual([5, 6]);
  });

  it("never puts a card's reverse turn next to its regular turn", () => {
    for (let i = 0; i < 50; i++) {
      const turns = mixTurns([0, 1, 2, 3], [1, 2, 3], Math.random);
      turns.forEach((t, at) => {
        const next = turns[at + 1];
        if (next) expect(t.index === next.index).toBe(false);
      });
    }
  });
});
