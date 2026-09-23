import { describe, expect, it } from "vitest";
import { noteImageMoveChanges, type TextChange } from "./noteImageMove";

function apply(doc: string, changes: TextChange[] | null): string {
  if (!changes) return doc;
  // Original-document coordinates: apply back to front so earlier offsets stay valid.
  return [...changes]
    .sort((a, b) => b.from - a.from || b.to - a.to)
    .reduce((text, c) => text.slice(0, c.from) + c.insert + text.slice(c.to), doc);
}

const img = (id: number) => `![](studybuddy-image:${id})`;

function move(doc: string, id: number, toLine: number): string {
  const lines = doc.split("\n");
  const insertAt = lines.slice(0, toLine).reduce((n, l) => n + l.length + 1, 0);
  return apply(doc, noteImageMoveChanges(doc, id, insertAt));
}

describe("noteImageMoveChanges", () => {
  it("moves only the picture out of the end of a sentence", () => {
    const doc = `intro\nthe sum ${img(1)}\noutro`;
    expect(move(doc, 1, 0)).toBe(`${img(1)}\nintro\nthe sum\noutro`);
    expect(move(doc, 1, 2)).toBe(`intro\nthe sum\n${img(1)}\noutro`);
  });

  it("handles a picture glued to text with no space", () => {
    expect(move(`a\nsum${img(1)}\nb`, 1, 0)).toBe(`${img(1)}\na\nsum\nb`);
  });

  it("keeps the other picture when two share a line", () => {
    expect(move(`a\nx ${img(1)} ${img(2)}`, 2, 0)).toBe(`${img(2)}\na\nx ${img(1)}`);
  });

  it("moves a picture that is alone on its line with the whole line", () => {
    expect(move(`a\n${img(1)}\nb\nc`, 1, 3)).toBe(`a\nb\n${img(1)}\nc`);
    expect(move(`a\nb\n${img(1)}`, 1, 0)).toBe(`${img(1)}\na\nb`);
  });

  it("does nothing when dropped on its own line or when the picture is gone", () => {
    expect(noteImageMoveChanges(`a\n${img(1)}`, 1, 2)).toBeNull();
    expect(noteImageMoveChanges(`a\nb`, 1, 0)).toBeNull();
  });

  it("doesn't confuse image 1 with image 12", () => {
    expect(move(`${img(12)}\n${img(1)}`, 1, 0)).toBe(`${img(1)}\n${img(12)}`);
  });
});
