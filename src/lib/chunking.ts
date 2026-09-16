// Rough token estimate (no tokenizer dependency needed for a guardrail check).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Above this, fall back to chunking rather than sending the whole course in
// one call. Leaves plenty of headroom under Sonnet 5's 1M context for output
// + prompt overhead.
export const CHUNK_THRESHOLD_TOKENS = 150_000;

// Character-level fallback for a single paragraph too large to fit in one
// chunk on its own — extracted text with no blank lines at all (some PDF
// exports emit one continuous block with no paragraph breaks) would
// otherwise never split at all and go out over threshold in one call.
function splitOversizedParagraph(paragraph: string, maxTokensPerChunk: number): string[] {
  const maxChars = maxTokensPerChunk * 4;
  const parts: string[] = [];
  for (let i = 0; i < paragraph.length; i += maxChars) {
    parts.push(paragraph.slice(i, i + maxChars));
  }
  return parts;
}

// Simple paragraph-boundary splitter — no embeddings needed for v1, since the
// goal at this size is coverage (get through all the text) not lookup.
export function chunkText(text: string, maxTokensPerChunk = 6000): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const rawParagraph of paragraphs) {
    for (const paragraph of estimateTokens(rawParagraph) > maxTokensPerChunk
      ? splitOversizedParagraph(rawParagraph, maxTokensPerChunk)
      : [rawParagraph]) {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
      if (estimateTokens(candidate) > maxTokensPerChunk && current) {
        chunks.push(current);
        current = paragraph;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);

  return chunks;
}
