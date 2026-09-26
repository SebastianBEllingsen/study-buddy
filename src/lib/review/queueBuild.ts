import type { Flashcard, FlashcardsContent, QuizContent, QuizQuestion, SourceRef } from "../types";
import type { ReviewItemKind } from "./types";

// Pure and client-safe (the review page imports the entry types); loading
// from the database lives in queue.ts.

// The review_items columns the queue reads.
export interface QueueReview {
  kind: ReviewItemKind;
  item_index: number;
  due_at: string;
}

function toUtcText(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// The review session's queue: everything due across courses — cards and
// quiz questions whose FSRS due date has come, plus a daily allowance of
// never-seen cards — interleaved so consecutive items come from different
// sets (mixing topics beats blocking one topic at a time).
//
// Quiz questions join the queue once they've been answered for the first
// time (in a quiz or here); cards join as soon as their deck exists, unless
// the deck has reminders turned off. Flagged items (see ItemFlag) are held
// out until the flag is resolved.

// A question as the learner sees it before answering: no answer key.
export type QueueQuestion =
  | { type: "mcq"; question: string; options: string[] }
  | { type: "multi_select"; question: string; options: string[]; answerCount: number }
  | { type: "short_answer"; question: string };

interface QueueEntryBase {
  key: string;
  itemId: number;
  itemTitle: string;
  courseId: number;
  courseName: string;
  index: number;
  concept: string | null;
  // The document or note it was generated from, for the "Source" link.
  source?: SourceRef;
  isNew: boolean;
  dueAt: string | null;
}

export type QueueEntry =
  | (QueueEntryBase & { kind: "card"; card: Flashcard })
  | (QueueEntryBase & { kind: "question"; question: QueueQuestion });

export interface QueueSource {
  itemId: number;
  itemTitle: string;
  courseId: number;
  courseName: string;
  mode: "flashcards" | "quiz";
  content: FlashcardsContent | QuizContent;
  reviews: QueueReview[];
}

export interface QueueCounts {
  dueCards: number;
  dueQuestions: number;
  newCards: number;
}

export function questionForQueue(q: QuizQuestion): QueueQuestion {
  if (q.type === "mcq") return { type: "mcq", question: q.question, options: q.options };
  if (q.type === "multi_select") {
    return { type: "multi_select", question: q.question, options: q.options, answerCount: q.correctIndices.length };
  }
  return { type: "short_answer", question: q.question };
}

// Round-robin across groups, each group keeping its own order.
export function interleave<T>(groups: T[][]): T[] {
  const out: T[] = [];
  const queues = groups.filter((g) => g.length > 0).map((g) => [...g]);
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next !== undefined) out.push(next);
    }
  }
  return out;
}

// Pure: builds the queue from loaded sources. `newCardAllowance` is how
// many never-seen cards may still be introduced today.
export function buildQueue(
  sources: QueueSource[],
  options: { now: Date; newCardAllowance: number; limit: number }
): { entries: QueueEntry[]; counts: QueueCounts } {
  const nowText = toUtcText(options.now);
  const counts: QueueCounts = { dueCards: 0, dueQuestions: 0, newCards: 0 };
  const dueGroups: { oldest: string; entries: QueueEntry[] }[] = [];
  const newGroups: QueueEntry[][] = [];

  for (const source of sources) {
    const base = {
      itemId: source.itemId,
      itemTitle: source.itemTitle,
      courseId: source.courseId,
      courseName: source.courseName,
    };
    const byIndex = new Map<string, QueueReview>(source.reviews.map((r) => [`${r.kind}:${r.item_index}`, r]));
    const due: QueueEntry[] = [];
    const fresh: QueueEntry[] = [];
    const entryKey = (kind: ReviewItemKind, index: number) => `${source.itemId}:${kind}:${index}`;

    if (source.mode === "flashcards") {
      const content = source.content as FlashcardsContent;
      if (content.reminders === false) continue;
      content.cards.forEach((card, index) => {
        if (card.flag) return;
        const review = byIndex.get(`card:${index}`);
        const entry = {
          ...base,
          key: entryKey("card", index),
          kind: "card" as const,
          index,
          card,
          concept: card.concept ?? null,
          ...(card.source && { source: card.source }),
          isNew: !review,
          dueAt: review?.due_at ?? null,
        };
        if (!review) fresh.push(entry);
        else if (review.due_at <= nowText) due.push(entry);
      });
    } else {
      const content = source.content as QuizContent;
      content.questions.forEach((question, index) => {
        const review = byIndex.get(`question:${index}`);
        if (question.flag || !review || review.due_at > nowText) return;
        due.push({
          ...base,
          key: entryKey("question", index),
          kind: "question",
          index,
          question: questionForQueue(question),
          concept: question.concept ?? null,
          ...(question.source && { source: question.source }),
          isNew: false,
          dueAt: review.due_at,
        });
      });
    }

    due.sort((a, b) => (a.dueAt as string).localeCompare(b.dueAt as string));
    for (const e of due) {
      if (e.kind === "card") counts.dueCards++;
      else counts.dueQuestions++;
    }
    if (due.length) dueGroups.push({ oldest: due[0].dueAt as string, entries: due });
    if (fresh.length) newGroups.push(fresh);
  }

  // Most overdue sets lead each round.
  dueGroups.sort((a, b) => a.oldest.localeCompare(b.oldest));
  const allowance = Math.max(0, options.newCardAllowance);
  const newEntries = interleave(newGroups).slice(0, allowance);
  counts.newCards = newEntries.length;

  // New cards are spread through the due reviews rather than saved for
  // the end, so a long backlog doesn't starve them.
  const dueEntries = interleave(dueGroups.map((g) => g.entries));
  const entries: QueueEntry[] = [];
  const every = newEntries.length ? Math.max(1, Math.floor(dueEntries.length / newEntries.length)) : 0;
  let n = 0;
  dueEntries.forEach((e, i) => {
    entries.push(e);
    if (every && (i + 1) % every === 0 && n < newEntries.length) entries.push(newEntries[n++]);
  });
  entries.push(...newEntries.slice(n));
  return { entries: entries.slice(0, Math.max(0, options.limit)), counts };
}


