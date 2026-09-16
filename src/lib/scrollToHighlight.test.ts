// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scrollToHighlight } from "./scrollToHighlight";

function makeContainer(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView at all (a well-known gap) —
  // stubbed so the real DOM mutation logic (TreeWalker/Range/mark
  // insertion) can run without throwing on that one unrelated call.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("scrollToHighlight", () => {
  it("returns false for a needle shorter than 3 characters (too easy to false-match)", () => {
    const el = makeContainer("<p>Hi there</p>");
    expect(scrollToHighlight(el, "hi")).toBe(false);
  });

  it("returns false when the text isn't found", () => {
    const el = makeContainer("<p>Some paragraph text</p>");
    expect(scrollToHighlight(el, "not present")).toBe(false);
  });

  it("finds and wraps a match, case-insensitively, in a <mark>", () => {
    const el = makeContainer("<p>The Quick Brown Fox</p>");
    const found = scrollToHighlight(el, "quick brown");
    expect(found).toBe(true);
    const mark = el.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe("Quick Brown");
  });

  it("preserves the surrounding text exactly, only wrapping the match", () => {
    const el = makeContainer("<p>before MATCHME after</p>");
    scrollToHighlight(el, "matchme");
    expect(el.textContent).toBe("before MATCHME after");
  });

  it("finds text inside nested markup, not just top-level text", () => {
    const el = makeContainer("<div><span>nested</span> important text here</div>");
    expect(scrollToHighlight(el, "important text")).toBe(true);
  });

  it("scrolls the match into view", () => {
    const el = makeContainer("<p>find this phrase</p>");
    scrollToHighlight(el, "this phrase");
    const mark = el.querySelector("mark")!;
    expect(mark.scrollIntoView).toHaveBeenCalled();
  });

  it("only highlights the first match when the text appears more than once", () => {
    const el = makeContainer("<p>repeat repeat repeat</p>");
    scrollToHighlight(el, "repeat");
    expect(el.querySelectorAll("mark")).toHaveLength(1);
  });
});
