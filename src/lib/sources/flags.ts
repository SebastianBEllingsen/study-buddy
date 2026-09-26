import { sanitizeFlashcardsContent, sanitizeQuizContent } from "../mathSanitizer";
import type { Checked, Flashcard, FlashcardsContent, ItemFlag, QuizContent, QuizQuestion } from "../types";
import { MAX_ISSUE_CHARS } from "./itemMeta";

// Pure edits to a flashcard deck's or quiz's content for flagged items:
// reporting one wrong, and resolving a flag by keeping, replacing or
// removing the item. The database side is in flagStore.ts.

export type FlaggableMode = "flashcards" | "quiz";
export type FlaggableContent = FlashcardsContent | QuizContent;
export type FlaggableEntry = Flashcard | QuizQuestion;

export class FlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlagError";
  }
}

export function entriesOf(mode: FlaggableMode, content: FlaggableContent): FlaggableEntry[] {
  return mode === "flashcards" ? (content as FlashcardsContent).cards : (content as QuizContent).questions;
}

function withEntries(mode: FlaggableMode, content: FlaggableContent, entries: FlaggableEntry[]): FlaggableContent {
  return mode === "flashcards"
    ? { ...(content as FlashcardsContent), cards: entries as Flashcard[] }
    : { ...(content as QuizContent), questions: entries as QuizQuestion[] };
}

function entryAt(mode: FlaggableMode, content: FlaggableContent, index: number): FlaggableEntry {
  const entry = Number.isInteger(index) ? entriesOf(mode, content)[index] : undefined;
  if (!entry) throw new FlagError(mode === "flashcards" ? "That card no longer exists." : "That question no longer exists.");
  return entry;
}

function mapAt(
  mode: FlaggableMode,
  content: FlaggableContent,
  index: number,
  fn: (entry: FlaggableEntry) => FlaggableEntry
): FlaggableContent {
  entryAt(mode, content, index);
  return withEntries(
    mode,
    content,
    entriesOf(mode, content).map((e, i) => (i === index ? fn(e) : e))
  );
}

function withoutFlag<T extends Checked>(entry: T): T {
  const rest = { ...entry };
  delete rest.flag;
  return rest;
}

// The student's "This is wrong": holds the item out of review with their
// note (or a generic one). Replaces a check flag — the student's word wins.
export function reportEntry(
  mode: FlaggableMode,
  content: FlaggableContent,
  index: number,
  issue: string,
  at: string
): FlaggableContent {
  const flag: ItemFlag = {
    by: "student",
    issue: issue.trim().slice(0, MAX_ISSUE_CHARS) || "Reported as wrong during review.",
    at,
  };
  return mapAt(mode, content, index, (e) => ({ ...e, flag }));
}

// "It's correct": clears the flag and returns the item to review.
export function keepEntry(mode: FlaggableMode, content: FlaggableContent, index: number): FlaggableContent {
  return mapAt(mode, content, index, withoutFlag);
}

export function removeEntry(mode: FlaggableMode, content: FlaggableContent, index: number): FlaggableContent {
  entryAt(mode, content, index);
  return withEntries(
    mode,
    content,
    entriesOf(mode, content).filter((_, i) => i !== index)
  );
}

// Validates a corrected card/question (from the edit form or the AI's
// suggestion) and cleans it the same way generation does. Throws FlagError
// on a malformed one.
export function cleanEntry(mode: FlaggableMode, entry: unknown): FlaggableEntry {
  try {
    if (mode === "flashcards") {
      const card = entry as Flashcard;
      if (!card || typeof card.front !== "string" || typeof card.back !== "string" || !card.front.trim() || !card.back.trim()) {
        throw new FlagError("A card needs a front and a back.");
      }
      return sanitizeFlashcardsContent({ cards: [{ front: card.front, back: card.back, concept: card.concept }] }).cards[0];
    }
    const [question] = sanitizeQuizContent({ questions: [entry as QuizQuestion] }).questions;
    if (!question.question.trim()) throw new FlagError("A question needs its text.");
    return question;
  } catch (err) {
    if (err instanceof FlagError) throw err;
    throw new FlagError(mode === "flashcards" ? "That card isn't complete." : "That question isn't complete.");
  }
}

// Swaps in a corrected version: keeps the original's source (and concept,
// unless the correction names one) and clears the flag. A deck card keeps
// any media it had.
export function replaceEntry(
  mode: FlaggableMode,
  content: FlaggableContent,
  index: number,
  corrected: unknown
): FlaggableContent {
  const next = cleanEntry(mode, corrected);
  return mapAt(mode, content, index, (old) => {
    const { source, concept } = old;
    const card = old as Flashcard;
    const media =
      mode === "flashcards"
        ? { ...(card.frontMedia && { frontMedia: card.frontMedia }), ...(card.backMedia && { backMedia: card.backMedia }) }
        : {};
    const keptConcept = next.concept ?? concept;
    return {
      ...next,
      ...media,
      ...(keptConcept && { concept: keptConcept }),
      ...(source && { source }),
    } as FlaggableEntry;
  });
}

export interface FlaggedEntry {
  index: number;
  entry: FlaggableEntry;
  flag: ItemFlag;
}

export function flaggedEntries(mode: FlaggableMode, content: FlaggableContent): FlaggedEntry[] {
  return entriesOf(mode, content).flatMap((entry, index) => (entry.flag ? [{ index, entry, flag: entry.flag }] : []));
}
