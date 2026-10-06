import { parseJsonObjectBody } from "@/lib/requestBody";
import {
  getGeneratedItem,
  listRecentQuizAttemptsForItem,
  getBestQuizScoreForItem,
  moveGeneratedItem,
  deleteGeneratedItem,
  getNewDocumentsForItem,
  updateGeneratedItemContent,
  reconcileFlashcardReviewsAfterRemoval,
  InvalidDestinationFolderError,
  type GenerationMode,
} from "@/lib/models";
import { removeUnreferencedBlobs } from "@/lib/blobStorage/cleanup";
import { deckDueCardIndices, deckDueReverseIndices } from "@/lib/dueCards";
import { cardDueRowsForItem, reverseDueRowsForItem, reconcileReviewItemsAfterRemoval } from "@/lib/review/store";
import { ensureFsrsMigrated } from "@/lib/review/legacyMigration";
import type { FlashcardsContent } from "@/lib/types";
import { parseId } from "@/lib/routeParams";
import { isValidCardMediaList } from "@/lib/cardMedia";

// Only checks the shape the rest of the app actually reads (ReactMarkdown's
// string, FlashcardViewer's card array, QuizRunner's question array) — not
// full per-field validation. Good enough to reject an obviously wrong edit
// (wrong mode's shape entirely) without crashing rendering downstream;
// deeper validation of quiz question internals is out of scope for now.
function isValidCardHtml(html: unknown): boolean {
  if (html === undefined) return true;
  if (!html || typeof html !== "object") return false;
  const h = html as Record<string, unknown>;
  return typeof h.front === "string" && typeof h.back === "string";
}

function isValidContent(mode: GenerationMode, content: unknown): boolean {
  if (!content || typeof content !== "object") return false;
  const c = content as Record<string, unknown>;
  if (mode === "notes") return typeof c.markdown === "string";
  if (mode === "flashcards") {
    return (
      Array.isArray(c.cards) &&
      c.cards.every(
        (card) =>
          card &&
          typeof card === "object" &&
          typeof (card as Record<string, unknown>).front === "string" &&
          typeof (card as Record<string, unknown>).back === "string" &&
          // Optional, imported decks only — see CardMedia in lib/types.ts.
          ["frontMedia", "backMedia"].every((key) => {
            const media = (card as Record<string, unknown>)[key];
            return media === undefined || isValidCardMediaList(media);
          }) &&
          // Optional, cards imported from Anki — see CardHtml in lib/types.ts.
          isValidCardHtml((card as Record<string, unknown>).html)
      ) &&
      (c.reminders === undefined || typeof c.reminders === "boolean")
    );
  }
  if (mode === "quiz") return Array.isArray(c.questions);
  return false;
}

type Params = { params: Promise<{ itemId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { itemId } = await params;
    const id = parseId(itemId);
    if (id === null) return Response.json({ error: "Item not found" }, { status: 404 });
    const item = await getGeneratedItem(id);
    if (!item) {
      return Response.json({ error: "Item not found" }, { status: 404 });
    }

    // Reviews (flashcard_reviews rows) aren't rendered anywhere on the item
    // detail page — dropped here rather than fetched and left unused.
    const [attempts, bestScore, newDocuments, schedule, reverseSchedule] = await Promise.all([
      item.mode === "quiz" ? listRecentQuizAttemptsForItem(id) : Promise.resolve([]),
      item.mode === "quiz" ? getBestQuizScoreForItem(id) : Promise.resolve(null),
      getNewDocumentsForItem(item),
      item.mode === "flashcards"
        ? ensureFsrsMigrated().then(() => cardDueRowsForItem(id))
        : Promise.resolve([]),
      item.mode === "flashcards" ? reverseDueRowsForItem(id) : Promise.resolve([]),
    ]);

    return Response.json({
      item,
      attempts,
      bestScore,
      availableNewDocuments: newDocuments.map((d) => ({
        id: d.id,
        filename: d.filename,
      })),
      dueCardIndices:
        item.mode === "flashcards"
          ? deckDueCardIndices(schedule, JSON.parse(item.content_json) as FlashcardsContent)
          : [],
      dueReverseIndices:
        item.mode === "flashcards"
          ? deckDueReverseIndices(schedule, reverseSchedule, JSON.parse(item.content_json) as FlashcardsContent)
          : [],
    });
  } catch (err) {
    console.error("Fetching item failed:", err);
    return Response.json({ error: "Couldn't load this item" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { itemId } = await params;
    const id = parseId(itemId);
    if (id === null) return Response.json({ error: "Item not found" }, { status: 404 });
    const body = await parseJsonObjectBody(request);

    if (body?.folderId !== undefined) {
      const folderId = body.folderId;
      if (folderId !== null && (typeof folderId !== "number" || !Number.isInteger(folderId))) {
        return Response.json({ error: "folderId is required" }, { status: 400 });
      }
      await moveGeneratedItem(id, folderId);
      return Response.json({ ok: true });
    }

    // Review reminders on/off for a flashcard set (see
    // FlashcardsContent.reminders): stored only as `false`, so turning them
    // on drops the key. Done here, from the saved content, so a bulk toggle
    // doesn't need each set's cards on the client.
    if (typeof body?.reminders === "boolean") {
      const item = await getGeneratedItem(id);
      if (!item) return Response.json({ error: "Item not found" }, { status: 404 });
      if (item.mode !== "flashcards") {
        return Response.json({ error: "Only flashcard sets have review reminders" }, { status: 400 });
      }
      const content = JSON.parse(item.content_json) as Record<string, unknown>;
      if (body.reminders) delete content.reminders;
      else content.reminders = false;
      await updateGeneratedItemContent({
        id,
        contentJson: content,
        sourceDocumentIds: JSON.parse(item.source_document_ids),
      });
      return Response.json({ ok: true });
    }

    if (body?.content !== undefined) {
      const item = await getGeneratedItem(id);
      if (!item) {
        return Response.json({ error: "Item not found" }, { status: 404 });
      }
      if (!isValidContent(item.mode, body.content)) {
        return Response.json({ error: "That content isn't in the right shape" }, { status: 400 });
      }
      const updated = await updateGeneratedItemContent({
        id,
        contentJson: body.content,
        sourceDocumentIds: JSON.parse(item.source_document_ids),
      });
      if (item.mode === "flashcards" && Array.isArray(body.removedCardIndices)) {
        const removedIndices = body.removedCardIndices.filter(
          (i: unknown): i is number => Number.isInteger(i)
        );
        await ensureFsrsMigrated();
        await reconcileReviewItemsAfterRemoval(id, "card", removedIndices);
        await reconcileFlashcardReviewsAfterRemoval(id, removedIndices);
      }
      return Response.json({ item: updated });
    }

    return Response.json({ error: "Nothing to update" }, { status: 400 });
  } catch (err) {
    if (err instanceof InvalidDestinationFolderError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Updating item failed:", err);
    return Response.json({ error: "Couldn't update this item" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { itemId } = await params;
    const id = parseId(itemId);
    if (id === null) return new Response(null, { status: 204 });
    const item = await getGeneratedItem(id);
    await deleteGeneratedItem(id);
    if (item) await removeUnreferencedBlobs([item.content_json]);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("Deleting item failed:", err);
    return Response.json({ error: "Couldn't delete this item" }, { status: 500 });
  }
}
