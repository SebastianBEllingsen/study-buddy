import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { TestDb } from "./db/testHarness";

let testDb: TestDb;
vi.mock("./db", async () => {
  const { createTestDb } = await import("./db/testHarness");
  testDb = createTestDb();
  return { db: testDb.db, runTransaction: testDb.runTransaction, ...testDb.schema };
});

const { createCourse, createGeneratedItem, updateGeneratedItemContent } = await import("./models");
const { itemContents } = await import("./itemContentCache");

async function deck(front: string) {
  const course = await createCourse(`Course ${Math.random()}`);
  return createGeneratedItem({
    courseId: course.id,
    folderId: null,
    sourceFolderId: null,
    sourceHandpicked: false,
    mode: "flashcards",
    title: "Deck",
    contentJson: { cards: [{ front, back: "b" }] },
    sourceDocumentIds: [],
  });
}

describe("itemContents", () => {
  it("serves unchanged items from memory and refetches changed ones", async () => {
    const item = await deck("first");
    expect(JSON.parse((await itemContents([item])).get(item.id)!).cards[0].front).toBe("first");

    // Changed behind the cache's back without bumping updated_at: still the
    // remembered copy, proving it wasn't downloaded again.
    const { generated_items } = testDb.schema;
    await testDb.db
      .update(generated_items)
      .set({ content_json: JSON.stringify({ cards: [{ front: "sneaky", back: "b" }] }) })
      .where(eq(generated_items.id, item.id));
    expect(JSON.parse((await itemContents([item])).get(item.id)!).cards[0].front).toBe("first");

    // A real content update is picked up.
    const updated = await updateGeneratedItemContent({
      id: item.id,
      contentJson: { cards: [{ front: "second", back: "b" }] },
      sourceDocumentIds: [],
    });
    expect(JSON.parse((await itemContents([updated])).get(item.id)!).cards[0].front).toBe("second");
  });
});
