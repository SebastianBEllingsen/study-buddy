import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import type { TestDb } from "./db/testHarness";

let testDb: TestDb;
vi.mock("./db", async () => {
  const { createTestDb } = await import("./db/testHarness");
  testDb = createTestDb();
  return {
    db: testDb.db,
    runTransaction: testDb.runTransaction,
    ...testDb.schema,
  };
});

const { createCourse, createFolder, getDocument } = await import("./models");
const { ingestDocumentBytes, UnsupportedDocumentTypeError } = await import("./documentIngest");

beforeEach(() => {
  const { db, schema } = testDb;
  db.delete(schema.documents).run();
  db.delete(schema.folders).run();
  db.delete(schema.courses).run();
});

// Minimal single-page PDF with real extractable text — same fixture shape
// used to smoke-test the chat attachment extraction path.
const TEST_PDF = Buffer.from(
  `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 300 144]/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 78>>
stream
BT /F1 18 Tf 10 100 Td (Hello World Test Document About Penguins) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer<</Size 6/Root 1 0 R>>
startxref
0
%%EOF`,
  "utf-8"
);

describe("ingestDocumentBytes", () => {
  it("writes a pdf to disk, creates the document row, and extracts its text", async () => {
    const course = await createCourse("Bio 101");
    const folder = await createFolder(course.id, "Week 1");

    const doc = await ingestDocumentBytes({
      courseId: course.id,
      folderId: folder.id,
      filename: "lecture.pdf",
      buffer: TEST_PDF,
    });

    const bytesOnDisk = await fs.readFile(doc.file_path);
    expect(bytesOnDisk.equals(TEST_PDF)).toBe(true);

    const fullDoc = await getDocument(doc.id);
    expect(fullDoc?.status).toBe("extracted");
    expect(fullDoc?.extracted_text).toContain("Hello World");

    await fs.rm(doc.file_path, { force: true });
  });

  it("marks an image document without attempting extraction", async () => {
    const course = await createCourse("Bio 101");
    const folder = await createFolder(course.id, "Week 1");

    const doc = await ingestDocumentBytes({
      courseId: course.id,
      folderId: folder.id,
      filename: "diagram.png",
      buffer: Buffer.from("fake png bytes"),
    });

    const fullDoc = await getDocument(doc.id);
    expect(fullDoc?.status).toBe("image");
    expect(fullDoc?.extracted_text).toBeNull();

    await fs.rm(doc.file_path, { force: true });
  });

  it("rejects an unsupported file type before writing anything to disk", async () => {
    const course = await createCourse("Bio 101");
    const folder = await createFolder(course.id, "Week 1");

    await expect(
      ingestDocumentBytes({
        courseId: course.id,
        folderId: folder.id,
        filename: "notes.txt",
        buffer: Buffer.from("hello"),
      })
    ).rejects.toThrow(UnsupportedDocumentTypeError);
  });
});
