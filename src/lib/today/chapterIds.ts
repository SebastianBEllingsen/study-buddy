const MAX_CHAPTER_IDS = 20;

// The `chapters` query parameter of /api/today: "1,2,3", the plan chapters
// picked to study today. Anything that isn't a positive id is dropped.
export function parseChapterIds(raw: string | null): number[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .filter((part) => /^\d+$/.test(part))
    .map(Number)
    .filter((id) => id > 0);
  return [...new Set(ids)].slice(0, MAX_CHAPTER_IDS);
}
