import {
  getGeneratedItem,
  listQuizAttemptsForItem,
  listFlashcardReviewsForItem,
  moveGeneratedItem,
  deleteGeneratedItem,
  getNewDocumentsForItem,
  getFlashcardScheduleForItem,
  updateGeneratedItemContent,
  reconcileFlashcardScheduleAfterRemoval,
  type GenerationMode,
} from "@/lib/models";
import { computeDueCardIndices } from "@/lib/spacedRepetition";
import type { FlashcardsContent } from "@/lib/types";

// Only checks the shape the rest of the app actually reads (ReactMarkdown's
// string, FlashcardViewer's card array, QuizRunner's question array) — not
// full per-field validation. Good enough to reject an obviously wrong edit
// (wrong mode's shape entirely) without crashing rendering downstream;
// deeper validation of quiz question internals is out of scope for now.
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
          typeof (card as Record<string, unknown>).back === "string"
      )
    );
  }
  if (mode === "quiz") return Array.isArray(c.questions);
  return false;
}

type Params = { params: Promise<{ itemId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { itemId } = await params;
    const id = Number(itemId);
    const item = await getGeneratedItem(id);
    if (!item) {
      return Response.json({ error: "Item not found" }, { status: 404 });
    }

    const [attempts, reviews, newDocuments, schedule] = await Promise.all([
      item.mode === "quiz" ? listQuizAttemptsForItem(id) : Promise.resolve([]),
      item.mode === "flashcards" ? listFlashcardReviewsForItem(id) : Promise.resolve([]),
      getNewDocumentsForItem(item),
      item.mode === "flashcards" ? getFlashcardScheduleForItem(id) : Promise.resolve([]),
    ]);

    return Response.json({
      item,
      attempts,
      reviews,
      availableNewDocuments: newDocuments.map((d) => ({
        id: d.id,
        filename: d.filename,
      })),
      dueCardIndices:
        item.mode === "flashcards"
          ? computeDueCardIndices(
              schedule,
              (JSON.parse(item.content_json) as FlashcardsContent).cards.length
            )
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
    const id = Number(itemId);
    const body = await request.json();

    if (body?.folderId !== undefined) {
      if (!Number.isInteger(body.folderId)) {
        return Response.json({ error: "folderId is required" }, { status: 400 });
      }
      await moveGeneratedItem(id, body.folderId);
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
        await reconcileFlashcardScheduleAfterRemoval(id, removedIndices);
      }
      return Response.json({ item: updated });
    }

    return Response.json({ error: "Nothing to update" }, { status: 400 });
  } catch (err) {
    console.error("Updating item failed:", err);
    return Response.json({ error: "Couldn't update this item" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { itemId } = await params;
    await deleteGeneratedItem(Number(itemId));
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("Deleting item failed:", err);
    return Response.json({ error: "Couldn't delete this item" }, { status: 500 });
  }
}
