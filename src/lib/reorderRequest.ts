// Shared by the five */reorder routes (courses, folders, documents, notes,
// generated items) — each PATCH body carries an `orderedIds` array of
// integer ids in the new order; this is the one bit of validation logic
// that was previously copy-pasted identically into all five.
export function parseOrderedIds(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((id): id is number => Number.isInteger(id))
    ? (value as number[])
    : null;
}
