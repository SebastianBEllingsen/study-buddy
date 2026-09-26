import type { SourceRef } from "../types";

// Maps the source name a generated card/question gives back to the section
// it came from — exact match first, then case-insensitive. Unknown names
// (or none) resolve to undefined rather than a guess.
export function resolveSourceName(name: unknown, sources: SourceRef[]): SourceRef | undefined {
  if (typeof name !== "string" || !name.trim()) return undefined;
  // Tolerates the model echoing the whole section header back.
  const wanted = name
    .trim()
    .replace(/^-+\s*/, "")
    .replace(/^(document|note):\s*/i, "")
    .replace(/\s*\[[^\]]*\]\s*-*$/, "")
    .trim();
  return (
    sources.find((s) => s.title === wanted) ??
    sources.find((s) => s.title.toLowerCase() === wanted.toLowerCase())
  );
}
