import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { TestDb } from "./db/testHarness";
import { PgDialect } from "drizzle-orm/pg-core";
import * as pgSchema from "./db/schema.pg";

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
  createDocument,
  getDocument,
  moveDocument,
  createNote,
  getNote,
  moveNote,
  updateNoteMarkdown,
  getNoteBacklinks,
  createGeneratedItem,
  getGeneratedItem,
  moveGeneratedItem,
  recordUploadedImage,
  isUploadedImageReferencedInContent,
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
  createCanvas,
  getCanvas,
  listCanvasesForCourse,
  renameCanvas,
  updateCanvasData,
  reorderCanvases,
  deleteCanvas,
  getCanvasBacklinksForNote,
  canvasCandidates,
  recordRecentView,
  listRecentViews,
  positionCases,
  getCourse,
  updateCourseCustomization,
  listCourseSummaries,
  getAppSettings,
  setFolderChips,
  setAppWallpaper,
  setHeaderTint,
  setDashboardLinks,
  setHomeWidgets,
  isImageUrlReferenced,
  setCoursePageDisplay,
  setAppBranding,
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
  db.delete(schema.canvases).run();
  db.delete(schema.folders).run();
  db.delete(schema.courses).run();
  db.delete(schema.uploaded_images).run();
  db.delete(schema.recent_views).run();
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

