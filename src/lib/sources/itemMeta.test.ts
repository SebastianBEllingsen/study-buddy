import { describe, expect, it } from "vitest";
import { attachSources, cleanItemFlag, cleanSourceRef, withCheckedMeta } from "./itemMeta";
import { resolveSourceName } from "./names";
import { parseFlagRequest, parseGenerationSource, parseTrust } from "./requests";

const sources = [
  { kind: "document" as const, id: 1, title: "Lecture 1.pdf" },
  { kind: "note" as const, id: 7, title: "Summary" },
];

describe("resolveSourceName", () => {
  it("matches exactly, then ignoring case", () => {
    expect(resolveSourceName("Lecture 1.pdf", sources)).toEqual(sources[0]);
    expect(resolveSourceName("summary", sources)).toEqual(sources[1]);
  });

  it("tolerates the model echoing the section header", () => {
    expect(resolveSourceName("--- Note: Summary [personal notes] ---", sources)).toEqual(sources[1]);
    expect(resolveSourceName("Document: Lecture 1.pdf", sources)).toEqual(sources[0]);
  });

  it("doesn't guess", () => {
    expect(resolveSourceName("Lecture 2.pdf", sources)).toBeUndefined();
    expect(resolveSourceName(undefined, sources)).toBeUndefined();
  });
});

describe("attachSources", () => {
  it("swaps names for references and drops unknown ones", () => {
    const items = attachSources([{ front: "a", source: "Summary" }, { front: "b", source: "nope" }, { front: "c" }], sources);
    expect(items).toEqual([{ front: "a", source: sources[1] }, { front: "b" }, { front: "c" }]);
  });
});

describe("cleaning source and flag", () => {
  it("keeps only well-formed values", () => {
    expect(cleanSourceRef({ kind: "note", id: 7, title: " Summary " })).toEqual(sources[1]);
    expect(cleanSourceRef({ kind: "web", id: 7, title: "x" })).toBeUndefined();
    expect(cleanSourceRef("Summary")).toBeUndefined();
    expect(cleanItemFlag({ by: "check", issue: "Wrong", at: "t" })).toEqual({ by: "check", issue: "Wrong", at: "t" });
    expect(cleanItemFlag({ by: "someone", issue: "x", at: "t" })).toBeUndefined();
    expect(withCheckedMeta({ front: "a", source: "junk", flag: 3 } as never)).toEqual({ front: "a" });
  });
});

describe("request parsing", () => {
  it("parses flag actions", () => {
    expect(parseFlagRequest({ index: 2, action: "report", issue: "Off by one" })).toEqual({ index: 2, action: "report", issue: "Off by one" });
    expect(parseFlagRequest({ index: 0, action: "report" })).toEqual({ index: 0, action: "report", issue: "" });
    expect(parseFlagRequest({ index: 0, action: "save", entry: { front: "a", back: "b" } })).toMatchObject({ action: "save" });
    expect(parseFlagRequest({ index: 0, action: "save" })).toBeNull();
    expect(parseFlagRequest({ index: -1, action: "keep" })).toBeNull();
    expect(parseFlagRequest({ index: 0, action: "explode" })).toBeNull();
  });

  it("parses trust and note generation settings", () => {
    expect(parseTrust("personal")).toBe("personal");
    expect(parseTrust("maybe")).toBeNull();
    expect(parseGenerationSource(null)).toBeNull();
    expect(parseGenerationSource("official")).toBe("official");
    expect(parseGenerationSource("yes")).toBeUndefined();
  });
});
