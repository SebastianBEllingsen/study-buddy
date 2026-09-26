import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, LANGUAGES, isSupportedLanguage, languageName, normalizeLanguage } from "./languages";

describe("languages", () => {
  it("defaults to English", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(normalizeLanguage(null)).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
    expect(normalizeLanguage("xx")).toBe("en");
    expect(normalizeLanguage(42)).toBe("en");
  });

  it("normalizes case and whitespace of a known code", () => {
    expect(normalizeLanguage(" DE ")).toBe("de");
  });

  it("only accepts listed codes as supported, exactly as stored", () => {
    expect(isSupportedLanguage("fr")).toBe(true);
    expect(isSupportedLanguage("FR")).toBe(false);
    expect(isSupportedLanguage("klingon")).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
  });

  it("names a language in English for prompts, falling back to English", () => {
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("zz")).toBe("English");
  });

  it("has unique codes", () => {
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });
});
