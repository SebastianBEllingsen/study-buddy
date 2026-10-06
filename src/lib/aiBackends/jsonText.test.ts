import { describe, expect, it } from "vitest";
import { parseJsonFromText, stripCodeFences } from "./jsonText";

describe("stripCodeFences", () => {
  it("unwraps a fenced block", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves JSON alone when a string value contains a code fence", () => {
    const json = '{"markdown":"```python\\nx=1\\n```"}';
    expect(JSON.parse(stripCodeFences(json))).toEqual({ markdown: "```python\nx=1\n```" });
  });
  it("unwraps a fence that follows some prose", () => {
    expect(stripCodeFences('Here you go:\n```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves plain text alone", () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("parseJsonFromText", () => {
  it("parses plain JSON", () => {
    expect(parseJsonFromText('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(parseJsonFromText('```\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
  });

  it("finds the object inside surrounding prose", () => {
    expect(parseJsonFromText('Here are the results:\n{"resources":[]}\nHope that helps!')).toEqual({ resources: [] });
  });

  it("throws when nothing parses", () => {
    expect(() => parseJsonFromText("no json here")).toThrow(SyntaxError);
    expect(() => parseJsonFromText("{ broken")).toThrow(SyntaxError);
  });
});
