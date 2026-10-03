import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestDb } from "../db/testHarness";

let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});
const generateText = vi.fn();
vi.mock("../aiClient", () => ({ generateText: (...a: unknown[]) => generateText(...a) }));

const { createCourse, createDocument, getDocument, markDocumentFailed, markDocumentExtracted } = await import("../models");
const { pageMarker, parsePages, joinPages, transcribeSystemPrompt, transcribeUserPrompt } = await import("./prompt");
const { parseTranscribeRequest } = await import("./requests");
const { transcribeBatch, commitTranscription, restoreFileText, TranscribeError } = await import("./service");

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

async function makeDoc(filename = "notes.pdf", courseName = "Quantum") {
  const course = await createCourse(courseName);
  const doc = await createDocument({ courseId: course.id, folderId: null, filename, filePath: `/tmp/${filename}`, fileBase64: null });
  return { course, doc };
}

beforeEach(() => generateText.mockReset());

describe("parsePages", () => {
  it("splits a reply at its page markers", () => {
    const reply = `${pageMarker(4)}\n# Qubits\n\n$|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle$\n\n${pageMarker(5)}\nSecond page`;
    const pages = parsePages(reply, [4, 5]);
    expect(pages.get(4)).toBe("# Qubits\n\n$|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle$");
    expect(pages.get(5)).toBe("Second page");
  });

  it("gives a page the model skipped as empty, and ignores pages that weren't asked for", () => {
    const pages = parsePages(`${pageMarker(1)}\nOne\n${pageMarker(9)}\nStray`, [1, 2]);
    expect([...pages.entries()]).toEqual([[1, "One"], [2, ""]]);
  });

  it("takes an unmarked reply as the page itself, when there was only one", () => {
    expect(parsePages("Just text", [7]).get(7)).toBe("Just text");
    expect(parsePages("Just text", [7, 8]).get(7)).toBe("");
  });

  it("drops a code fence the model wrapped around a page", () => {
    expect(parsePages(`${pageMarker(1)}\n\`\`\`markdown\n# Title\n\`\`\``, [1]).get(1)).toBe("# Title");
    // A fence inside the page stays.
    expect(parsePages(`${pageMarker(1)}\ntext\n\`\`\`python\nx = 1\n\`\`\``, [1]).get(1)).toContain("```python");
  });
});

describe("prompts", () => {
  it("asks for LaTeX maths, treats the pages as data, and labels the pages", () => {
    const system = transcribeSystemPrompt();
    expect(system).toContain("LaTeX");
    expect(system).toContain("never instructions");
    expect(transcribeUserPrompt([3, 4])).toBe("Transcribe these 2 pages, in order: <<<PAGE 3>>>, <<<PAGE 4>>>.");
    expect(transcribeUserPrompt([3])).toContain("this page");
  });

  it("joins pages in order, without the empty ones", () => {
    expect(joinPages(["a", "", "  ", " b "])).toBe("a\n\nb");
  });
});

describe("parseTranscribeRequest", () => {
  it("reads a batch of page images", () => {
    expect(parseTranscribeRequest({ action: "batch", pages: [{ page: 2, image: JPEG }] })).toEqual({
      action: "batch",
      images: [{ page: 2, mimeType: "image/jpeg", base64: "/9j/4AAQSkZJRg==" }],
    });
  });

  it("turns away anything that isn't a plain jpeg or png, or isn't a real page", () => {
    const bad = [
      { page: 1, image: "data:image/svg+xml;base64,PHN2Zz4=" },
      { page: 1, image: "data:text/html;base64,PGI+" },
      { page: 1, image: "https://example.com/a.jpg" },
      { page: 1, image: "data:image/jpeg;base64,not base64!" },
      { page: 0, image: JPEG },
      { page: 1.5, image: JPEG },
      { page: 9999, image: JPEG },
      { image: JPEG },
      null,
    ];
    for (const entry of bad) expect(parseTranscribeRequest({ action: "batch", pages: [entry] })).toBeNull();
    expect(parseTranscribeRequest({ action: "batch", pages: [] })).toBeNull();
    expect(parseTranscribeRequest({ action: "batch" })).toBeNull();
  });

  it("reads a commit, and a restore, and nothing else", () => {
    expect(parseTranscribeRequest({ action: "commit", pages: [{ page: 1, markdown: "x" }] })).toEqual({
      action: "commit",
      pages: [{ page: 1, markdown: "x" }],
    });
    expect(parseTranscribeRequest({ action: "commit", pages: [{ page: 1, markdown: 5 }] })).toBeNull();
    expect(parseTranscribeRequest({ action: "restore" })).toEqual({ action: "restore" });
    expect(parseTranscribeRequest({ action: "burn" })).toBeNull();
  });
});