// A focused session over specific cards/questions — the mistake log's, or
// one concept's — whether due or not. `keys` ("itemId:kind:index") give the
// order; anything that no longer exists is skipped.
export function buildFocusQueue(sources: QueueSource[], keys: string[], limit: number): QueueEntry[] {
  const byItem = new Map(sources.map((s) => [s.itemId, s]));
  const seen = new Set<string>();
  const entries: QueueEntry[] = [];
  for (const key of keys) {
    if (seen.has(key) || entries.length >= limit) continue;
    seen.add(key);
    const [itemId, kind, index] = key.split(":");
    const source = byItem.get(Number(itemId));
    const i = Number(index);
    if (!source || !Number.isInteger(i)) continue;
    const review = source.reviews.find((r) => r.kind === kind && r.item_index === i);
    const base = {
      key,
      itemId: source.itemId,
      itemTitle: source.itemTitle,
      courseId: source.courseId,
      courseName: source.courseName,
      index: i,
      isNew: !review,
      dueAt: review?.due_at ?? null,
    };
    if (kind === "card" && source.mode === "flashcards") {
      const card = (source.content as FlashcardsContent).cards[i];
      if (card && !card.flag) {
        entries.push({ ...base, kind: "card", card, concept: card.concept ?? null, ...(card.source && { source: card.source }) });
      }
    } else if (kind === "question" && source.mode === "quiz") {
      const question = (source.content as QuizContent).questions[i];
      if (question && !question.flag) {
        entries.push({
          ...base,
          kind: "question",
          question: questionForQueue(question),
          concept: question.concept ?? null,
          ...(question.source && { source: question.source }),
        });
      }
    }
  }
  return entries;
}

// Every card/question tagged with `conceptKey` (lowercased), least
// recently reviewed first (never-reviewed ones first of all).
export function conceptKeys(sources: QueueSource[], conceptKey: string): string[] {
  const found: { key: string; last: string }[] = [];
  for (const source of sources) {
    const kind: ReviewItemKind = source.mode === "flashcards" ? "card" : "question";
    // Flagged items (held out of review) never match.
    const concepts =
      source.mode === "flashcards"
        ? (source.content as FlashcardsContent).cards.map((c) => (c.flag ? undefined : c.concept))
        : (source.content as QuizContent).questions.map((q) => (q.flag ? undefined : q.concept));
    concepts.forEach((name, index) => {
      if (name?.trim().toLowerCase() !== conceptKey) return;
      const review = source.reviews.find((r) => r.kind === kind && r.item_index === index);
      found.push({ key: `${source.itemId}:${kind}:${index}`, last: review?.due_at ?? "" });
    });
  }
  return found.sort((a, b) => a.last.localeCompare(b.last)).map((f) => f.key);
}
