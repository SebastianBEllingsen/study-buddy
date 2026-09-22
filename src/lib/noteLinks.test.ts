import { describe, it, expect } from "vitest";
import {
  parseNoteLinks,
  buildNoteLinkSyntax,
  stripNoteLinkSyntax,
  buildNoteLinkHref,
  resolveNoteLinkTarget,
} from "./noteLinks";

describe("buildNoteLinkSyntax / parseNoteLinks round-trip", () => {
  it("round-trips a plain note link with no snippet/alias", () => {
    const syntax = buildNoteLinkSyntax({ type: "note", id: 12 });
    expect(syntax).toBe("[[note:12]]");
    const [match] = parseNoteLinks(`See ${syntax} for details.`);
    expect(match).toMatchObject({ type: "note", id: 12, snippet: undefined, alias: undefined });
  });

  it("round-trips a doc link with a snippet containing special characters", () => {
    const syntax = buildNoteLinkSyntax({ type: "doc", id: 7, snippet: "Amdahl's law" });
    expect(syntax).toBe("[[doc:7#Amdahl's%20law]]");
    const [match] = parseNoteLinks(syntax);
    expect(match.snippet).toBe("Amdahl's law");
  });

  it("round-trips an item link with a snippet and an alias", () => {
    const syntax = buildNoteLinkSyntax({ type: "item", id: 3, snippet: "a] b|c", alias: "My Item" });
    const [match] = parseNoteLinks(syntax);
    expect(match).toMatchObject({ type: "item", id: 3, snippet: "a] b|c", alias: "My Item" });
  });

  it("reports the correct start/end offsets within surrounding text", () => {
    const prefix = "Look here: ";
    const syntax = buildNoteLinkSyntax({ type: "note", id: 5 });
    const [match] = parseNoteLinks(prefix + syntax + " and more.");
    expect(match.start).toBe(prefix.length);
    expect(match.end).toBe(prefix.length + syntax.length);
    expect(match.raw).toBe(syntax);
  });
});

describe("parseNoteLinks", () => {
  it("finds multiple links in the same text", () => {
    const markdown = "[[note:1]] and [[doc:2]] and [[item:3]]";
    const matches = parseNoteLinks(markdown);
    expect(matches.map((m) => ({ type: m.type, id: m.id }))).toEqual([
      { type: "note", id: 1 },
      { type: "doc", id: 2 },
      { type: "item", id: 3 },
    ]);
  });

  it("returns an empty array when there are no links", () => {
    expect(parseNoteLinks("Nothing to see here.")).toEqual([]);
  });

  it("ignores an unrecognized link type", () => {
    expect(parseNoteLinks("[[bogus:1]]")).toEqual([]);
  });

  it("falls back to the raw snippet text when it isn't valid percent-encoding", () => {
    // Hand-typed/pasted text can contain this syntax with a literal "%"
    // that isn't a valid escape sequence — decodeURIComponent would throw.
    const matches = parseNoteLinks("[[note:1#100%done]]");
    expect(matches[0].snippet).toBe("100%done");
  });
});

describe("stripNoteLinkSyntax", () => {
  it("replaces a link with its alias when present", () => {
    expect(stripNoteLinkSyntax("See [[note:1|My Note]] for details.")).toBe("See My Note for details.");
  });

  it("drops a link with no alias entirely", () => {
    expect(stripNoteLinkSyntax("See [[note:1]] for details.")).toBe("See  for details.");
  });

  it("handles multiple links, mixing aliased and bare", () => {
    expect(stripNoteLinkSyntax("[[note:1|A]] and [[doc:2]]")).toBe("A and ");
  });

  it("leaves plain text with no links untouched", () => {
    expect(stripNoteLinkSyntax("Nothing to see here.")).toBe("Nothing to see here.");
  });
});

describe("resolveNoteLinkTarget / buildNoteLinkHref", () => {
  const targets = {
    notes: [{ id: 1, title: "Intro", courseId: 5, courseName: "C" }],
    documents: [{ id: 2, filename: "lec.pdf", courseId: 5, courseName: "C" }],
    items: [{ id: 3, title: "Quiz 1", courseId: 5, courseName: "C", mode: "quiz" as const }],
  };

  it("labels existing targets and flags missing ones", () => {
    expect(resolveNoteLinkTarget("note", 1, targets)).toEqual({ label: "Intro", missing: false });
    expect(resolveNoteLinkTarget("doc", 99, targets)).toEqual({ label: "Missing document", missing: true });
  });

  it("builds hrefs, carrying a snippet as a highlight", () => {
    expect(buildNoteLinkHref({ type: "note", id: 1, snippet: "a b" }, targets)).toBe("/vault/1?highlight=a%20b");
    expect(buildNoteLinkHref({ type: "doc", id: 2 }, targets)).toBe("/courses/5?document=2");
    expect(buildNoteLinkHref({ type: "doc", id: 2, snippet: "x" }, targets)).toBe("/courses/5?document=2&highlight=x");
    expect(buildNoteLinkHref({ type: "item", id: 3 }, targets)).toBe("/items/3");
    expect(buildNoteLinkHref({ type: "item", id: 4 }, targets)).toBeNull();
  });
});
