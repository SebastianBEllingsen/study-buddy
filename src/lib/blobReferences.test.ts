import { describe, it, expect, vi } from "vitest";
import type { TestDb } from "./db/testHarness";

let testDb: TestDb;
vi.mock("./db", async () => {
  const { createTestDb } = await import("./db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});

const { createCourse, createGeneratedItem, isBlobUrlReferenced } = await import("./models");

describe("isBlobUrlReferenced", () => {
  it("sees media still used by any deck, and treats LIKE wildcards literally", async () => {
    const course = await createCourse("C");
    await createGeneratedItem({
      courseId: course.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: "Deck",
      contentJson: { cards: [{ front: "Q", back: "A", media: [{ type: "image", src: "/api/blobs/anki/a_1.png" }] }] },
      sourceDocumentIds: [],
    });
    expect(await isBlobUrlReferenced("/api/blobs/anki/a_1.png")).toBe(true);
    expect(await isBlobUrlReferenced("/api/blobs/anki/other.png")).toBe(false);
    // Only "xb9.png" is stored below: an unescaped "_" in "x_9" would match it.
    await createGeneratedItem({
      courseId: course.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: "Deck 2",
      contentJson: { cards: [{ front: "Q", back: "A", media: [{ type: "image", src: "/api/blobs/anki/xb9.png" }] }] },
      sourceDocumentIds: [],
    });
    expect(await isBlobUrlReferenced("/api/blobs/anki/x_9.png")).toBe(false);
  });
});
