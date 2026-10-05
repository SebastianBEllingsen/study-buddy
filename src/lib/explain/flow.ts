import { generateStructured, generateText } from "../aiClient";
import {
  createGeneratedItem,
  deleteGeneratedItem,
  getAppSettings,
  getCourse,
  getGeneratedItem,
  reconcileFlashcardReviewsAfterRemoval,
  updateGeneratedItemContent,
} from "../models";
import { ensureFsrsMigrated } from "../review/legacyMigration";
import { reconcileReviewItemsAfterRemoval } from "../review/store";
import { languageName } from "../languages";
import { conversationText, explainEvaluationSystemPrompt, noviceSystemPrompt, type ExplainReference } from "../prompts/explain";
import { getChapter, getStudyPlan } from "../studyPlan/store";
import type { FlashcardsContent } from "../types";
import {
  createExplainSession,
  deleteExplainSession,
  finishExplainSession,
  getExplainSession,
  latestGapDeckId,
  saveMessages,
} from "./store";
import { MAX_NOVICE_QUESTIONS, type ExplainKind, type ExplainSession, type GapCard } from "./types";
import { normalizeExplainResult } from "./validate";

// Blurt: write everything you remember, then see the gaps. Feynman:
// explain it to an AI novice who asks up to MAX_NOVICE_QUESTIONS probing
// questions, then see the gaps. Either way, every gap becomes a flashcard
// in the course's "Gap cards" deck, so it comes back in spaced review.

export class ExplainSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExplainSessionError";
  }
}

export const GAP_DECK_TITLE = "Gap cards";

async function referenceFor(session: Pick<ExplainSession, "chapter_id" | "topic">): Promise<ExplainReference> {
  const chapter = session.chapter_id !== null ? await getChapter(session.chapter_id) : undefined;
  if (!chapter) return { topic: session.topic, summary: "", subtopics: [] };
  return { topic: chapter.title, summary: chapter.summary, subtopics: chapter.subtopics.map((s) => s.text) };
}

export async function startExplainSession(input: {
  courseId: number;
  kind: ExplainKind;
  chapterId?: number | null;
  topic?: string;
}): Promise<ExplainSession> {
  let topic = input.topic?.trim().slice(0, 200) ?? "";
  let chapterId: number | null = null;
  if (input.chapterId != null) {
    const chapter = await getChapter(input.chapterId);
    const owner = chapter ? await getStudyPlan(chapter.plan_id) : undefined;
    if (!chapter || owner?.course_id !== input.courseId) throw new ExplainSessionError("That chapter isn't in this course.");
    chapterId = chapter.id;
    topic ||= chapter.title;
  }
  if (!topic) throw new ExplainSessionError("Say what topic to explain.");
  return createExplainSession({ courseId: input.courseId, chapterId, kind: input.kind, topic });
}

// Adds the gap cards to the course's gap deck (creating it the first time).
export async function addGapCards(courseId: number, cards: GapCard[], chapterId: number | null): Promise<number | null> {
  if (cards.length === 0) return null;
  const existingId = await latestGapDeckId(courseId, GAP_DECK_TITLE);
  const existing = existingId !== null ? await getGeneratedItem(existingId) : undefined;
  const newCards = cards.map((c) => ({ front: c.front, back: c.back, concept: c.concept }));
  if (existing && existing.mode === "flashcards") {
    const content = JSON.parse(existing.content_json) as FlashcardsContent;
    await updateGeneratedItemContent({
      id: existing.id,
      contentJson: { ...content, cards: [...content.cards, ...newCards] },
      sourceDocumentIds: JSON.parse(existing.source_document_ids),
    });
    return existing.id;
  }
  const item = await createGeneratedItem({
    courseId,
    folderId: null,
    sourceFolderId: null,
    sourceHandpicked: false,
    mode: "flashcards",
    title: GAP_DECK_TITLE,
    contentJson: { cards: newCards },
    sourceDocumentIds: [],
    studyPlanChapterId: chapterId,
  });
  return item.id;
}

// Where a session's gap cards sit in the deck, matched by their text (the
// deck is shared by every session of the course and its cards carry no
// owner). A card edited since no longer matches and is left alone; of
// identical copies the latest goes, which has the least review history.
export function gapCardIndices(deck: { front: string; back: string }[], cards: GapCard[]): number[] {
  const taken = new Set<number>();
  for (const card of cards) {
    for (let i = deck.length - 1; i >= 0; i--) {
      if (!taken.has(i) && deck[i].front === card.front && deck[i].back === card.back) {
        taken.add(i);
        break;
      }
    }
  }
  return [...taken].sort((a, b) => a - b);
}

