import { cleanConceptName, conceptKey } from "../conceptName";
import { retrievability, type MemoryState } from "../fsrs";
import type { FlashcardsContent, QuizContent } from "../types";
import type { ReviewItemKind } from "../review/types";

// The readiness forecast: how much of each concept and chapter the learner
// would recall on exam day, projected forward with FSRS's forgetting curve.
// Two numbers, because the future depends on them:
//  - "if you stop now": every item decays from its current state until the exam
//  - "if you keep up": items already learned are held at the target
//    retention by their scheduled reviews; never-learned items still count 0

export interface ForecastSource {
  mode: string;
  content: FlashcardsContent | QuizContent;
  reviews: (MemoryState & { kind: ReviewItemKind; item_index: number })[];
}

export interface ForecastGroup {
  name: string;
  chapterId: number | null;
  items: number;
  reviewed: number;
  ifStopped: number;
  ifKeptUp: number;
}

export interface Forecast {
  examDate: string;
  daysLeft: number;
  overall: { items: number; reviewed: number; ifStopped: number; ifKeptUp: number };
  concepts: ForecastGroup[];
  chapters: ForecastGroup[];
}

export const UNTAGGED = "Untagged";

// The exam is assumed to be at 09:00 local time on its day.
export function examMoment(examDate: string): Date {
  const [y, m, d] = examDate.split("-").map(Number);
  return new Date(y, m - 1, d, 9, 0, 0);
}

export function daysUntil(examDate: string, now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = examDate.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - start.getTime()) / 86_400_000);
}

interface Acc {
  name: string;
  chapterId: number | null;
  items: number;
  reviewed: number;
  stopped: number;
  kept: number;
}

function finish(a: Acc): ForecastGroup {
  return {
    name: a.name,
    chapterId: a.chapterId,
    items: a.items,
    reviewed: a.reviewed,
    ifStopped: a.items ? a.stopped / a.items : 0,
    ifKeptUp: a.items ? a.kept / a.items : 0,
  };
}

export function buildForecast(
  sources: ForecastSource[],
  options: {
    examDate: string;
    now: Date;
    retention: number;
    // concept key → its study plan chapter
    chapterByConcept: Map<string, { id: number; title: string }>;
  }
): Forecast {
  const at = examMoment(options.examDate);
  const concepts = new Map<string, Acc>();
  const chapters = new Map<number, Acc>();
  const overall = { items: 0, reviewed: 0, stopped: 0, kept: 0 };

  for (const source of sources) {
    const kind: ReviewItemKind = source.mode === "flashcards" ? "card" : "question";
    const names =
      source.mode === "flashcards"
        ? (source.content as FlashcardsContent).cards.map((c) => c.concept)
        : (source.content as QuizContent).questions.map((q) => q.concept);
    const reviews = new Map(source.reviews.filter((r) => r.kind === kind).map((r) => [r.item_index, r]));
    names.forEach((raw, index) => {
      const review = reviews.get(index);
      // Quiz questions only count once answered: an unanswered quiz isn't
      // material the learner has met yet in review, just a test they haven't taken.
      if (kind === "question" && !review) return;
      const name = cleanConceptName(raw) ?? UNTAGGED;
      const key = conceptKey(name);
      const stopped = review ? retrievability(review, at) : 0;
      const kept = review ? Math.max(stopped, options.retention) : 0;
      const chapter = options.chapterByConcept.get(key) ?? null;

      const c = concepts.get(key) ?? { name, chapterId: chapter?.id ?? null, items: 0, reviewed: 0, stopped: 0, kept: 0 };
      concepts.set(key, c);
      const groups = [c];
      if (chapter) {
        const ch = chapters.get(chapter.id) ?? { name: chapter.title, chapterId: chapter.id, items: 0, reviewed: 0, stopped: 0, kept: 0 };
        chapters.set(chapter.id, ch);
        groups.push(ch);
      }
      for (const g of [...groups, overall]) {
        g.items++;
        if (review) g.reviewed++;
        g.stopped += stopped;
        g.kept += kept;
      }
    });
  }

  const byWeakest = (a: ForecastGroup, b: ForecastGroup) => a.ifKeptUp - b.ifKeptUp || a.name.localeCompare(b.name);
  return {
    examDate: options.examDate,
    daysLeft: daysUntil(options.examDate, options.now),
    overall: {
      items: overall.items,
      reviewed: overall.reviewed,
      ifStopped: overall.items ? overall.stopped / overall.items : 0,
      ifKeptUp: overall.items ? overall.kept / overall.items : 0,
    },
    concepts: [...concepts.values()].map(finish).sort(byWeakest),
    chapters: [...chapters.values()].map(finish).sort(byWeakest),
  };
}
