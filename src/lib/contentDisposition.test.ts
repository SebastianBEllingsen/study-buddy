import { describe, expect, it } from "vitest";
import { contentDisposition } from "./contentDisposition";

describe("contentDisposition", () => {
  it("keeps a plain name as it is", () => {
    expect(contentDisposition("inline", "notes.pdf")).toBe(`inline; filename="notes.pdf"; filename*=UTF-8''notes.pdf`);
  });

  it("is always a valid header value, whatever the name holds", () => {
    for (const name of ["日本語 – notes.pdf", "Screenshot 2026 at 10.15.30\u202FAM.png", "emoji 📘.docx", 'a "quoted" name.pdf', "line\r\nbreak.pdf", "50%.pdf", ""]) {
      const value = contentDisposition("inline", name);
      expect(() => new Response("x", { headers: { "Content-Disposition": value } })).not.toThrow();
      expect(value).not.toMatch(/[\r\n]/);
    }
  });

  it("carries the real name in filename* and an ASCII stand-in in filename", () => {
    const value = contentDisposition("attachment", "Lecture 3 – Intro.pdf");
    expect(value).toContain(`filename="Lecture 3 _ Intro.pdf"`);
    expect(decodeURIComponent(value.split("filename*=UTF-8''")[1])).toBe("Lecture 3 – Intro.pdf");
  });

  it("can't be used to break out of the quoted name", () => {
    const value = contentDisposition("inline", 'x"; filename="evil.exe');
    // Its own quotes are replaced, so the quoted name stays one string.
    expect(value.split("; filename*=")[0]).toBe(`inline; filename="x_; filename=_evil.exe"`);
  });
});
