import {
  RESOURCE_KINDS,
  type PlanOutline,
  type PlanOutlineChapter,
  type ResourceKind,
  type ResourceSuggestion,
} from "./studyPlan/types";

// Every AI backend (src/lib/aiBackends/*) already retries once if a
// response isn't valid JSON, but none of them check that the *parsed*
// object actually has the shape the caller asked for — a syntactically
// valid but wrong-shaped response (e.g. `{}` instead of `{questions: [...]}`)
// sails through the `as T` cast untouched and previously only failed later,
// deep inside mathSanitizer.ts, as an opaque "Cannot read properties of
// undefined (reading 'map')" TypeError. These checks catch that right after
// generation instead, with a message that actually says what went wrong.
export class InvalidAiResponseError extends Error {
  constructor(detail: string) {
    super(`The AI's response wasn't in the expected format (${detail}) — try generating again.`);
    this.name = "InvalidAiResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function assertQuizContentShape(content: unknown): void {
  if (!isRecord(content) || !Array.isArray(content.questions)) {
    throw new InvalidAiResponseError("missing a \"questions\" array");
  }
  for (const q of content.questions) {
    if (!isRecord(q) || typeof q.question !== "string" || typeof q.explanation !== "string") {
      throw new InvalidAiResponseError("a quiz question is missing required fields");
    }
    if (q.type === "mcq" || q.type === "multi_select") {
      if (!Array.isArray(q.options)) {
        throw new InvalidAiResponseError("a multiple-choice question is missing its options");
      }
      // Captured into a local rather than relying on q.options staying
      // narrowed to `unknown[]` inside the .every() closure below — TS
      // doesn't preserve property-access narrowing across a nested function
      // boundary, since it can't guarantee the property wasn't reassigned.
      const options: unknown[] = q.options;
      // Previously unchecked: an out-of-range/missing correctIndex or
      // correctIndices entry reached the client as-is (e.g. attempt/route.ts's
      // `q.options[q.correctIndex]`), producing `correctAnswer: undefined`
      // that got stored in answers_json and shown to the student as "the
      // correct answer" — silently wrong rather than a caught, regenerable error.
      if (q.type === "mcq" && !(Number.isInteger(q.correctIndex) && (q.correctIndex as number) in options)) {
        throw new InvalidAiResponseError("a multiple-choice question's correct answer is out of range");
      }
      if (q.type === "multi_select") {
        if (!Array.isArray(q.correctIndices)) {
          throw new InvalidAiResponseError("a multi-select question is missing its correct answers");
        }
        if (!q.correctIndices.every((i: unknown) => Number.isInteger(i) && (i as number) in options)) {
          throw new InvalidAiResponseError("a multi-select question's correct answers are out of range");
        }
      }
    }
    if (q.type === "short_answer" && typeof q.modelAnswer !== "string") {
      throw new InvalidAiResponseError("a short-answer question is missing its model answer");
    }
  }
}

export function assertFlashcardsContentShape(content: unknown): void {
  if (!isRecord(content) || !Array.isArray(content.cards)) {
    throw new InvalidAiResponseError("missing a \"cards\" array");
  }
  for (const c of content.cards) {
    if (!isRecord(c) || typeof c.front !== "string" || typeof c.back !== "string") {
      throw new InvalidAiResponseError("a flashcard is missing its front/back text");
    }
  }
}

export function assertGradingResultShape(content: unknown, expectedCount: number): void {
  if (!isRecord(content) || !Array.isArray(content.results)) {
    throw new InvalidAiResponseError("missing a \"results\" array");
  }
  if (content.results.length !== expectedCount) {
    throw new InvalidAiResponseError(
      `expected ${expectedCount} graded result(s), got ${content.results.length}`
    );
  }
  for (const r of content.results) {
    if (
      !isRecord(r) ||
      !["correct", "partial", "incorrect"].includes(r.verdict as string) ||
      typeof r.feedback !== "string"
    ) {
      throw new InvalidAiResponseError("a graded result is missing its verdict/feedback");
    }
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())
    : [];
}

// A study-plan outline (prompts/studyPlan.ts). Structural problems (no
// chapters, a chapter without a title) throw; everything optional is
// coerced to a safe default rather than failing the whole plan over it.
export function normalizeStudyPlanOutline(content: unknown): PlanOutline {
  if (!isRecord(content) || !Array.isArray(content.chapters) || content.chapters.length === 0) {
    throw new InvalidAiResponseError("missing a \"chapters\" array");
  }
  const chapters: PlanOutlineChapter[] = content.chapters.map((c) => {
    if (!isRecord(c) || typeof c.title !== "string" || !c.title.trim()) {
      throw new InvalidAiResponseError("a chapter is missing its title");
    }
    return {
      title: c.title.trim(),
      summary: typeof c.summary === "string" ? c.summary.trim() : "",
      subtopics: stringList(c.subtopics),
      prerequisites: Array.isArray(c.prerequisites)
        ? c.prerequisites.filter((p): p is number => Number.isInteger(p))
        : [],
      stage: Number.isInteger(c.stage) ? (c.stage as number) : 1,
      // Clamped to something sane: 10 minutes to 200 hours.
      estimatedMinutes:
        typeof c.estimatedMinutes === "number" && Number.isFinite(c.estimatedMinutes) && c.estimatedMinutes > 0
          ? Math.min(12_000, Math.max(10, Math.round(c.estimatedMinutes)))
          : null,
      matchedDocuments: stringList(c.matchedDocuments),
    };
  });
  return {
    title: typeof content.title === "string" && content.title.trim() ? content.title.trim() : "Study plan",
    chapters,
  };
}

// One chapter's resource suggestions. Malformed entries are dropped rather
// than failing the chapter — a single bad suggestion shouldn't cost the good
// ones — but a response with no resources array at all throws.
export function normalizeResourceSuggestions(content: unknown): ResourceSuggestion[] {
  if (!isRecord(content) || !Array.isArray(content.resources)) {
    throw new InvalidAiResponseError("missing a \"resources\" array");
  }
  const suggestions: ResourceSuggestion[] = [];
  for (const r of content.resources) {
    if (!isRecord(r) || typeof r.url !== "string" || typeof r.title !== "string" || !r.title.trim()) continue;
    const kind = (RESOURCE_KINDS as readonly unknown[]).includes(r.kind) ? (r.kind as ResourceKind) : "article";
    suggestions.push({
      kind,
      title: r.title.trim(),
      url: r.url.trim(),
      provider: typeof r.provider === "string" && r.provider.trim() ? r.provider.trim() : undefined,
      language: typeof r.language === "string" && r.language.trim() ? r.language.trim().toLowerCase() : undefined,
      note: typeof r.note === "string" ? r.note.trim() : "",
    });
  }
  return suggestions;
}

export interface StudyPlanSupplement {
  updates: { chapter: number; newSubtopics: string[]; matchedDocuments: string[] }[];
  newChapters: (Omit<PlanOutlineChapter, "stage">)[];
}

// The "fold in new material" response (prompts/studyPlan.ts). Both lists
// may legitimately be empty (the new documents fit nowhere); anything
// malformed inside them is dropped rather than failing the update.
export function normalizeStudyPlanSupplement(content: unknown): StudyPlanSupplement {
  if (!isRecord(content) || (!Array.isArray(content.updates) && !Array.isArray(content.newChapters))) {
    throw new InvalidAiResponseError("missing \"updates\" and \"newChapters\"");
  }
  const updates = (Array.isArray(content.updates) ? content.updates : [])
    .filter((u): u is Record<string, unknown> => isRecord(u) && Number.isInteger(u.chapter))
    .map((u) => ({
      chapter: u.chapter as number,
      newSubtopics: stringList(u.newSubtopics),
      matchedDocuments: stringList(u.matchedDocuments),
    }));
  const newChapters = (Array.isArray(content.newChapters) ? content.newChapters : [])
    .filter((c): c is Record<string, unknown> => isRecord(c) && typeof c.title === "string" && c.title.trim() !== "")
    .map((c) => {
      const chapter = normalizeStudyPlanOutline({ chapters: [c] }).chapters[0];
      return {
        title: chapter.title,
        summary: chapter.summary,
        subtopics: chapter.subtopics,
        prerequisites: chapter.prerequisites,
        estimatedMinutes: chapter.estimatedMinutes,
        matchedDocuments: chapter.matchedDocuments,
      };
    });
  return { updates, newChapters };
}

// A replan response: extra review minutes per chapter number, clamped, and
// a short message. Unknown chapter numbers are the caller's to drop.
export function normalizeStudyPlanReplan(content: unknown): {
  adjustments: { chapter: number; extraReviewMinutes: number }[];
  message: string;
} {
  if (!isRecord(content)) throw new InvalidAiResponseError("expected an object");
  const adjustments = (Array.isArray(content.adjustments) ? content.adjustments : [])
    .filter(
      (a): a is Record<string, unknown> =>
        isRecord(a) && Number.isInteger(a.chapter) && typeof a.extraReviewMinutes === "number"
    )
    .map((a) => ({
      chapter: a.chapter as number,
      extraReviewMinutes: Math.min(240, Math.max(0, Math.round(a.extraReviewMinutes as number))),
    }))
    .filter((a) => a.extraReviewMinutes > 0);
  return { adjustments, message: typeof content.message === "string" ? content.message.trim() : "" };
}