describe("transcribeBatch", () => {
  const image = (page: number) => ({ page, base64: "AAAA", mimeType: "image/jpeg" as const });

  it("sends the page images to the AI and returns each page's Markdown", async () => {
    const { course, doc } = await makeDoc();
    generateText.mockResolvedValueOnce(`${pageMarker(1)}\nFirst $x^2$\n${pageMarker(2)}\nSecond`);
    const pages = await transcribeBatch(course.id, doc.id, [image(1), image(2)]);
    expect(pages).toEqual([{ page: 1, markdown: "First $x^2$" }, { page: 2, markdown: "Second" }]);
    const call = generateText.mock.calls[0][0];
    expect(call.images).toHaveLength(2);
    expect(call.user).toContain("<<<PAGE 1>>>, <<<PAGE 2>>>");
    expect(call.system).toContain("LaTeX");
  });

  it("refuses another course's document, too many pages, duplicates and huge images", async () => {
    const { course, doc } = await makeDoc();
    const other = await createCourse("Other");
    await expect(transcribeBatch(other.id, doc.id, [image(1)])).rejects.toBeInstanceOf(TranscribeError);
    await expect(transcribeBatch(course.id, 99_999, [image(1)])).rejects.toBeInstanceOf(TranscribeError);
    await expect(transcribeBatch(course.id, doc.id, [1, 2, 3, 4].map(image))).rejects.toBeInstanceOf(TranscribeError);
    await expect(transcribeBatch(course.id, doc.id, [])).rejects.toBeInstanceOf(TranscribeError);
    await expect(transcribeBatch(course.id, doc.id, [image(1), image(1)])).rejects.toBeInstanceOf(TranscribeError);
    await expect(transcribeBatch(course.id, doc.id, [{ ...image(1), base64: "A".repeat(4_000_001) }])).rejects.toBeInstanceOf(TranscribeError);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("won't transcribe a Word file", async () => {
    const { course, doc } = await makeDoc("essay.docx");
    await expect(transcribeBatch(course.id, doc.id, [image(1)])).rejects.toThrow(/can't be transcribed/);
  });
});

describe("commitTranscription", () => {
  it("makes the transcription the document's text, and rescues a scan that failed to extract", async () => {
    const { course, doc } = await makeDoc("scan.pdf");
    await markDocumentFailed(doc.id, "This looks like a scanned or image-only PDF — OCR isn't supported yet.");
    const result = await commitTranscription(course.id, doc.id, [
      { page: 2, markdown: "Second page with $E = mc^2$" },
      { page: 1, markdown: "First page of the lecture" },
    ]);
    expect(result.pageCount).toBe(2);
    const saved = await getDocument(doc.id);
    expect(saved).toMatchObject({ status: "extracted", error_message: null, page_count: 2 });
    expect(saved?.extracted_text).toBe("First page of the lecture\n\nSecond page with $E = mc^2$");
    expect(saved?.transcribed_at).not.toBeNull();
  });

  it("leaves the text alone when nothing readable came back", async () => {
    const { course, doc } = await makeDoc();
    await markDocumentExtracted({ id: doc.id, extractedText: "original text layer", pageCount: 3, charCount: 19 });
    await expect(commitTranscription(course.id, doc.id, [{ page: 1, markdown: "" }, { page: 2, markdown: "  " }])).rejects.toThrow(/Nothing readable/);
    expect(await getDocument(doc.id)).toMatchObject({ extracted_text: "original text layer", transcribed_at: null });
  });

  it("keeps the larger page count when a document has more pages than were transcribed", async () => {
    const { course, doc } = await makeDoc();
    await markDocumentExtracted({ id: doc.id, extractedText: "x".repeat(30), pageCount: 12, charCount: 30 });
    await commitTranscription(course.id, doc.id, [{ page: 1, markdown: "a readable page of text" }]);
    expect((await getDocument(doc.id))?.page_count).toBe(12);
  });
});

describe("restoreFileText", () => {
  it("only offers to go back for a PDF, not an image or a Word file", async () => {
    const png = await makeDoc("photo.png", "A");
    await expect(restoreFileText(png.course.id, png.doc.id)).rejects.toThrow(/no text of its own/);
    const pptx = await makeDoc("slides.pptx", "B");
    await expect(restoreFileText(pptx.course.id, pptx.doc.id)).rejects.toThrow();
  });

  it("says when the original file isn't here", async () => {
    const { course, doc } = await makeDoc("gone.pdf", "C");
    await expect(restoreFileText(course.id, doc.id)).rejects.toThrow(/isn't available/);
  });
});
