// Pasted-text documents can embed images inline as standard Markdown image
// syntax with a data URL (see the "Paste text" dialog's image paste/drop
// support in courses/[courseId]/page.tsx) — like Obsidian, the picture
// itself is embedded, not OCR'd to text. Everywhere that text is used for
// something other than rendering it back to the user (AI tidy, AI
// generation context, full-text search indexing) needs to keep those data
// URLs out of the way: they're huge, carry no textual meaning, and would
// otherwise bloat prompts/token counts or the search index with base64
// gibberish.
const EMBEDDED_IMAGE = /!\[[^\]]*\]\((data:image\/[^)]+)\)/g;

// Swaps every embedded image for a numbered placeholder token and returns
// the images so they can be put back later — for a round-trip transform
// (e.g. sending text to an AI tidy pass) where the images must survive
// unchanged and back in their original position.
export function stripEmbeddedImages(text: string): { text: string; images: string[] } {
  const images: string[] = [];
  const stripped = text.replace(EMBEDDED_IMAGE, (_match, dataUrl: string) => {
    images.push(dataUrl);
    return `[[IMAGE_${images.length - 1}]]`;
  });
  return { text: stripped, images };
}

export function restoreEmbeddedImages(text: string, images: string[]): string {
  return text.replace(/\[\[IMAGE_(\d+)\]\]/g, (match, indexStr: string) => {
    const image = images[Number(indexStr)];
    return image ?? match;
  });
}

// For one-way uses (AI generation context, search indexing) where the image
// is simply irrelevant and won't be reassembled — dropped rather than kept
// as a placeholder.
export function omitEmbeddedImages(text: string): string {
  return text.replace(EMBEDDED_IMAGE, "[image]");
}
