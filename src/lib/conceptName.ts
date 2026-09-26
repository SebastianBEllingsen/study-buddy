// A concept name as stored on a card/question (`concept`) and in the
// concepts table: trimmed, single-spaced, at most MAX_CONCEPT_NAME_LENGTH
// characters. Anything that isn't a usable name becomes undefined.
export const MAX_CONCEPT_NAME_LENGTH = 80;

export function cleanConceptName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_CONCEPT_NAME_LENGTH).trim();
  return name || undefined;
}

// Concept names match case-insensitively ("Hash tables" == "hash tables").
export function conceptKey(name: string): string {
  return name.toLowerCase();
}
