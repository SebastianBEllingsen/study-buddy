import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkCallouts, { canonicalCalloutType, parseCalloutHeader } from "./callouts";

// Rendered through react-markdown with the same plugin order NoteMarkdown
// uses, so this also covers the hName/hProperties → HTML mapping.
function render(md: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkBreaks, remarkCallouts] }, md)
  );
}

describe("parseCalloutHeader", () => {
  it("parses type, fold marker, and marker length", () => {
    expect(parseCalloutHeader("[!warning]- Careful")).toEqual({
      type: "warning",
      rawType: "warning",
      fold: "-",
      length: 12,
    });
    expect(parseCalloutHeader("[!tip]")).toMatchObject({ type: "tip", fold: null });
  });

  it("rejects a plain blockquote line", () => {
    expect(parseCalloutHeader("Just a quote")).toBeNull();
    expect(parseCalloutHeader("[link](x)")).toBeNull();
  });
});

describe("canonicalCalloutType", () => {
  it.each([
    ["summary", "abstract"],
    ["tldr", "abstract"],
    ["caution", "warning"],
    ["attention", "warning"],
    ["error", "danger"],
    ["important", "tip"],
    ["hint", "tip"],
    ["faq", "question"],
    ["done", "success"],
    ["missing", "failure"],
    ["cite", "quote"],
    ["WARNING", "warning"],
    ["made-up", "note"],
  ])("%s → %s", (raw, expected) => {
    expect(canonicalCalloutType(raw)).toBe(expected);
  });
});

describe("remarkCallouts", () => {
  it("turns a callout blockquote into a titled callout box", () => {
    const html = render("> [!abstract] Goal\n> Best-possible **sleep tracker**.\n> - BLE only");
    expect(html).toContain('<div class="callout" data-callout="abstract">');
    expect(html).toContain('<div class="callout-title" data-callout="abstract">Goal</div>');
    expect(html).toContain('<div class="callout-content">\n<p>Best-possible <strong>sleep tracker</strong>.</p>');
    expect(html).toContain("<li>BLE only</li>");
    expect(html).not.toContain("[!abstract]");
    expect(html).not.toContain("<blockquote");
  });

  it("keeps inline formatting in the title", () => {
    const html = render('> [!warning] Not the **"Sense"** version\n> Body');
    expect(html).toContain('<div class="callout-title" data-callout="warning">Not the <strong>');
  });

  it("defaults the title to the type as written, capitalized", () => {
    expect(render("> [!caution]\n> Body")).toContain(
      '<div class="callout-title" data-callout="warning">Caution</div>'
    );
  });

  it("renders a title-only callout without a content block", () => {
    const html = render('> [!tip] Recommended for "best possible"');
    expect(html).toContain("Recommended for");
    expect(html).not.toContain("callout-content");
  });

  it("makes +/- callouts foldable, open for + and collapsed for -", () => {
    const open = render("> [!faq]+ Why?\n> Because.");
    expect(open).toContain('<details class="callout" data-callout="question" open="">');
    expect(open).toContain('<summary class="callout-title" data-callout="question">Why?</summary>');
    const closed = render("> [!faq]- Why?\n> Because.");
    expect(closed).toContain('<details class="callout" data-callout="question">');
  });

  it("supports nested callouts", () => {
    const html = render("> [!note] Outer\n> > [!danger] Inner\n> > Deep");
    expect(html).toContain('data-callout="note"');
    expect(html).toContain('<div class="callout" data-callout="danger">');
    expect(html).toContain("Inner");
  });

  it("leaves an ordinary blockquote alone", () => {
    const html = render("> Just a quote\n> [!note] not a header here");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("callout");
  });
});
