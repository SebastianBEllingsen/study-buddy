import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { TestDb } from "./db/testHarness";

// models.ts imports db/courses/folders/.../runTransaction from "./db" —
// mocked here to point at a throwaway in-memory SQLite database (see
// db/testHarness.ts) instead of whatever data/study_buddy.db or
// data/storage-config.json currently resolve to. One database is created
// for the whole file (not per test) and its tables are cleared in
// beforeEach — see the cleanup call below for why.
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

const {
  createCourse,
  deleteCourse,
  createFolder,
  getFolder,
  deleteFolder,
  nestFolder,
  getOrCreateDefaultFolder,
  createDocument,
  getDocument,
  moveDocument,
  createNote,
  getNote,
  moveNote,
  updateNoteMarkdown,
  createGeneratedItem,
  getGeneratedItem,
  moveGeneratedItem,
  recordUploadedImage,
  isUploadedImageReferencedInNotes,
  upsertFlashcardSchedule,
  logFlashcardReview,
  getFlashcardScheduleForItem,
  listFlashcardReviewsForItem,
  reconcileFlashcardScheduleAfterRemoval,
  reconcileFlashcardReviewsAfterRemoval,
  InvalidDestinationFolderError,
  CannotNestSubfolderError,
  listDueFlashcardItems,
  searchAll,
} = await import("./models");

beforeEach(() => {
  // Deleted in FK-safe (children-first) order rather than recreating the
  // whole connection — cheap, and avoids re-running schema.sql/migrate()
  // (and re-establishing the vi.mock live binding) on every single test.
  const { db, schema } = testDb;
  db.delete(schema.flashcard_reviews).run();
  db.delete(schema.flashcard_schedule).run();
  db.delete(schema.quiz_attempts).run();
  db.delete(schema.generation_notifications).run();
  db.delete(schema.generated_items).run();
  db.delete(schema.documents).run();
  db.delete(schema.notes).run();
  db.delete(schema.folders).run();
  db.delete(schema.courses).run();
  db.delete(schema.uploaded_images).run();
});

async function makeCourseWithFolder(name = "Course") {
  const course = await createCourse(name);
  const folder = await createFolder(course.id, "Folder");
  return { course, folder };
}

