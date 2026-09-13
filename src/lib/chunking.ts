// Rough token estimate (no tokenizer dependency needed for a guardrail check).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Above this, fall back to chunking rather than sending the whole course in
// one call. Leaves plenty of headroom under Sonnet 5's 1M context for output
// + prompt overhead.
export const CHUNK_THRESHOLD_TOKENS = 150_000;

// Simple paragraph-boundary splitter — no embeddings needed for v1, since the
// goal at this size is coverage (get through all the text) not lookup.
export function chunkText(text: string, maxTokensPerChunk = 6000): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (estimateTokens(candidate) > maxTokensPerChunk && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}