// Deletes a session; with `deleteCards`, also takes its gap cards out of the
// course's gap deck (reviews of the cards after them move down with them, as
// when editing a deck) and drops the deck itself if that empties it.
// null when there's no such session.
export async function deleteSession(
  id: number,
  deleteCards: boolean
): Promise<{ removedCards: number; totalCards: number } | null> {
  const session = await getExplainSession(id);
  if (!session) return null;
  const cards = session.result?.cards ?? [];
  let removedCards = 0;
  if (deleteCards && cards.length > 0 && session.practice_item_id !== null) {
    const deck = await getGeneratedItem(session.practice_item_id);
    if (deck && deck.mode === "flashcards") {
      const content = JSON.parse(deck.content_json) as FlashcardsContent;
      const removed = gapCardIndices(content.cards, cards);
      if (removed.length > 0) {
        removedCards = removed.length;
        const kept = content.cards.filter((_, i) => !removed.includes(i));
        if (kept.length === 0) {
          await deleteGeneratedItem(deck.id);
        } else {
          await updateGeneratedItemContent({
            id: deck.id,
            contentJson: { ...content, cards: kept },
            sourceDocumentIds: JSON.parse(deck.source_document_ids),
          });
          await ensureFsrsMigrated();
          await reconcileReviewItemsAfterRemoval(deck.id, "card", removed);
          await reconcileFlashcardReviewsAfterRemoval(deck.id, removed);
        }
      }
    }
  }
  await deleteExplainSession(id);
  return { removedCards, totalCards: cards.length };
}

async function evaluate(session: ExplainSession, messages: ExplainSession["messages"]): Promise<ExplainSession> {
  const [{ aiEfficiencyMode: efficient, preferredLanguage }, ref] = await Promise.all([getAppSettings(), referenceFor(session)]);
  const course = await getCourse(session.course_id);
  const result = normalizeExplainResult(
    await generateStructured<unknown>({
      system: explainEvaluationSystemPrompt(
        { ...ref, topic: course ? `${ref.topic} (${course.name})` : ref.topic },
        languageName(preferredLanguage),
        session.kind
      ),
      user: conversationText(messages),
      maxTokens: 6000,
      effort: efficient ? "low" : "medium",
      efficient,
    })
  );
  const deckId = await addGapCards(session.course_id, result.cards, session.chapter_id);
  await saveMessages(session.id, messages);
  await finishExplainSession(session.id, result, deckId);
  return (await getExplainSession(session.id)) as ExplainSession;
}

const MAX_TURN_CHARS = 20_000;

// One student turn. A blurt is evaluated right away; in a Feynman session
// the novice asks its next question until it has asked enough (or the
// student says they're done), then the whole conversation is evaluated.
export async function explainTurn(sessionId: number, input: { text: string; finish?: boolean }): Promise<ExplainSession> {
  const session = await getExplainSession(sessionId);
  if (!session) throw new ExplainSessionError("Session not found.");
  if (session.status === "done") throw new ExplainSessionError("This session is finished.");
  const text = input.text.trim().slice(0, MAX_TURN_CHARS);
  const messages = text ? [...session.messages, { role: "student" as const, text }] : session.messages;
  if (!messages.some((m) => m.role === "student")) throw new ExplainSessionError("Write your explanation first.");

  const asked = messages.filter((m) => m.role === "novice").length;
  if (session.kind === "blurt" || input.finish || asked >= MAX_NOVICE_QUESTIONS) return evaluate(session, messages);

  const [{ aiEfficiencyMode: efficient, preferredLanguage }, ref] = await Promise.all([getAppSettings(), referenceFor(session)]);
  const question = (
    await generateText({
      system: noviceSystemPrompt(ref, languageName(preferredLanguage), asked + 1, MAX_NOVICE_QUESTIONS),
      user: conversationText(messages),
      maxTokens: 400,
      effort: "low",
      efficient,
    })
  )
    .trim()
    .slice(0, 1000);
  const next = [...messages, { role: "novice" as const, text: question }];
  await saveMessages(session.id, next);
  return { ...session, messages: next };
}
