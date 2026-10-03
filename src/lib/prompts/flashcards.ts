import { CONCEPT_RULE } from "./quiz";
import { SOURCE_NAME_RULE, SOURCE_TRUST_RULE } from "./sources";

// Exported so chunked generation (generate.ts) can distribute this same
// total across chunks instead of asking each chunk for a full 20 — without
// that, a large course split into N chunks would come back with N*20 cards
// instead of 20.
export const TOTAL_CARDS = 20;

// Cards are for things to remember and understand; working things out
// belongs in quizzes and problem sets. Shared with the other prompts that
// write cards.
export const CARD_SCOPE_RULE = `A card tests recall of an idea, never a calculation. Good: definitions, what something does or is for, when to use it, how two ideas relate, why a result holds, what a formula or symbol means, a key property or example to remember. Bad: "calculate", "compute", "solve", "derive", "simplify" or "evaluate" something, or any card that needs pen and paper or a worked solution to answer. A formula may appear on a card as the thing to recognise or explain ("What does this formula compute?"), or as the answer to "What is the formula for X?" when memorising it is the point — never as a task to carry out. Example: "What does a Fourier transform do?" is a good card; "Compute the Fourier transform of e^{-t}u(t)" is not — leave it out, it belongs in a quiz. On math-heavy material, write conceptual cards, not exercises.`;

export function flashcardsSystemPrompt(courseName: string, total: number = TOTAL_CARDS): string {
  return `You are a study assistant generating Anki-style flashcards strictly from the course material provided by the user. This is for the course "${courseName}".

Rules:
- Use ONLY the provided material. Do not invent facts or rely on outside knowledge beyond trivial clarification.
- ${SOURCE_TRUST_RULE}
- Generate around ${total} cards. Favor atomic, single-fact cards over broad ones (standard spaced-repetition authoring practice) — each card should test one discrete fact, definition, or relationship.
- Avoid duplicating the same fact across multiple cards.
- ${CARD_SCOPE_RULE}
- The "front" is a question or prompt; the "back" is the concise answer.
- ${CONCEPT_RULE}
- ${SOURCE_NAME_RULE}
- Write any math notation as standard LaTeX between \`$...$\` for inline math or \`$$...$$\` for display math — never bare \`\\displaystyle\`, parenthesized notation, or other ad-hoc formatting. Remember this is going inside a JSON string, so escape backslashes correctly (e.g. \`\\\\frac\` not \`\\frac\`).
- The provided material was extracted from PDFs, so math notation may be corrupted or fragmented (e.g. symbols split across lines with no \`$\` delimiters, from an equation editor or math-typeset page). Reconstruct the intended formula from context as clean, complete, correctly-delimited LaTeX — do not copy fragmented source text verbatim.
- Respond with ONLY a single valid JSON object, no prose, no markdown code fences, matching exactly this shape:

{
  "cards": [
    { "front": "...", "back": "...", "concept": "...", "source": "..." }
  ]
}`;
}

export function flashcardsUserPrompt(courseText: string, alreadyCovered?: string): string {
  const avoidBlock = alreadyCovered
    ? `\n\nThe student's existing deck already has these cards — write NEW cards that don't duplicate the same fact:\n${alreadyCovered}\n`
    : "";
  return `Course material:\n\n${courseText}${avoidBlock}\nGenerate the flashcards now.`;
}
