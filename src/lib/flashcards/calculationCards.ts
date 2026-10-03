import type { Flashcard } from "../types";

// Cards that ask for a calculation instead of an idea to remember — the
// kind the card prompt now avoids (prompts/flashcards.ts, CARD_SCOPE_RULE).
// A heuristic on the front's wording, so the student confirms what to
// remove; it never deletes anything itself.

const TASK_VERB =
  /^(calculate|compute|solve|evaluate|simplify|derive|differentiate|integrate|expand|factori[sz]e|prove|show that|find the (value|derivative|integral|sum|limit|product|roots?|solution|result|area|volume|probability|expected|mean|variance)|determine the (value|result|solution)|what is the value of|how much is)\b/i;
// "3 × 4 = ?", "12/4 = ?"
const BARE_ARITHMETIC = /^[\s\d.,+\-−×÷*/^()=?$\\a-z{}]{0,40}=\s*\?\s*$/i;

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeCalculation(card: Pick<Flashcard, "front">): boolean {
  const front = plainText(card.front);
  return TASK_VERB.test(front) || BARE_ARITHMETIC.test(front);
}

// Indices (into `cards`) of the cards that look like calculations.
export function calculationCardIndices(cards: Pick<Flashcard, "front">[]): number[] {
  return cards.flatMap((c, i) => (looksLikeCalculation(c) ? [i] : []));
}
