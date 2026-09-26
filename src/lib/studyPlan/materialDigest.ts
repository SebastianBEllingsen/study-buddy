import { estimateTokens } from "../chunking";
import { omitEmbeddedImages } from "../embeddedImages";

// A compact outline of the course's documents for the plan-outline call —
// which only needs to know what topics the material covers and what each
// file is called (to match chapters back to documents), not the full text.
// Keeps plan generation to a single call regardless of course size, unlike
// notes/quizzes, which chunk through everything.

export interface DigestDocument {
  filename: string;
  extracted_text: string | null;
}

const MAX_HEADINGS_PER_DOCUMENT = 40;
const OPENING_CHARS = 600;

// Lines that look like headings: markdown headings or numbered sections.
function headingLines(text: string): string[] {
  const headings: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length < 3 || line.length > 90) continue;
    const isMarkdownHeading = /^#{1,4}\s+\S/.test(line);
    // "2.3 Eigenvalues", "IV. Results", or a word-then-number label in any
    // language ("Chapter 3 …", "Week 5: …").
    const isNumbered = /^(\d+(\.\d+){0,3}\.?|[IVX]+\.|\p{L}{3,12}\s+\d+[.:]?)\s+\S/u.test(line);
    if (isMarkdownHeading || isNumbered) {
      headings.push(line.replace(/^#{1,4}\s+/, ""));
      if (headings.length >= MAX_HEADINGS_PER_DOCUMENT) break;
    }
  }
  return headings;
}

function documentDigest(doc: DigestDocument, openingChars: number): string {
  const text = omitEmbeddedImages(doc.extracted_text ?? "");
  const headings = headingLines(text);
  const opening = text.replace(/\s+/g, " ").trim().slice(0, openingChars);
  return [
    `--- Document: ${doc.filename} ---`,
    headings.length ? `Headings:\n${headings.map((h) => `- ${h}`).join("\n")}` : null,
    opening ? `Opening: ${opening}${text.length > openingChars ? "…" : ""}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// Shrinks the per-document opening excerpt until everything fits the token
// budget; past that, later documents are listed by filename only.
export function buildMaterialDigest(documents: DigestDocument[], budgetTokens = 30_000): string {
  if (documents.length === 0) return "";
  for (const openingChars of [OPENING_CHARS, 300, 120, 0]) {
    const digest = documents.map((d) => documentDigest(d, openingChars)).join("\n\n");
    if (estimateTokens(digest) <= budgetTokens) return digest;
  }
  const parts: string[] = [];
  let used = 0;
  for (const doc of documents) {
    const part = documentDigest(doc, 0);
    const cost = estimateTokens(part);
    parts.push(used + cost <= budgetTokens ? part : `--- Document: ${doc.filename} ---`);
    used += Math.min(cost, estimateTokens(parts[parts.length - 1]));
  }
  return parts.join("\n\n");
}
