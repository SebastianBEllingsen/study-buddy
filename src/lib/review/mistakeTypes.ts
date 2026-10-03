// What kind of mistake it was — different causes need different fixes, and
// "I keep making slips" is a different problem from "I don't understand this".
// Pure and client-safe.

export const MISTAKE_TYPES = ["slip", "method", "concept", "recall", "misread"] as const;
export type MistakeType = (typeof MISTAKE_TYPES)[number];

export const MISTAKE_TYPE_LABELS: Record<MistakeType, string> = {
  slip: "Careless slip",
  method: "Wrong method",
  concept: "Concept gap",
  recall: "Forgot it",
  misread: "Misread the question",
};

// What the type means, for the model's labelling and for the learner.
export const MISTAKE_TYPE_MEANING: Record<MistakeType, string> = {
  slip: "knew the idea and the method, but made an arithmetic, sign, copying or notation error",
  method: "knew the topic but used the wrong approach, formula or procedure for this problem",
  concept: "misunderstands the underlying idea, definition or why something holds",
  recall: "couldn't remember a fact, definition, formula or name they had studied",
  misread: "answered a different question from the one asked, or overlooked a condition in it",
};

// What to do about it.
export const MISTAKE_TYPE_ADVICE: Record<MistakeType, string> = {
  slip: "Slow down and check your working: these aren't gaps in what you know.",
  method: "Practise choosing the method: mixed problem sets are made for this.",
  concept: "Go back to the idea itself: re-read it, or explain it in your own words.",
  recall: "It needs more spaced repetition: keep reviewing those cards.",
  misread: "Read the question twice and underline what it asks for.",
};

export function parseMistakeType(value: unknown): MistakeType | null {
  return MISTAKE_TYPES.find((t) => t === value) ?? null;
}

export interface MistakeTypeShare {
  type: MistakeType;
  count: number;
  // 0–1 of the mistakes that have a type.
  share: number;
}

// The mix of types among mistakes that have one, most common first.
export function summarizeMistakeTypes(mistakes: { error_type: string | null }[]): MistakeTypeShare[] {
  const counts = new Map<MistakeType, number>();
  for (const m of mistakes) {
    const type = parseMistakeType(m.error_type);
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count, share: count / total }))
    .sort((a, b) => b.count - a.count || MISTAKE_TYPES.indexOf(a.type) - MISTAKE_TYPES.indexOf(b.type));
}
