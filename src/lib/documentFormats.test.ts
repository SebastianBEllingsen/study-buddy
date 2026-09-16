import { describe, it, expect } from "vitest";
import {
  extensionOf,
  isSupportedExtension,
  isImageExtension,
  needsLibreOfficeConversion,
  SUPPORTED_EXTENSIONS,
} from "./documentFormats";

describe("extensionOf", () => {
  it("extracts a lowercase extension", () => {
    expect(extensionOf("lecture.pdf")).toBe("pdf");
  });

  it("lowercases an uppercase extension", () => {
    expect(extensionOf("LECTURE.PDF")).toBe("pdf");
  });

  it("uses the last dot for a filename with multiple dots", () => {
    expect(extensionOf("my.notes.v2.docx")).toBe("docx");
  });

  it("returns an empty string for a filename with no extension", () => {
    expect(extensionOf("README")).toBe("");
  });

  it("treats a dotfile's whole name after the leading dot as its extension", () => {
    // lastIndexOf(".") finds the leading dot itself for a name like this —
    // not a case this app's upload flow actually exercises, but worth
    // pinning down since it's a real edge case in the implementation.
    expect(extensionOf(".gitignore")).toBe("gitignore");
  });

  it("handles a path-traversal-shaped filename without throwing", () => {
    expect(extensionOf("../../etc/passwd.pdf")).toBe("pdf");
  });
});

describe("isSupportedExtension", () => {
  it("accepts every declared supported extension", () => {
    for (const ext of SUPPORTED_EXTENSIONS) {
      expect(isSupportedExtension(ext)).toBe(true);
    }
  });

  it("rejects an unsupported extension", () => {
    expect(isSupportedExtension("exe")).toBe(false);
    expect(isSupportedExtension("")).toBe(false);
    expect(isSupportedExtension("PDF")).toBe(false); // case-sensitive: callers lowercase via extensionOf first
  });
});

describe("isImageExtension", () => {
  it("accepts image extensions", () => {
    expect(isImageExtension("png")).toBe(true);
    expect(isImageExtension("jpg")).toBe(true);
    expect(isImageExtension("webp")).toBe(true);
  });

  it("rejects non-image supported extensions", () => {
    expect(isImageExtension("pdf")).toBe(false);
    expect(isImageExtension("docx")).toBe(false);
  });
});

describe("needsLibreOfficeConversion", () => {
  it("is true only for odt and pptx", () => {
    expect(needsLibreOfficeConversion("odt")).toBe(true);
    expect(needsLibreOfficeConversion("pptx")).toBe(true);
  });

  it("is false for formats with their own viewer/extraction path", () => {
    expect(needsLibreOfficeConversion("pdf")).toBe(false);
    expect(needsLibreOfficeConversion("docx")).toBe(false);
    expect(needsLibreOfficeConversion("png")).toBe(false);
  });
});