describe("positionCases on Postgres", () => {
  // Regression: this suite runs on SQLite, which accepted the untyped
  // "WHEN $1 THEN $2" form — Postgres resolved that CASE to text and
  // rejected every reorder against the integer position column. Rendering
  // with the real Postgres dialect is as close as this suite can get
  // without a live database (see importGuard.test.ts).
  it("casts every position so Postgres types the CASE as an integer", () => {
    const { sql, params } = new PgDialect().sqlToQuery(positionCases(pgSchema.courses.id as never, [3, 1, 2]));
    expect(sql).toBe(
      'CASE "courses"."id" WHEN $1 THEN CAST($2 AS INTEGER) WHEN $3 THEN CAST($4 AS INTEGER) WHEN $5 THEN CAST($6 AS INTEGER) END'
    );
    expect(params).toEqual([3, 0, 1, 1, 2, 2]);
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
  it("moves documents/items/notes to the course page (folder_id null) rather than orphaning them", async () => {
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

    const movedDoc = await getDocument(doc.id);
    const movedNote = await getNote(note.id);
    expect(movedDoc?.folder_id).toBeNull();
    expect(movedNote?.folder_id).toBeNull();
    // The deleted folder itself is really gone.
    expect(await getFolder(folder.id)).toBeUndefined();
  });

  it("just deletes an empty folder with nothing to reassign", async () => {
    const course = await createCourse("C");
    const folder = await createFolder(course.id, "Empty");
    await deleteFolder(folder.id);
    expect(await getFolder(folder.id)).toBeUndefined();
    const { db, schema } = testDb;
    const remaining = db.select().from(schema.folders).all();
    expect(remaining).toHaveLength(0);
  });
});

describe("filing with no folder chosen", () => {
  it("creating a document/note/generated item with folderId null lands directly on the course page", async () => {
    const course = await createCourse("C");
    const doc = await createDocument({
      courseId: course.id,
      folderId: null,
      filename: "doc.pdf",
      filePath: "/tmp/doc.pdf",
      fileBase64: null,
    });
    const note = await createNote("N", course.id, null);
    const item = await createGeneratedItem({
      courseId: course.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "notes",
      title: "T",
      contentJson: {},
      sourceDocumentIds: [],
    });

    expect(doc.folder_id).toBeNull();
    expect(note.folder_id).toBeNull();
    expect(item.folder_id).toBeNull();
    // No "Unsorted" (or any other) folder should have been conjured up.
    const { db, schema } = testDb;
    const folders = db.select().from(schema.folders).all();
    expect(folders).toHaveLength(0);
  });

  it("moving a document back to folderId null un-files it onto the course page", async () => {
    const { course, folder } = await makeCourseWithFolder();
    const doc = await createDocument({
      courseId: course.id,
      folderId: folder.id,
      filename: "doc.pdf",
      filePath: "/tmp/doc.pdf",
      fileBase64: null,
    });

    await moveDocument(doc.id, null);

    expect((await getDocument(doc.id))?.folder_id).toBeNull();
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

describe("isUploadedImageReferencedInContent", () => {
  it("returns true when a note embeds the image by id", async () => {
    const { course, folder } = await makeCourseWithFolder();
    const image = await recordUploadedImage("icon", "data:image/png;base64,AAAA");
    const note = await createNote("N", course.id, folder.id);
    await updateNoteMarkdown(note.id, `Look: ![x](studybuddy-image:${image.id})`);

    expect(await isUploadedImageReferencedInContent(image.id)).toBe(true);
  });

  it("returns false when no note references the image", async () => {
    const image = await recordUploadedImage("icon", "data:image/png;base64,AAAA");
    expect(await isUploadedImageReferencedInContent(image.id)).toBe(false);
  });

  it("does not false-positive on a numeric prefix match (id 1 referenced by id 10's text)", async () => {
    // Regression coverage: an earlier version of this test wrote a note
    // referencing a *different* image's id (with a trailing digit) and
    // asserted the first image wasn't referenced — which passed whether or
    // not the implementation's negative-lookahead prefix guard
    // (`(?!\d)` in models.ts's isUploadedImageReferencedInContent) was there
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
    expect(await isUploadedImageReferencedInContent(image1.id)).toBe(false);
  });
});

describe("getNoteBacklinks", () => {
  it("counts both [[note:ID]] links and Obsidian-style [[Title]] links", async () => {
    const course = await createCourse("C");
    const target = await createNote("Custom PCB", course.id);
    const byId = await createNote("By id", course.id, null, `See [[note:${target.id}]].`);
    const byName = await createNote(
      "By name",
      course.id,
      null,
      "Plan → [[custom pcb]]\nLater: [[Custom PCB#Stage|stage]]\nNot [[Custom PCBs]], not `[[Custom PCB]]`"
    );
    await createNote("Unrelated", course.id, null, "[[Firmware]] and [[#Custom PCB]]");

    const backlinks = await getNoteBacklinks(target.id);
    expect(backlinks.map((b) => [b.noteId, b.context])).toEqual([
      [byId.id, `See [[note:${target.id}]].`],
      [byName.id, "Plan → [[custom pcb]]"],
      [byName.id, "Later: [[Custom PCB#Stage|stage]]"],
    ]);
  });

  it("doesn't count a note's own self-links", async () => {
    const course = await createCourse("C");
    const note = await createNote("Self", course.id, null, "[[Self]]");
    expect(await getNoteBacklinks(note.id)).toEqual([]);
  });
});

describe("canvases", () => {
  const fileNode = (id: string, file: string) => ({ id, type: "file" as const, file, x: 0, y: 0, width: 400, height: 400 });

  it("appends new canvases at increasing positions and lists them without their data", async () => {
    const course = await createCourse("C");
    const a = await createCanvas("A", course.id);
    const b = await createCanvas("B", course.id);
    expect([a.position, b.position]).toEqual([0, 1]);
    expect(a.data).toEqual({ nodes: [], edges: [] });

    const list = await listCanvasesForCourse(course.id);
    expect(list.map((c) => c.title)).toEqual(["A", "B"]);
    expect(list[0]).not.toHaveProperty("data");
  });

  it("persists renames, data, and reorders", async () => {
    const course = await createCourse("C");
    const a = await createCanvas("A", course.id);
    const b = await createCanvas("B", course.id);
    await renameCanvas(a.id, "Renamed");
    const data = { nodes: [{ id: "t", type: "text" as const, text: "hi", x: 1, y: 2, width: 250, height: 60 }], edges: [] };
    await updateCanvasData(a.id, data);
    await reorderCanvases(course.id, [b.id, a.id]);

    const stored = await getCanvas(a.id);
    expect(stored?.title).toBe("Renamed");
    expect(stored?.data).toEqual(data);
    expect((await listCanvasesForCourse(course.id)).map((c) => c.id)).toEqual([b.id, a.id]);
  });

  it("reads a corrupted data column back as an empty board", async () => {
    const course = await createCourse("C");
    const canvas = await createCanvas("A", course.id);
    testDb.db.update(testDb.schema.canvases).set({ data: "{broken" }).where(eq(testDb.schema.canvases.id, canvas.id)).run();
    expect((await getCanvas(canvas.id))?.data).toEqual({ nodes: [], edges: [] });
  });

  it("is removed with its course and by deleteCanvas", async () => {
    const course = await createCourse("C");
    const a = await createCanvas("A", course.id);
    const b = await createCanvas("B", course.id);
    await deleteCanvas(a.id);
    expect(await getCanvas(a.id)).toBeUndefined();
    await deleteCourse(course.id);
    expect(await getCanvas(b.id)).toBeUndefined();
  });

  it("reports canvases that show a note as its backlinks", async () => {
    const { course, folder } = await makeCourseWithFolder();
    const note = await createNote("N", course.id, folder.id);
    const asCard = await createCanvas("Card", course.id, { nodes: [fileNode("f", `note:${note.id}`)], edges: [] });
    const asLink = await createCanvas("Link", course.id, {
      nodes: [{ id: "t", type: "text", text: `see [[note:${note.id}]]`, x: 0, y: 0, width: 250, height: 60 }],
      edges: [],
    });
    await createCanvas("Unrelated", course.id, { nodes: [fileNode("f", `note:${note.id + 1}`)], edges: [] });

    const backlinks = await getCanvasBacklinksForNote(note.id);
    expect(backlinks.map((b) => b.canvasId).sort()).toEqual([asCard.id, asLink.id].sort());
  });

  it("is searchable by its title, text cards, group names and arrow labels", async () => {
    const course = await createCourse("C");
    const canvas = await createCanvas("Laptop plan", course.id, {
      nodes: [
        { id: "t", type: "text", text: "Mainboard\nUses a [[note:99|Buck converter]]", x: 0, y: 0, width: 250, height: 60 },
        { id: "u", type: "text", text: "Other", x: 300, y: 0, width: 250, height: 60 },
        { id: "g", type: "group", label: "Peripheral system", x: -50, y: -50, width: 900, height: 300 },
      ],
      edges: [{ id: "e", fromNode: "t", toNode: "u", label: "thunderbolt" }],
    });

    for (const query of ["Laptop plan", "Mainboard", "Peripheral", "thunderbolt", "Buck converter"]) {
      const results = await searchAll(query, course.id);
      expect(results, query).toContainEqual(
        expect.objectContaining({ kind: "canvas", canvasId: canvas.id, canvasTitle: "Laptop plan" })
      );
    }
  });

  it("builds search candidates without the raw [[link]] syntax", () => {
    const candidates = canvasCandidates(
      "Title",
      { nodes: [{ id: "t", type: "text", text: "see [[note:1|Intro]]", x: 0, y: 0, width: 250, height: 60 }], edges: [] },
      "canvas:1"
    );
    expect(candidates.map((c) => c.text)).toEqual(["Title", "see Intro"]);
  });

  it("shows up in recent activity, and drops out once deleted", async () => {
    const course = await createCourse("C");
    const canvas = await createCanvas("Board", course.id);
    await recordRecentView("canvas", canvas.id);
    expect(await listRecentViews()).toEqual([
      expect.objectContaining({ type: "canvas", id: canvas.id, title: "Board", courseId: course.id, courseName: "C" }),
    ]);
    await deleteCanvas(canvas.id);
    expect(await listRecentViews()).toEqual([]);
  });

  it("keeps an uploaded image that a canvas still shows from being treated as unused", async () => {
    const course = await createCourse("C");
    const image = await recordUploadedImage("note", "data:image/png;base64,AAAA");
    expect(await isUploadedImageReferencedInContent(image.id)).toBe(false);
    await createCanvas("A", course.id, { nodes: [fileNode("i", `image:${image.id}`)], edges: [] });
    expect(await isUploadedImageReferencedInContent(image.id)).toBe(true);
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
describe("course page display settings", () => {
  it("new courses show Practice and follow the global folder tags", async () => {
    const course = await createCourse("Course");
    const stored = await getCourse(course.id);
    expect(stored?.show_practice).toBe(true);
    expect(stored?.folder_chips).toBeNull();
    expect(stored?.lock_background_crop).toBe(false);
  });

  it("stores a course's own Practice and folder tag choices, also in the dashboard summary", async () => {
    const course = await createCourse("Course");
    await updateCourseCustomization(course.id, {
      show_practice: false,
      lock_background_crop: true,
      folder_chips: JSON.stringify({ enabled: true, hidden: ["notes"] }),
    });
    const summary = (await listCourseSummaries()).find((c) => c.id === course.id);
    expect(summary?.show_practice).toBe(false);
    expect(summary?.lock_background_crop).toBe(true);
    expect(summary?.folder_chips).toBe('{"enabled":true,"hidden":["notes"]}');
  });

  it("round-trips the global folder tag setting, defaulting to every tag", async () => {
    expect((await getAppSettings()).folderChips).toEqual({ enabled: true, hidden: [] });
    await setFolderChips({ enabled: false, hidden: ["generated"] });
    expect((await getAppSettings()).folderChips).toEqual({ enabled: false, hidden: ["generated"] });
    await setFolderChips({ enabled: true, hidden: [] });
  });

  it("round-trips the app wallpaper setting, off by default", async () => {
    expect((await getAppSettings()).appWallpaper.enabled).toBe(false);
    const wallpaper = { enabled: true, areas: ["notes" as const], dim: 55, blur: 10 };
    await setAppWallpaper(wallpaper);
    expect((await getAppSettings()).appWallpaper).toEqual(wallpaper);
    await setAppWallpaper({ ...wallpaper, enabled: false });
  });

  it("round-trips hiding course backdrops and icons, both off by default", async () => {
    let settings = await getAppSettings();
    expect([settings.hideCourseBackdrops, settings.hideCourseIcons]).toEqual([false, false]);
    await setCoursePageDisplay({ hideCourseBackdrops: true });
    settings = await getAppSettings();
    expect([settings.hideCourseBackdrops, settings.hideCourseIcons]).toEqual([true, false]);
    await setCoursePageDisplay({ hideCourseIcons: true, hideCourseBackdrops: false });
    settings = await getAppSettings();
    expect([settings.hideCourseBackdrops, settings.hideCourseIcons]).toEqual([false, true]);
    await setCoursePageDisplay({ hideCourseIcons: false });
  });

  it("stores the dashboard backdrop blur, clamped", async () => {
    expect((await getAppSettings()).dashboardBackdropBlur).toBe(0);
    await setAppBranding({ dashboardBackdropBlur: 9 });
    expect((await getAppSettings()).dashboardBackdropBlur).toBe(9);
    await setAppBranding({ dashboardBackdropBlur: 999 });
    expect((await getAppSettings()).dashboardBackdropBlur).toBe(24);
    await setAppBranding({ dashboardBackdropBlur: 0 });
  });

  it("round-trips dashboard links, empty by default", async () => {
    expect((await getAppSettings()).dashboardLinks).toEqual([]);
    const links = [{ id: "a", title: "Lectures", url: "https://youtube.com/", icon: "brand:youtube" }];
    await setDashboardLinks(links);
    expect((await getAppSettings()).dashboardLinks).toEqual(links);
    await setDashboardLinks([]);
  });

  it("counts an uploaded link icon as in use, so its image is never deleted from under it", async () => {
    const url = "/api/blobs/icon/link-icon.png";
    expect(await isImageUrlReferenced(url)).toBe(false);
    await setDashboardLinks([{ id: "a", title: "Site", url: "https://example.org/", icon: `image:${url}` }]);
    expect(await isImageUrlReferenced(url)).toBe(true);
    await setDashboardLinks([]);
    expect(await isImageUrlReferenced(url)).toBe(false);
  });

  it("adds the Links widget hidden to a dashboard saved before it existed", async () => {
    const before = (await getAppSettings()).homeWidgets.filter((w) => w.id !== "links");
    await setHomeWidgets(before);
    const links = (await getAppSettings()).homeWidgets.find((w) => w.id === "links");
    expect(links?.enabled).toBe(false);
  });

  it("round-trips the nav bar color mode, static by default", async () => {
    expect((await getAppSettings()).headerTint).toBe("static");
    await setHeaderTint("adaptive-text");
    expect((await getAppSettings()).headerTint).toBe("adaptive-text");
    await setHeaderTint("static");
    expect((await getAppSettings()).headerTint).toBe("static");
  });
});

describe("listDueFlashcardItems", () => {
  it("doesn't count cards reviewed ahead of time as due", async () => {
    const { course, folder } = await makeCourseWithFolder();
    const deck = await createGeneratedItem({
      courseId: course.id,
      folderId: folder.id,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "flashcards",
      title: "Deck",
      contentJson: { cards: [{ front: "a", back: "a" }, { front: "b", back: "b" }, { front: "c", back: "c" }] },
      sourceDocumentIds: [],
    });
    const schedule = { generatedItemId: deck.id, easeFactor: 2.5, intervalDays: 1, repetitions: 1 };
    // Card 0 reviewed and not due yet, card 1 overdue, card 2 never reviewed.
    await upsertFlashcardSchedule({ ...schedule, cardIndex: 0, dueAt: "2999-01-01 00:00:00" });
    await upsertFlashcardSchedule({ ...schedule, cardIndex: 1, dueAt: "2000-01-01 00:00:00" });

    expect((await listDueFlashcardItems()).find((d) => d.itemId === deck.id)?.dueCount).toBe(2);

    await upsertFlashcardSchedule({ ...schedule, cardIndex: 1, dueAt: "2999-01-01 00:00:00" });
    await upsertFlashcardSchedule({ ...schedule, cardIndex: 2, dueAt: "2999-01-01 00:00:00" });

    expect((await listDueFlashcardItems()).map((d) => d.itemId)).not.toContain(deck.id);
  });
});

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
