import type { PageSource } from "./render";
import { MAX_PAGES, MAX_PAGES_PER_CALL, type TranscribedPage } from "./types";

// The browser's side of a transcription: render the pages a few at a time,
// send each batch, and collect the results — stopping cleanly when asked.

export class TooManyPagesError extends Error {
  constructor(public pages: number) {
    super(`This has ${pages} pages; up to ${MAX_PAGES} can be transcribed at once.`);
    this.name = "TooManyPagesError";
  }
}

export interface TranscribeRun {
  pages: TranscribedPage[];
  // Pages that came back with nothing — blank, or unreadable.
  empty: number[];
}

export async function transcribeDocument(options: {
  source: PageSource;
  send: (batch: { page: number; image: string }[]) => Promise<TranscribedPage[]>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  batchSize?: number;
}): Promise<TranscribeRun> {
  const { source, send, onProgress, signal } = options;
  const total = source.pageCount;
  if (total > MAX_PAGES) throw new TooManyPagesError(total);
  const size = Math.min(options.batchSize ?? MAX_PAGES_PER_CALL, MAX_PAGES_PER_CALL);
  const pages: TranscribedPage[] = [];
  onProgress?.(0, total);
  for (let start = 1; start <= total; start += size) {
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    const batch: { page: number; image: string }[] = [];
    for (let page = start; page < start + size && page <= total; page++) {
      batch.push({ page, image: await source.render(page) });
    }
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    // One retry: a dropped connection or a busy model shouldn't waste the
    // pages already paid for.
    let result: TranscribedPage[];
    try {
      result = await send(batch);
    } catch (err) {
      if (signal?.aborted) throw err;
      result = await send(batch);
    }
    pages.push(...result);
    onProgress?.(pages.length, total);
  }
  return { pages, empty: pages.filter((p) => !p.markdown.trim()).map((p) => p.page) };
}
