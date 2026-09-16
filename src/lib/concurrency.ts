// Runs `fn` over `items` with at most `limit` calls in flight at once —
// unlike Promise.all(items.map(fn)), which fires every call simultaneously.
// A large course can chunk into dozens of pieces (see chunking.ts); an
// unbounded fan-out means that many concurrent AI calls at once, which for
// the CLI backends (claudeCode.ts, codexCli.ts) means that many concurrent
// subprocesses, and for API backends means a much higher chance of hitting
// the provider's rate limit in the first place. (Rejection behavior itself
// is unchanged from a plain Promise.all — the first fn() call to reject
// still fails the whole batch, same as it always would; the difference this
// makes is purely to how many calls are ever in flight at once.)
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  // A `limit` of 0 or negative would otherwise spawn zero workers and
  // silently resolve to an array of holes — every item skipped, none of
  // them ever passed to fn — rather than erroring or falling back to any
  // real concurrency. Clamped to at least 1 (fully sequential) instead.
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
