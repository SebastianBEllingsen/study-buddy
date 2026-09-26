import { describe, expect, it } from "vitest";
import {
  parseChapterLevels,
  parseChapterPatch,
  parseNewChapter,
  parseNewResource,
  parseOrderedIds,
  parseResourcePatch,
  parseSyllabusSource,
} from "./requestParsing";

describe("parseSyllabusSource", () => {
  it("accepts a document id, pasted text, or nothing", () => {
    expect(parseSyllabusSource({ documentId: 4 })).toEqual({ ok: true, value: { documentId: 4 } });
    expect(parseSyllabusSource({ text: "  1. Foundations  " })).toEqual({ ok: true, value: { text: "1. Foundations" } });
    expect(parseSyllabusSource(null)).toEqual({ ok: true, value: null });
    expect(parseSyllabusSource({ text: "   " })).toEqual({ ok: true, value: null });
  });

  it("rejects malformed input", () => {
    expect(parseSyllabusSource({ documentId: "4" }).ok).toBe(false);
    expect(parseSyllabusSource("syllabus").ok).toBe(false);
    expect(parseSyllabusSource({ text: "x".repeat(100_001) }).ok).toBe(false);
  });
});

describe("parseChapterPatch", () => {
  it("keeps only the fields sent, trimmed", () => {
    expect(parseChapterPatch({ title: "  New  ", completed: true })).toEqual({
      ok: true,
      value: { title: "New", completed: true },
    });
  });

  it("drops empty subtopics and rejects malformed ones", () => {
    expect(parseChapterPatch({ subtopics: [{ text: " a ", done: true }, { text: " ", done: false }] })).toEqual({
      ok: true,
      value: { subtopics: [{ text: "a", done: true }] },
    });
    expect(parseChapterPatch({ subtopics: [{ text: "a" }] }).ok).toBe(false);
  });

  it("validates title, stage and linked documents", () => {
    expect(parseChapterPatch({ title: "" }).ok).toBe(false);
    expect(parseChapterPatch({ stage: 0 }).ok).toBe(false);
    expect(parseChapterPatch({ stage: 2.5 }).ok).toBe(false);
    expect(parseChapterPatch({ linkedDocumentIds: [1, 1, 2] })).toEqual({
      ok: true,
      value: { linked_document_ids: [1, 2] },
    });
    expect(parseChapterPatch({ linkedDocumentIds: ["1"] }).ok).toBe(false);
  });
});

describe("parseNewChapter", () => {
  it("requires a title and cleans the checklist", () => {
    expect(parseNewChapter({}).ok).toBe(false);
    expect(parseNewChapter({ title: "T", subtopics: ["a", "", 3, " b "] })).toEqual({
      ok: true,
      value: { title: "T", summary: "", subtopics: ["a", "b"] },
    });
    expect(parseNewChapter({ title: "T", stage: 3 })).toMatchObject({ ok: true, value: { stage: 3 } });
    expect(parseNewChapter({ title: "T", stage: -1 }).ok).toBe(false);
  });
});

describe("parseNewResource / parseResourcePatch", () => {
  it("requires an http(s) link and defaults the title and kind", () => {
    expect(parseNewResource({ url: "javascript:alert(1)" }).ok).toBe(false);
    expect(parseNewResource({ url: "https://example.org/lesson" })).toEqual({
      ok: true,
      value: { title: "example.org", url: "https://example.org/lesson", kind: "article", note: "" },
    });
    expect(parseNewResource({ url: "https://example.org", kind: "podcast" }).ok).toBe(false);
  });

  it("validates each patched field", () => {
    expect(parseResourcePatch({ done: true })).toEqual({ ok: true, value: { done: true } });
    expect(parseResourcePatch({ url: "ftp://x" }).ok).toBe(false);
    expect(parseResourcePatch({ kind: "video", note: " why " })).toEqual({
      ok: true,
      value: { kind: "video", note: "why" },
    });
  });
});

describe("parseOrderedIds", () => {
  it("accepts distinct integer lists only", () => {
    expect(parseOrderedIds([3, 1, 2])).toEqual([3, 1, 2]);
    expect(parseOrderedIds([1, 1])).toBeNull();
    expect(parseOrderedIds("1,2")).toBeNull();
  });
});

describe("parseChapterLevels", () => {
  it("parses a chapter-id → level map", () => {
    expect(parseChapterLevels({ "3": "known", "4": "new" })).toEqual(
      new Map([
        [3, "known"],
        [4, "new"],
      ])
    );
    expect(parseChapterLevels(undefined)).toEqual(new Map());
  });

  it("rejects unknown levels and non-numeric ids", () => {
    expect(parseChapterLevels({ "3": "expert" })).toBeNull();
    expect(parseChapterLevels({ abc: "new" })).toBeNull();
    expect(parseChapterLevels(["new"])).toBeNull();
  });
});
