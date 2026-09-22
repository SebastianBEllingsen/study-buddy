import { describe, it, expect } from "vitest";
import { toggleTaskMarkerAtLine } from "./taskList";

describe("toggleTaskMarkerAtLine", () => {
  it("checks an unchecked box", () => {
    expect(toggleTaskMarkerAtLine("- [ ] wash the car", 0)).toBe("- [x] wash the car");
  });

  it("unchecks a checked box", () => {
    expect(toggleTaskMarkerAtLine("- [x] wash the car", 0)).toBe("- [ ] wash the car");
  });

  it("is case-insensitive on the way in but always writes a lowercase x", () => {
    expect(toggleTaskMarkerAtLine("- [X] wash the car", 0)).toBe("- [ ] wash the car");
  });

  it("toggles only the given line, leaving the others untouched", () => {
    const markdown = ["- [ ] one", "- [ ] two", "- [x] three"].join("\n");
    expect(toggleTaskMarkerAtLine(markdown, 1)).toBe(["- [ ] one", "- [x] two", "- [x] three"].join("\n"));
  });

  it("preserves indentation and the rest of the line's text", () => {
    expect(toggleTaskMarkerAtLine("  - [ ] nested item with **bold**", 0)).toBe(
      "  - [x] nested item with **bold**"
    );
  });

  it("supports * and + bullets and ordered-list markers", () => {
    expect(toggleTaskMarkerAtLine("* [ ] a", 0)).toBe("* [x] a");
    expect(toggleTaskMarkerAtLine("+ [ ] a", 0)).toBe("+ [x] a");
    expect(toggleTaskMarkerAtLine("1. [ ] a", 0)).toBe("1. [x] a");
    expect(toggleTaskMarkerAtLine("1) [ ] a", 0)).toBe("1) [x] a");
  });

  it("leaves the document unchanged when the line isn't a task marker", () => {
    const markdown = ["- not a task", "- [ ] the only task", "- also not a task"].join("\n");
    expect(toggleTaskMarkerAtLine(markdown, 0)).toBe(markdown);
    expect(toggleTaskMarkerAtLine(markdown, 2)).toBe(markdown);
  });

  it("leaves the document unchanged for an out-of-range line index", () => {
    const markdown = "- [ ] only one";
    expect(toggleTaskMarkerAtLine(markdown, 5)).toBe(markdown);
    expect(toggleTaskMarkerAtLine(markdown, -1)).toBe(markdown);
  });

  it("leaves a document with no task markers unchanged", () => {
    const markdown = "just a plain note, no checklist here";
    expect(toggleTaskMarkerAtLine(markdown, 0)).toBe(markdown);
  });
});
