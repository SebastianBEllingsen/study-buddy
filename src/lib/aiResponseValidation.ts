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
