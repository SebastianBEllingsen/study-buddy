import { conceptKey, cleanConceptName } from "../conceptName";
import { isDue, retrievability, type MemoryState } from "../fsrs";
import type { FlashcardsContent, QuizContent } from "../types";
import type { ReviewItemKind } from "./types";

// A course's knowledge by concept: for every concept its cards and
// questions are tagged with, how much of it the learner would recall right
// now (mean FSRS retrievability, counting never-reviewed items as 0), how
// much of it has been reviewed at all, what's due, and open mistakes.

export interface KnowledgeSource {
  mode: string;
  content: FlashcardsContent | QuizContent;
  reviews: (MemoryState & { kind: ReviewItemKind; item_index: number })[];
}

export interface ConceptKnowledge {
  name: string;
  chapterId: number | null;
  items: number;
  reviewed: number;
  due: number;
  recall: number;
  openMistakes: number;
}

export interface KnowledgeSummary {
  concepts: ConceptKnowledge[];
  untagged: number;
}

export function summarizeKnowledge(
  sources: KnowledgeSource[],
  options: {
    now: Date;
    chapterByConcept: Map<string, number | null>;
    openMistakesByConcept: Map<string, number>;
  }
): KnowledgeSummary {
  const byKey = new Map<string, ConceptKnowledge & { recallSum: number }>();
  let untagged = 0;

  for (const source of sources) {
    const kind: ReviewItemKind = source.mode === "flashcards" ? "card" : "question";
    const entries =
      source.mode === "flashcards"
        ? (source.content as FlashcardsContent).cards.map((c) => c.concept)
        : (source.content as QuizContent).questions.map((q) => q.concept);
    const reviews = new Map(source.reviews.filter((r) => r.kind === kind).map((r) => [r.item_index, r]));

    entries.forEach((rawName, index) => {
      const name = cleanConceptName(rawName);
      if (!name) {
        untagged++;
        return;
      }
      const key = conceptKey(name);
      const entry =
        byKey.get(key) ??
        ({
          name,
          chapterId: options.chapterByConcept.get(key) ?? null,
          items: 0,
          reviewed: 0,
          due: 0,
          recall: 0,
          recallSum: 0,
          openMistakes: options.openMistakesByConcept.get(key) ?? 0,
        } satisfies ConceptKnowledge & { recallSum: number });
      byKey.set(key, entry);
      entry.items++;
      const review = reviews.get(index);
      if (review) {
        entry.reviewed++;
        entry.recallSum += retrievability(review, options.now);
        if (isDue(review, options.now)) entry.due++;
      }
    });
  }

  const concepts = [...byKey.values()]
    .map(({ recallSum, ...c }) => ({ ...c, recall: c.items ? recallSum / c.items : 0 }))
    // Weakest first: that's where to spend time.
    .sort((a, b) => a.recall - b.recall || b.openMistakes - a.openMistakes || a.name.localeCompare(b.name));
  return { concepts, untagged };
}
