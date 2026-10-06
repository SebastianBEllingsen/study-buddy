import { generateText } from "./aiClient";
import { stripEmbeddedImages, restoreEmbeddedImages } from "./embeddedImages";
import { chunkText, estimateTokens } from "./chunking";

// Same ~4-chars-per-token estimate used everywhere else in this app
// (chunking.ts) — an earlier version of this file used chars/2 instead,
// over-asking for roughly 2x the tokens actually needed, with no ceiling at
// all. Capped at MAX_TIDY_TOKENS below (matching generate.ts's own
// MAX_TOKENS) since every backend has some real output-token ceiling — a
// large paste (200k+ characters) previously computed a maxTokens value that
// exceeded every supported model's actual output cap, so the very first
// "Make pretty" request on it was rejected outright by the provider rather
// than degrading gracefully.
const MIN_TIDY_TOKENS = 2000;
const MAX_TIDY_TOKENS = 8000;
// The cleaned text is about as long as the input, plus Markdown syntax — the
// output limit needs room beyond the input's own size or the end gets cut off.
const TIDY_OUTPUT_HEADROOM = 1.3;
// A paste longer than this is cleaned in pieces: its cleaned text would not
// fit in one reply (MAX_TIDY_TOKENS) and the end would silently be lost.
const TIDY_CHUNK_TOKENS = 4000;

const TIDY_SYSTEM_PROMPT = `You clean up messy pasted text for a student's study material — often a raw Ctrl+A dump of an entire webpage (an LMS/portal assignment page, a course site, an article), but also a lecture transcript or set of notes copied out of a PDF or slide deck.

First, find the actual substantive content — the assignment brief, lecture notes, article body, or similar — and DISCARD everything else: navigation menus, search boxes, breadcrumbs, sidebars ("Related", "Course navigation"), login/session banners, cookie/privacy notices, "system notification" toasts, comment sections, footers, and any other page furniture that isn't part of the content itself.

Then, within what you kept:
- Fix broken line breaks and stray whitespace from copy-paste (including hyphenated words split across a line wrap).
- Fix obvious OCR/typo noise, only where the intended word is unambiguous.
- Reformat into clean Markdown — headings, lists, emphasis — only where the content's own structure actually calls for it. Do not invent structure that isn't there.

Preserve every fact, instruction, and number from the substantive content exactly — do not summarize, shorten, paraphrase, or editorialize. It's fine, and expected, for the result to be much shorter than the input once page chrome is gone — a page that's 90% navigation/footer should end up as just the 10% that mattered.

The text may contain placeholder tokens like [[IMAGE_0]] marking an embedded picture — leave every such token exactly as it is, in its original position; never alter, remove, describe, or comment on it. If one appears to sit inside chrome you'd otherwise discard, keep it anyway rather than risk losing a real embedded image.

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
//
// The floor is deliberately low (rather than symmetric with the ceiling):
// tidying now actively discards page chrome instead of just reformatting,
// and a raw Ctrl+A page dump can legitimately be 90%+ navigation/footer/
// boilerplate — a correct extraction can be a small fraction of the input's
// length. It still exists purely to catch a genuinely empty/near-empty
// response, not to second-guess how much got discarded.
const MIN_TIDY_RATIO = 0.05;
const MAX_TIDY_RATIO = 3;

const TIDY_ATTEMPTS = 2;

// One model call over `input`, retried once when the result looks broken.
// `allowEmpty`: a piece of a big paste can be nothing but page furniture, so
// there an empty result is fine (the whole is checked afterwards).
async function tidyPiece(input: string, allowEmpty: boolean): Promise<string | null> {
  const inputLength = input.trim().length;
  for (let attempt = 0; attempt < TIDY_ATTEMPTS; attempt++) {
    const cleaned = await generateText({
      system: TIDY_SYSTEM_PROMPT,
      user: input,
      maxTokens: Math.min(
        MAX_TIDY_TOKENS,
        Math.max(MIN_TIDY_TOKENS, Math.ceil(estimateTokens(input) * TIDY_OUTPUT_HEADROOM))
      ),
      effort: "low",
    });
    const trimmed = cleaned.trim();

    if (
      inputLength &&
      ((!allowEmpty && trimmed.length < inputLength * MIN_TIDY_RATIO) || trimmed.length > inputLength * MAX_TIDY_RATIO)
    ) {
      continue; // Retry once, silently — see MIN/MAX_TIDY_RATIO's comment.
    }
    return trimmed;
  }
  return null;
}

const BROKEN_RESULT_MESSAGE =
  "Tidying returned a broken result twice in a row, so your original text was left unchanged — try again, or check the AI backend in Settings.";

export async function tidyPastedText(text: string): Promise<string> {
  // Embedded images (see the "Paste text" dialog's image support) are data
  // URLs — huge, and not something an AI text call needs to see — swapped
  // for lightweight placeholders here and put back afterward rather than
  // sent to the model.
  const { text: stripped, images } = stripEmbeddedImages(text);
  const inputLength = stripped.trim().length;

  const pieces = estimateTokens(stripped) > TIDY_CHUNK_TOKENS ? chunkText(stripped, TIDY_CHUNK_TOKENS) : [stripped];
  const cleaned: string[] = [];
  for (const piece of pieces) {
    const result = await tidyPiece(piece, pieces.length > 1);
    if (result === null) throw new Error(BROKEN_RESULT_MESSAGE);
    if (result) cleaned.push(result);
  }
  const joined = cleaned.join("\n\n");
  // For a paste cleaned in pieces, the floor applies to the whole.
  if (pieces.length > 1 && inputLength && joined.length < inputLength * MIN_TIDY_RATIO) {
    throw new Error(BROKEN_RESULT_MESSAGE);
  }
  return restoreEmbeddedImages(joined, images);
}