describe("position assignment", () => {
  it("createFolder appends new folders at increasing positions", async () => {
    const course = await createCourse("C");
    const a = await createFolder(course.id, "A");
    const b = await createFolder(course.id, "B");
    const c = await createFolder(course.id, "C");
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
  });

  it("createDocument appends new documents within a folder at increasing positions", async () => {
    const { folder } = await makeCourseWithFolder();
    const docs = [];
    for (let i = 0; i < 3; i++) {
      docs.push(
        await createDocument({
          courseId: folder.course_id,
          folderId: folder.id,
          filename: `doc${i}.pdf`,
          filePath: `/tmp/doc${i}.pdf`,
          fileBase64: null,
        })
      );
    }
    expect(docs.map((d) => d.position)).toEqual([0, 1, 2]);
  });

  it("never assigns two concurrently-created documents the same position — the race fixed this session", async () => {
    const { folder } = await makeCourseWithFolder();
    // Fired concurrently (not awaited one at a time) — this is exactly the
    // "multi-file drag-and-drop" scenario the runTransaction wrapping on
    // createDocument/nextDocumentPosition was added to fix.
    const docs = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createDocument({
          courseId: folder.course_id,
          folderId: folder.id,
          filename: `doc${i}.pdf`,
          filePath: `/tmp/doc${i}.pdf`,
          fileBase64: null,
        })
      )
    );
    const positions = docs.map((d) => d.position).sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("cross-course move validation (InvalidDestinationFolderError)", () => {
  it("moveDocument throws when the destination folder belongs to a different course", async () => {
    const { folder: folderA } = await makeCourseWithFolder("A");
    const { folder: folderB } = await makeCourseWithFolder("B");
    const doc = await createDocument({
      courseId: folderA.course_id,
      folderId: folderA.id,
      filename: "doc.pdf",
      filePath: "/tmp/doc.pdf",
      fileBase64: null,
    });

    await expect(moveDocument(doc.id, folderB.id)).rejects.toThrow(InvalidDestinationFolderError);
    // The document must not have moved.
    const unchanged = await getDocument(doc.id);
    expect(unchanged?.folder_id).toBe(folderA.id);
  });

  it("moveDocument succeeds when the destination folder belongs to the same course", async () => {
    const { course, folder: folderA } = await makeCourseWithFolder("A");
    const folderB = await createFolder(course.id, "B");
    const doc = await createDocument({
      courseId: folderA.course_id,
      folderId: folderA.id,
      filename: "doc.pdf",
      filePath: "/tmp/doc.pdf",
      fileBase64: null,
    });

    await moveDocument(doc.id, folderB.id);
    const moved = await getDocument(doc.id);
    expect(moved?.folder_id).toBe(folderB.id);
  });

  it("moveDocument throws for a folder id that doesn't exist at all", async () => {
    const { folder } = await makeCourseWithFolder();
    const doc = await createDocument({
      courseId: folder.course_id,
      folderId: folder.id,
      filename: "doc.pdf",
      filePath: "/tmp/doc.pdf",
      fileBase64: null,
    });
    await expect(moveDocument(doc.id, 999999)).rejects.toThrow(InvalidDestinationFolderError);
  });

  it("moveNote throws when the destination folder belongs to a different course", async () => {
    const { course: courseA, folder: folderA } = await makeCourseWithFolder("A");
    const { folder: folderB } = await makeCourseWithFolder("B");
    const note = await createNote("My note", courseA.id, folderA.id);

    await expect(moveNote(note.id, folderB.id)).rejects.toThrow(InvalidDestinationFolderError);
  });

  it("moveGeneratedItem throws when the destination folder belongs to a different course", async () => {
    const { folder: folderA } = await makeCourseWithFolder("A");
    const { folder: folderB } = await makeCourseWithFolder("B");
    const item = await createGeneratedItem({
      courseId: folderA.course_id,
      folderId: folderA.id,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "notes",
      title: "Item",
      contentJson: { markdown: "x" },
      sourceDocumentIds: [],
    });

    await expect(moveGeneratedItem(item.id, folderB.id)).rejects.toThrow(InvalidDestinationFolderError);
    const unchanged = await getGeneratedItem(item.id);
    expect(unchanged?.folder_id).toBe(folderA.id);
  });

  it("moveDocument is a silent no-op for a document id that doesn't exist", async () => {
    const { folder } = await makeCourseWithFolder();
    await expect(moveDocument(999999, folder.id)).resolves.toBeUndefined();
  });
});

// The move-path checks above were already covered; these are the matching
// create-path checks added alongside them — createFolder/nestFolder/
// createNote/createDocument previously let a cross-course folder reference
// through unchecked, which could produce a row whose course_id disagrees
// with its own folder's course_id (an invisible orphan — the course page
// only groups folders/content by parent within that same course).
describe("cross-course create-path validation", () => {
  it("createNote throws when an explicit folderId belongs to a different course", async () => {
    const { course: courseA } = await makeCourseWithFolder("A");
    const { folder: folderB } = await makeCourseWithFolder("B");
    await expect(createNote("My note", courseA.id, folderB.id)).rejects.toThrow(InvalidDestinationFolderError);
  });

  it("createNote succeeds when the folderId belongs to the same course", async () => {
    const { course, folder } = await makeCourseWithFolder();
    const note = await createNote("My note", course.id, folder.id);
    expect(note.folder_id).toBe(folder.id);
  });

  it("createDocument throws when folderId belongs to a different course", async () => {
    const { course: courseA } = await makeCourseWithFolder("A");
    const { folder: folderB } = await makeCourseWithFolder("B");
    await expect(
      createDocument({
        courseId: courseA.id,
        folderId: folderB.id,
        filename: "doc.pdf",
        filePath: "/tmp/doc.pdf",
        fileBase64: null,
      })
    ).rejects.toThrow(InvalidDestinationFolderError);
  });

  it("createFolder throws when parentFolderId belongs to a different course", async () => {
    const { course: courseA } = await makeCourseWithFolder("A");
    const { folder: folderB } = await makeCourseWithFolder("B");
    await expect(createFolder(courseA.id, "Sub", folderB.id)).rejects.toThrow(InvalidDestinationFolderError);
  });

  it("createFolder still enforces the one-level nesting rule for a same-course parent", async () => {
    const { course, folder: top } = await makeCourseWithFolder();
    const sub = await createFolder(course.id, "Sub", top.id);
    await expect(createFolder(course.id, "SubSub", sub.id)).rejects.toThrow(CannotNestSubfolderError);
  });

  it("nestFolder silently no-ops when the parent belongs to a different course, rather than cross-linking them", async () => {
    const { course: courseA } = await makeCourseWithFolder("A");
    const { folder: folderB } = await makeCourseWithFolder("B");
    const child = await createFolder(courseA.id, "Child");

    await nestFolder(child.id, folderB.id);

    const unchanged = await getFolder(child.id);
    expect(unchanged?.parent_folder_id).toBeNull();
  });

  it("nestFolder still nests correctly for a same-course parent", async () => {
    const { course, folder: top } = await makeCourseWithFolder();
    const child = await createFolder(course.id, "Child");

    await nestFolder(child.id, top.id);

    const nested = await getFolder(child.id);
    expect(nested?.parent_folder_id).toBe(top.id);
  });
});

describe("deleteFolder reassignment", () => {
  it("reassigns documents/items/notes to the course's default folder rather than orphaning them", async () => {
    const course = await createCourse("C");
    const folder = await createFolder(course.id, "Doomed");
    const doc = await createDocument({
      courseId: course.id,
      folderId: folder.id,
      filename: "doc.pdf",
      filePath: "/tmp/doc.pdf",
      fileBase64: null,
    });
    const note = await createNote("N", course.id, folder.id);

    await deleteFolder(folder.id);

    const defaultFolder = await getOrCreateDefaultFolder(course.id);
    expect(defaultFolder.id).not.toBe(folder.id);
    const movedDoc = await getDocument(doc.id);
    const movedNote = await getNote(note.id);
    expect(movedDoc?.folder_id).toBe(defaultFolder.id);
    expect(movedNote?.folder_id).toBe(defaultFolder.id);
    // The deleted folder itself is really gone.
    expect(await getFolder(folder.id)).toBeUndefined();
  });

  it("just deletes an empty folder with nothing to reassign, no default folder conjured up", async () => {
    const course = await createCourse("C");
    const folder = await createFolder(course.id, "Empty");
    await deleteFolder(folder.id);
    expect(await getFolder(folder.id)).toBeUndefined();
    // No content existed, so no "Unsorted" folder should have been created.
    const { db, schema } = testDb;
    const remaining = db.select().from(schema.folders).all();
    expect(remaining).toHaveLength(0);
  });
});

describe("deleteCourse cascade", () => {
  it("removes the course's folders/documents via ON DELETE CASCADE", async () => {
    const { course, folder } = await makeCourseWithFolder();
    const doc = await createDocument({
      courseId: course.id,
      folderId: folder.id,
      filename: "doc.pdf",
      filePath: "/tmp/doc.pdf",
      fileBase64: null,
    });

    await deleteCourse(course.id);

    expect(await getFolder(folder.id)).toBeUndefined();
    expect(await getDocument(doc.id)).toBeUndefined();
  });
});

describe("isUploadedImageReferencedInNotes", () => {
  it("returns true when a note embeds the image by id", async () => {
    const { course, folder } = await makeCourseWithFolder();
    const image = await recordUploadedImage("icon", "data:image/png;base64,AAAA");
    const note = await createNote("N", course.id, folder.id);
    await updateNoteMarkdown(note.id, `Look: ![x](studybuddy-image:${image.id})`);

    expect(await isUploadedImageReferencedInNotes(image.id)).toBe(true);
  });

  it("returns false when no note references the image", async () => {
    const image = await recordUploadedImage("icon", "data:image/png;base64,AAAA");
    expect(await isUploadedImageReferencedInNotes(image.id)).toBe(false);
  });

  it("does not false-positive on a numeric prefix match (id 1 referenced by id 10's text)", async () => {
    // Regression coverage: an earlier version of this test wrote a note
    // referencing a *different* image's id (with a trailing digit) and
    // asserted the first image wasn't referenced — which passed whether or
    // not the implementation's negative-lookahead prefix guard
    // (`(?!\d)` in models.ts's isUploadedImageReferencedInNotes) was there
    // at all, since two distinct ids never share a "studybuddy-image:N"
    // substring to begin with. The actual prefix-collision case is the
    // *same* id with an extra trailing digit appended — "studybuddy-image:1"
    // is a plain text prefix of "studybuddy-image:10", and only the
    // lookahead stops that from matching.
    const { course, folder } = await makeCourseWithFolder();
    const image1 = await recordUploadedImage("icon", "data:image/png;base64,AAAA");
    const note = await createNote("N", course.id, folder.id);
    // e.g. if image1.id is 1, this references "studybuddy-image:10" (some
    // other, unrelated image) — must not be read as also referencing
    // image1 just because "studybuddy-image:1" is a text prefix of it.
    await updateNoteMarkdown(note.id, `![x](studybuddy-image:${image1.id}0)`);
    expect(await isUploadedImageReferencedInNotes(image1.id)).toBe(false);
  });
});

describe("reconcileFlashcardScheduleAfterRemoval / reconcileFlashcardReviewsAfterRemoval", () => {
  async function makeItemWithCards() {
    const { folder } = await makeCourseWithFolder();
    return createGeneratedItem({
      courseId: folder.course_id,
      folderId: folder.id,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: "Cards",
      contentJson: { cards: [] },
      sourceDocumentIds: [],
    });
  }

  it("shifts surviving schedule rows' card_index down and drops the removed card's row", async () => {
    const item = await makeItemWithCards();
    for (let i = 0; i < 4; i++) {
      await upsertFlashcardSchedule({
        generatedItemId: item.id,
        cardIndex: i,
        easeFactor: 2.5,
        intervalDays: 1,
        repetitions: 1,
        dueAt: "2026-01-01 00:00:00",
      });
    }

    // Remove card index 1 — cards 2 and 3 should shift down to 1 and 2.
    await reconcileFlashcardScheduleAfterRemoval(item.id, [1]);

    const remaining = await getFlashcardScheduleForItem(item.id);
    const indices = remaining.map((r) => r.card_index).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2]);
  });

  it("shifts surviving review-log rows' card_index the same way, and drops the removed card's rows", async () => {
    const item = await makeItemWithCards();
    await logFlashcardReview({ generatedItemId: item.id, cardIndex: 0, result: "good" });
    await logFlashcardReview({ generatedItemId: item.id, cardIndex: 1, result: "good" });
    await logFlashcardReview({ generatedItemId: item.id, cardIndex: 2, result: "hard" });
    await logFlashcardReview({ generatedItemId: item.id, cardIndex: 2, result: "easy" }); // 2nd review of card 2

    await reconcileFlashcardReviewsAfterRemoval(item.id, [1]);

    const remaining = await listFlashcardReviewsForItem(item.id);
    const indices = remaining.map((r) => r.card_index).sort((a, b) => a - b);
    // Card 0 unaffected; both of card 2's log rows survive, shifted to 1.
    expect(indices).toEqual([0, 1, 1]);
  });

  it("is a no-op when removedIndices is empty", async () => {
    const item = await makeItemWithCards();
    await logFlashcardReview({ generatedItemId: item.id, cardIndex: 0, result: "good" });
    await reconcileFlashcardReviewsAfterRemoval(item.id, []);
    const remaining = await listFlashcardReviewsForItem(item.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].card_index).toBe(0);
  });
});

