import { MAX_PAGES, type PageImage, type TranscribedPage } from "./types";

// What the transcribe route accepts (see api/courses/.../transcribe).
export type TranscribeRequest =
  | { action: "batch"; images: PageImage[] }
  | { action: "commit"; pages: TranscribedPage[] }
  | { action: "restore" };

const DATA_URL = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_PAGE_TEXT = 60_000;

function pageNumber(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_PAGES ? (v as number) : null;
}

export function parseTranscribeRequest(body: Record<string, unknown>): TranscribeRequest | null {
  if (body.action === "restore") return { action: "restore" };
  if (!Array.isArray(body.pages)) return null;
  if (body.action === "batch") {
    const images: PageImage[] = [];
    for (const entry of body.pages.slice(0, 10)) {
      const { page, image } = (entry ?? {}) as { page?: unknown; image?: unknown };
      const n = pageNumber(page);
      const m = typeof image === "string" ? DATA_URL.exec(image) : null;
      if (n === null || !m) return null;
      images.push({ page: n, mimeType: m[1] as PageImage["mimeType"], base64: m[2] });
    }
    return images.length > 0 ? { action: "batch", images } : null;
  }
  if (body.action === "commit") {
    const pages: TranscribedPage[] = [];
    for (const entry of body.pages.slice(0, MAX_PAGES)) {
      const { page, markdown } = (entry ?? {}) as { page?: unknown; markdown?: unknown };
      const n = pageNumber(page);
      if (n === null || typeof markdown !== "string") return null;
      pages.push({ page: n, markdown: markdown.slice(0, MAX_PAGE_TEXT) });
    }
    return pages.length > 0 ? { action: "commit", pages } : null;
  }
  return null;
}
