// Anthropic's and OpenAI's SDKs (used by anthropicApi.ts and
// openaiCompatible.ts, the latter backing both the OpenAI and free/
// OpenRouter backends) already retry transient failures themselves —
// `new Anthropic(...)`/`new OpenAI(...)` default to `maxRetries: 2` with
// their own backoff. The Google GenAI SDK (gemini.ts) has no such option
// at all, so a single rate-limit blip or 5xx fails the whole generation —
// this fills exactly that gap, not a general-purpose retry framework.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export function isRetryableStatus(status: unknown): boolean {
  return typeof status === "number" && RETRYABLE_STATUS_CODES.has(status);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  attempts = 3,
  baseDelayMs = 500
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts - 1 || !isRetryable(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastErr;
}
