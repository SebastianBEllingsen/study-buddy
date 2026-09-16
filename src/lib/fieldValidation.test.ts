import { describe, it, expect } from "vitest";
import { isValidIcon, isValidColor } from "./fieldValidation";

describe("isValidIcon", () => {
  it("accepts a short string", () => {
    expect(isValidIcon("📚")).toBe(true);
    expect(isValidIcon("A")).toBe(true);
    expect(isValidIcon("")).toBe(true);
  });

  it("accepts a string up to 16 characters", () => {
    expect(isValidIcon("a".repeat(16))).toBe(true);
  });

  it("rejects a string over 16 characters", () => {
    expect(isValidIcon("a".repeat(17))).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidIcon(null)).toBe(false);
    expect(isValidIcon(undefined)).toBe(false);
    expect(isValidIcon(42)).toBe(false);
    expect(isValidIcon({})).toBe(false);
  });
});

describe("isValidColor", () => {
  it("accepts a well-formed 6-digit hex color", () => {
    expect(isValidColor("#ffffff")).toBe(true);
    expect(isValidColor("#000000")).toBe(true);
    expect(isValidColor("#A1b2C3")).toBe(true);
  });

  it("rejects malformed hex colors", () => {
    expect(isValidColor("#fff")).toBe(false); // 3-digit shorthand not supported
    expect(isValidColor("ffffff")).toBe(false); // missing '#'
    expect(isValidColor("#gggggg")).toBe(false); // non-hex digits
    expect(isValidColor("#ffffffff")).toBe(false); // too long
    expect(isValidColor("#12345")).toBe(false); // too short
  });

  it("rejects non-strings", () => {
    expect(isValidColor(null)).toBe(false);
    expect(isValidColor(undefined)).toBe(false);
    expect(isValidColor(123456)).toBe(false);
  });
});
