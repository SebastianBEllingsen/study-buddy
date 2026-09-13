import { generateText } from "./aiClient";
import { stripEmbeddedImages, restoreEmbeddedImages } from "./embeddedImages";

const TIDY_SYSTEM_PROMPT = `You clean up messy pasted text for a student's study material — the kind of thing that comes from copying an assignment brief, lecture transcript, or set of notes out of a PDF, slide deck, or webpage.

Fix:
- Broken line breaks and stray whitespace from copy-paste (including hyphenated words split across a line wrap).
- Repeated page headers/footers or other copy artifacts.
- Obvious OCR/typo noise, only where the intended word is unambiguous.

Reformat into clean Markdown — headings, lists, emphasis — only where the content's own structure actually calls for it. Do not invent structure that isn't there.

Preserve the original meaning and every fact, instruction, and number exactly. Do not summarize, shorten, add, or remove information, and do not editorialize.

The text may contain placeholder tokens like [[IMAGE_0]] marking an embedded picture — leave every such token exactly as it is, in its original position; never alter, remove, describe, or comment on it.

Respond with ONLY the cleaned text — no commentary, no code fences.`;

// Outside this ratio of the (placeholder-stripped) input's length, a result
// is treated as broken rather than accepted — confirmed empirically against
// the free backend, both directions:
// - Too short: a live "Make pretty" call, with no prompt or input change
//   from one retry to the next, returned "" (an empty string) on one
//   attempt and a faithful cleanup on others.
// - Too long: another attempt returned the model's raw chain-of-thought
//   ("Here's a thinking process: 1. Analyze User Input...") instead of the
//   cleaned text — some reasoning models routed to via OpenRouter's free
//   pool don't reliably strip their own reasoning trace from the response
//   content. This is *longer* than the input, so the too-short check alone
//   doesn't catch it.
// The free-tier model pool is documented elsewhere (aiBackends/free.ts) as
// unpredictable; either failure was silently overwriting the student's
// original pasted text with garbage before this check existed.
const MIN_TIDY_RATIO = 0.3;
const MAX_TIDY_RATIO = 3;

const TIDY_ATTEMPTS = 2;

export async function tidyPastedText(text: string): Promise<string> {
  // Embedded images (see the "Paste text" dialog's image support) are data
  // URLs — huge, and not something an AI text call needs to see — swapped
  // for lightweight placeholders here and put back afterward rather than
  // sent to the model.
  const { text: stripped, images } = stripEmbeddedImages(text);
  const inputLength = stripped.trim().length;

  for (let attempt = 0; attempt < TIDY_ATTEMPTS; attempt++) {
    const cleaned = await generateText({
      system: TIDY_SYSTEM_PROMPT,
      user: stripped,
      maxTokens: Math.max(2000, Math.ceil(stripped.length / 2)),
      effort: "low",
    });
    const trimmed = cleaned.trim();

    if (
      inputLength &&
      (trimmed.length < inputLength * MIN_TIDY_RATIO || trimmed.length > inputLength * MAX_TIDY_RATIO)
    ) {
      continue; // Retry once, silently — see MIN/MAX_TIDY_RATIO's comment.
    }
    return restoreEmbeddedImages(trimmed, images);
  }

  // Every attempt came back broken.
  throw new Error(
    "Tidying returned a broken result twice in a row, so your original text was left unchanged — try again, or check the AI backend in Settings."
  );
}
