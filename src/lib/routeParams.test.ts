import { describe, it, expect } from "vitest";
import { parseId } from "./routeParams";

describe("parseId", () => {
  it("parses a positive integer string", () => {
    expect(parseId("42")).toBe(42);
  });

  it("parses zero", () => {
    expect(parseId("0")).toBe(0);
  });

  it("parses a negative integer string", () => {
    expect(parseId("-1")).toBe(-1);
  });

  it("returns null for a non-numeric segment (never NaN)", () => {
    // Passing NaN straight into a Drizzle eq() throws on Postgres but
    // silently matches nothing on SQLite — this must resolve to null
    // (a 404) on both backends, not NaN.
    expect(parseId("abc")).toBeNull();
    expect(Number.isNaN(parseId("abc"))).toBe(false);
  });

  it("returns null for a non-integer number string", () => {
    expect(parseId("1.5")).toBeNull();
  });

  it("treats an empty string as 0 (Number('') coerces to 0, not NaN)", () => {
    // Worth pinning down explicitly since it's a non-obvious quirk of
    // Number() coercion, not an intentional "empty means zero" design.
    expect(parseId("")).toBe(0);
  });

  it("returns null for a path-traversal-shaped segment", () => {
    expect(parseId("..")).toBeNull();
  });

  it("returns null for a numeric string with trailing garbage", () => {
    expect(parseId("42abc")).toBeNull();
  });
});
