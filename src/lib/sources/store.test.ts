import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestDb } from "../db/testHarness";

// Same setup as models.test.ts: "../db" points at a throwaway in-memory
// SQLite database bootstrapped with the production schema.
let testDb: TestDb;
vi.mock("../db", async () => {
  const { createTestDb } = await import("../db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});

const generateStructured = vi.fn();
vi.mock("../aiClient", () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
}));

const models = await import("../models");
const { buildCourseContext } = await import("../context");
const { reportItemWrong, resolveFlag, listCourseFlags, suggestFix } = await import("./flagStore");
const { runConflictCheck, latestConflictCheck, newSourceCount, NotEnoughSourcesError } = await import("./conflicts");
const reviewStore = await import("../review/store");
const mistakesModule = await import("../review/mistakes");
const { recordCardAnswer, recordQuizAnswers } = await import("../review/answers");

const uid = () => Math.random().toString(36).slice(2, 8);

async function course() {
  return models.createCourse(`Sample Course ${uid()}`);
}

async function doc(courseId: number, filename: string, text: string, folderId: number | null = null) {
  const d = await models.createDocument({ courseId, folderId, filename, filePath: "", fileBase64: null });
  await models.markDocumentExtracted({ id: d.id, extractedText: text, pageCount: 1, charCount: text.length });
  return d;
}

beforeEach(() => generateStructured.mockReset());

describe("buildCourseContext with notes", () => {
  it("includes only notes marked for generation, labelled with their trust", async () => {
    const c = await course();
    await doc(c.id, "slides.pdf", "Official text");
    const personal = await models.createNote(`My notes ${uid()}`, c.id, null, "My own summary");
    const copied = await models.createNote(`Copied slides ${uid()}`, c.id, null, "Copied [[doc:1|link]] text");
    await models.createNote(`Scratch ${uid()}`, c.id, null, "Not for generation");
    await models.setNoteGenerationSource(personal.id, "personal");
    await models.setNoteGenerationSource(copied.id, "official");

    const context = await buildCourseContext(c.id);
    expect(context.noteIds.sort()).toEqual([personal.id, copied.id].sort());
    expect(context.combinedText).toContain("--- Document: slides.pdf [authoritative material] ---");
    expect(context.combinedText).toContain(`--- Note: ${personal.title} [personal notes] ---\nMy own summary`);
    expect(context.combinedText).toContain("Copied link text");
    expect(context.combinedText).not.toContain("Not for generation");
    expect(context.sources.map((s) => s.kind)).toEqual(["document", "note", "note"]);
  });

  it("marks a document personal, and scopes notes to the picked folder", async () => {
    const c = await course();
    const folder = await models.createFolder(c.id, "Week 1");
    const d = await doc(c.id, "own.pdf", "Mine", folder.id);
    await models.setDocumentTrust(d.id, "personal");
    const inFolder = await models.createNote(`In folder ${uid()}`, c.id, folder.id, "Inside");
    const outside = await models.createNote(`Outside ${uid()}`, c.id, null, "Outside");
    await models.setNoteGenerationSource(inFolder.id, "official");
    await models.setNoteGenerationSource(outside.id, "official");

    const context = await buildCourseContext(c.id, { folderId: folder.id });
    expect(context.combinedText).toContain("--- Document: own.pdf [personal notes] ---");
    expect(context.noteIds).toEqual([inFolder.id]);

    const handpicked = await buildCourseContext(c.id, { documentIds: [d.id] });
    expect(handpicked.noteIds).toEqual([]);
  });
});

async function deckWithHistory() {
  const c = await course();
  const item = await models.createGeneratedItem({
    courseId: c.id,
    folderId: null,
    sourceFolderId: null,
    sourceHandpicked: false,
    mode: "flashcards",
    title: "Sample flashcards",
    contentJson: {
      cards: [
        { front: "A", back: "a" },
        { front: "B", back: "wrong", source: { kind: "document", id: 99, title: "gone.pdf" } },
        { front: "C", back: "c" },
      ],
    },
    sourceDocumentIds: [],
  });
  const cards = JSON.parse(item.content_json).cards;
  for (const cardIndex of [0, 1, 2]) {
    await recordCardAnswer({ item, card: cards[cardIndex], cardIndex, result: "again", confidence: null, source: "deck" });
  }
  return { c, item };
}

async function cardsOf(id: number) {
  return JSON.parse((await models.getGeneratedItem(id))!.content_json).cards as Record<string, unknown>[];
}

describe("flag store", () => {
  it("reporting holds the card back and clears the mistakes it caused", async () => {
    const { c, item } = await deckWithHistory();
    await reportItemWrong(item.id, 1, "The answer is inverted");
    expect((await cardsOf(item.id))[1].flag).toMatchObject({ by: "student", issue: "The answer is inverted" });
    const open = (await mistakesModule.listMistakes({ courseId: c.id })).map((m) => m.item_index).sort();
    expect(open).toEqual([0, 2]);
    expect((await listCourseFlags(c.id)).map((f) => [f.itemId, f.index])).toEqual([[item.id, 1]]);
  });

  it("saving a fix clears the flag and brings the card up for review now", async () => {
    const { item } = await deckWithHistory();
    await reportItemWrong(item.id, 1, "");
    const before = (await reviewStore.listReviewItemsForItem(item.id, "card")).find((r) => r.item_index === 1)!;
    await resolveFlag(item.id, 1, { action: "save", entry: { front: "B", back: "right" } });
    const cards = await cardsOf(item.id);
    expect(cards[1]).toEqual({ front: "B", back: "right", source: { kind: "document", id: 99, title: "gone.pdf" } });
    const after = (await reviewStore.listReviewItemsForItem(item.id, "card")).find((r) => r.item_index === 1)!;
    expect(after.due_at <= before.due_at).toBe(true);
    expect(new Date(after.due_at.replace(" ", "T") + "Z").getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("removing shifts later review rows and mistakes down", async () => {
    const { c, item } = await deckWithHistory();
    await reportItemWrong(item.id, 1, "");
    await resolveFlag(item.id, 1, { action: "remove" });
    expect((await cardsOf(item.id)).map((card) => card.front)).toEqual(["A", "C"]);
    const indices = (await reviewStore.listReviewItemsForItem(item.id, "card")).map((r) => r.item_index).sort();
    expect(indices).toEqual([0, 1]);
    const open = (await mistakesModule.listMistakes({ courseId: c.id })).map((m) => m.item_index).sort();
    expect(open).toEqual([0, 1]);
  });

  it("keeping returns it unchanged to review", async () => {
    const { item } = await deckWithHistory();
    await reportItemWrong(item.id, 2, "");
    await resolveFlag(item.id, 2, { action: "keep" });
    expect((await cardsOf(item.id))[2]).toEqual({ front: "C", back: "c" });
  });

  it("asks the AI for a fix without saving it", async () => {
    const { item } = await deckWithHistory();
    await reportItemWrong(item.id, 1, "Inverted");
    generateStructured.mockResolvedValue({ verdict: "fixed", note: "Swapped.", item: { front: "B", back: "right" } });
    const suggestion = await suggestFix(item.id, 1);
    expect(suggestion).toEqual({ verdict: "fixed", note: "Swapped.", item: { front: "B", back: "right" } });
    expect(generateStructured.mock.calls[0][0].user).toContain("Inverted");
    expect((await cardsOf(item.id))[1].back).toBe("wrong");
  });

  it("doesn't schedule or log answers to a flagged quiz question", async () => {
    const c = await course();
    const question = { type: "mcq" as const, question: "Pick", options: ["x", "y"], correctIndex: 0, explanation: "e" };
    const quiz = await models.createGeneratedItem({
      courseId: c.id,
      folderId: null,
      sourceFolderId: null,
      sourceHandpicked: false,
      mode: "quiz",
      title: "Sample quiz",
      contentJson: { questions: [question] },
      sourceDocumentIds: [],
    });
    const flagged = { ...question, flag: { by: "check" as const, issue: "Both are right", at: "t" } };
    const recorded = await recordQuizAnswers({
      item: quiz,
      source: "quiz",
      entries: [
        {
          question: flagged,
          answer: 1,
          confidence: null,
          result: { index: 0, type: "mcq", correct: false, feedback: "", explanation: "e", correctAnswer: "x" },
        },
      ],
    });
    expect(recorded).toEqual([{ index: 0, scheduled: false, dueAt: null }]);
    expect(await reviewStore.listReviewItemsForItem(quiz.id, "question")).toEqual([]);
  });
});

describe("conflict check", () => {
  it("needs two sources", async () => {
    const c = await course();
    await doc(c.id, "only.pdf", "text");
    await expect(runConflictCheck(c.id)).rejects.toBeInstanceOf(NotEnoughSourcesError);
  });

  it("stores the latest findings and which sources were compared", async () => {
    const c = await course();
    const d = await doc(c.id, "slides.pdf", "Water boils at 100 °C.");
    const note = await models.createNote(`Summary ${uid()}`, c.id, null, "Water boils at 90 °C.");
    await models.setNoteGenerationSource(note.id, "personal");
    generateStructured.mockResolvedValue({
      conflicts: [
        {
          topic: "Boiling point",
          claims: [
            { source: "slides.pdf", says: "100 °C" },
            { source: note.title, says: "90 °C" },
          ],
          likelyCorrect: "slides.pdf",
          explanation: "At standard pressure it's 100 °C.",
        },
      ],
    });
    await runConflictCheck(c.id);
    await runConflictCheck(c.id);
    const latest = await latestConflictCheck(c.id);
    expect(latest?.conflicts).toHaveLength(1);
    expect(latest?.conflicts[0].likelyCorrect).toEqual({ kind: "document", id: d.id, title: "slides.pdf" });
    expect(latest?.sourceKeys).toEqual([`doc:${d.id}`, `note:${note.id}`]);
    const rows = await testDb.db.select().from(testDb.schema.source_checks);
    expect(rows.filter((r) => r.course_id === c.id)).toHaveLength(1);
    expect(newSourceCount([...latest!.sourceKeys, "doc:12345"], latest!.sourceKeys)).toBe(1);
  });
});
