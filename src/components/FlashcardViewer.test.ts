// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { handleFlashcardKeyDown } from "./FlashcardViewer";

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
});