// Regression coverage: a single corrupted/truncated generated_items.content_json
// row used to throw an uncaught JSON.parse error that took out the entire
// function it ran inside — /api/stats (the whole home dashboard) for
// listDueFlashcardItems, and /api/search (all search) for the item-candidate
// scan inside searchAll. Both now skip just the broken row.
describe("resilience to a corrupted content_json row", () => {
  it("listDueFlashcardItems skips a flashcard item with unparseable content_json instead of throwing", async () => {
    const { course, folder } = await makeCourseWithFolder();
    const broken = await createGeneratedItem({
      courseId: course.id,
      folderId: folder.id,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: "Broken",
      contentJson: { cards: [{ front: "f", back: "b" }] },
      sourceDocumentIds: [],
    });
    testDb.db
      .update(testDb.schema.generated_items)
      .set({ content_json: "not valid json{" })
      .where(eq(testDb.schema.generated_items.id, broken.id))
      .run();
    const good = await createGeneratedItem({
      courseId: course.id,
      folderId: folder.id,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: "Good",
      contentJson: { cards: [{ front: "f", back: "b" }] },
      sourceDocumentIds: [],
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const due = await listDueFlashcardItems();
    consoleError.mockRestore();

    expect(due.map((d) => d.itemId)).not.toContain(broken.id);
    expect(due.map((d) => d.itemId)).toContain(good.id);
  });

  it("searchAll skips an item with unparseable content_json instead of failing the whole search", async () => {
    const { course, folder } = await makeCourseWithFolder();
    const broken = await createGeneratedItem({
      courseId: course.id,
      folderId: folder.id,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "quiz",
      title: "Broken quiz about photosynthesis",
      contentJson: { questions: [] },
      sourceDocumentIds: [],
    });
    testDb.db
      .update(testDb.schema.generated_items)
      .set({ content_json: "not valid json{" })
      .where(eq(testDb.schema.generated_items.id, broken.id))
      .run();

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const results = await searchAll("photosynthesis");
    consoleError.mockRestore();

    const itemIds = results.filter((r) => r.kind === "item").map((r) => r.itemId);
    expect(itemIds).not.toContain(broken.id);
  });
});
