import { describe, it, expect } from "vitest";
import { blankFrontmatter, formatPropertyValue, splitFrontmatter } from "./frontmatter";

const NOTE = `---
title: DIY Sleep Tracker
tags:
  - project/smartwatch
  - electronics
created: 2026-09-23
---

# Heading
- [ ] task`;

describe("splitFrontmatter", () => {
  it("parses a leading YAML block into properties", () => {
    const { properties, lineCount, body } = splitFrontmatter(NOTE);
    expect(properties).toEqual({
      title: "DIY Sleep Tracker",
      tags: ["project/smartwatch", "electronics"],
      // Kept as typed, not turned into a Date.
      created: "2026-09-23",
    });
    expect(lineCount).toBe(7);
    expect(body).toBe("\n# Heading\n- [ ] task");
  });

  it("returns the source untouched without frontmatter", () => {
    const md = "# Just a note\n---\nnot: frontmatter\n---";
    expect(splitFrontmatter(md)).toEqual({ properties: null, lineCount: 0, body: md });
  });

  it("returns the source untouched when the YAML is invalid", () => {
    const md = "---\ntitle: [unclosed\n---\nBody";
    expect(splitFrontmatter(md).properties).toBeNull();
    expect(splitFrontmatter(md).body).toBe(md);
  });

  it("ignores a block that isn't a mapping", () => {
    expect(splitFrontmatter("---\n- a\n- b\n---\nBody").properties).toBeNull();
  });

  it("accepts an empty block", () => {
    expect(splitFrontmatter("---\n---\nBody")).toEqual({ properties: {}, lineCount: 2, body: "Body" });
  });

  it("handles CRLF line endings", () => {
    const { properties, body } = splitFrontmatter("---\r\na: 1\r\n---\r\nBody");
    expect(properties).toEqual({ a: 1 });
    expect(body).toBe("Body");
  });

  it("handles a note that is only frontmatter", () => {
    expect(splitFrontmatter("---\na: 1\n---")).toEqual({ properties: { a: 1 }, lineCount: 3, body: "" });
  });
});

describe("blankFrontmatter", () => {
  it("keeps every body line at its original line number", () => {
    const { markdown } = blankFrontmatter(NOTE);
    const original = NOTE.split("\n");
    const blanked = markdown.split("\n");
    expect(blanked.length).toBe(original.length);
    expect(blanked.indexOf("- [ ] task")).toBe(original.indexOf("- [ ] task"));
    expect(markdown).not.toContain("title:");
  });

  it("is a no-op without frontmatter", () => {
    expect(blankFrontmatter("# Hi")).toEqual({ properties: null, markdown: "# Hi" });
  });
});

describe("formatPropertyValue", () => {
  it("formats scalars, lists, and objects", () => {
    expect(formatPropertyValue("planning")).toEqual(["planning"]);
    expect(formatPropertyValue(42)).toEqual(["42"]);
    expect(formatPropertyValue(true)).toEqual(["true"]);
    expect(formatPropertyValue(["a", "b"])).toEqual(["a", "b"]);
    expect(formatPropertyValue(null)).toEqual([]);
    expect(formatPropertyValue({ x: 1 })).toEqual(['{"x":1}']);
  });
});
