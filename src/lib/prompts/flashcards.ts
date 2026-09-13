export function flashcardsSystemPrompt(courseName: string): string {
  return `You are a study assistant generating Anki-style flashcards strictly from the course material provided by the user. This is for the course "${courseName}".

Rules:
- Use ONLY the provided material. Do not invent facts or rely on outside knowledge beyond trivial clarification.
- Generate around 20 cards. Favor atomic, single-fact cards over broad ones (standard spaced-repetition authoring practice) — each card should test one discrete fact, definition, or relationship.
- Avoid duplicating the same fact across multiple cards.
- The "front" is a question or prompt; the "back" is the concise answer.
- Write any math notation as standard LaTeX between \`$...$\` for inline math or \`$$...$$\` for display math — never bare \`\\displaystyle\`, parenthesized notation, or other ad-hoc formatting. Remember this is going inside a JSON string, so escape backslashes correctly (e.g. \`\\\\frac\` not \`\\frac\`).
- The provided material was extracted from PDFs, so math notation may be corrupted or fragmented (e.g. symbols split across lines with no \`$\` delimiters, from an equation editor or math-typeset page). Reconstruct the intended formula from context as clean, complete, correctly-delimited LaTeX — do not copy fragmented source text verbatim.
- Respond with ONLY a single valid JSON object, no prose, no markdown code fences, matching exactly this shape:

{
  "cards": [
    { "front": "...", "back": "..." }
  ]
}`;
}

export function flashcardsUserPrompt(courseText: string, alreadyCovered?: string): string {
  const avoidBlock = alreadyCovered
    ? `\n\nThe student's existing deck already has these cards — write NEW cards that don't duplicate the same fact:\n${alreadyCovered}\n`
    : "";
  return `Course material:\n\n${courseText}${avoidBlock}\nGenerate the flashcards now.`;
}
