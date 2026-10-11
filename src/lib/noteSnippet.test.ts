import { describe, it, expect } from "vitest";
import { noteSnippet } from "./noteSnippet";

describe("noteSnippet", () => {
  it("strips headings, list markers and emphasis", () => {
    expect(noteSnippet("# Title\n\n- **bold** item\n- `code` item")).toBe("Title bold item code item");
  });

  it("keeps the visible text of links and note links", () => {
    expect(noteSnippet("See [the docs](https://example.com) and [[Other note]] or [[note:3|label]].")).toBe(
      "See the docs and Other note or label."
    );
  });

  it("drops fenced code blocks", () => {
    expect(noteSnippet("before\n```js\nconst x = 1;\n```\nafter")).toBe("before after");
  });

  it("truncates long text with an ellipsis", () => {
    const out = noteSnippet("word ".repeat(100), 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
  });

  it("returns an empty string for an empty note", () => {
    expect(noteSnippet("  \n ")).toBe("");
  });
});
