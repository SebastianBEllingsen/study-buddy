import { describe, it, expect, vi } from "vitest";
import { transcribeDocument, TooManyPagesError } from "./client";
import { fitScale, TARGET_LONG_SIDE } from "./render";
import type { PageSource } from "./render";

function source(pageCount: number): PageSource & { rendered: number[] } {
  const rendered: number[] = [];
  return {
    pageCount,
    rendered,
    async render(page) {
      rendered.push(page);
      return `data:image/jpeg;base64,p${page}`;
    },
    destroy: () => {},
  };
}

const echo = vi.fn(async (batch: { page: number; image: string }[]) => batch.map((b) => ({ page: b.page, markdown: `text ${b.page}` })));

describe("transcribeDocument", () => {
  it("sends the pages three at a time, in order, and reports progress", async () => {
    echo.mockClear();
    const progress: [number, number][] = [];
    const run = await transcribeDocument({ source: source(7), send: echo, onProgress: (d, t) => progress.push([d, t]) });
    expect(echo.mock.calls.map(([b]) => b.map((p) => p.page))).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(run.pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(run.empty).toEqual([]);
    expect(progress).toEqual([[0, 7], [3, 7], [6, 7], [7, 7]]);
  });

  it("reports the pages that came back empty", async () => {
    const send = async (batch: { page: number }[]) => batch.map((b) => ({ page: b.page, markdown: b.page === 2 ? "  " : "x" }));
    expect((await transcribeDocument({ source: source(3), send })).empty).toEqual([2]);
  });

  it("tries a failed batch once more, then gives up", async () => {
    const flaky = vi.fn().mockRejectedValueOnce(new Error("network")).mockImplementation(echo);
    const run = await transcribeDocument({ source: source(2), send: flaky });
    expect(run.pages).toHaveLength(2);
    expect(flaky).toHaveBeenCalledTimes(2);
    const broken = vi.fn().mockRejectedValue(new Error("down"));
    await expect(transcribeDocument({ source: source(2), send: broken })).rejects.toThrow("down");
    expect(broken).toHaveBeenCalledTimes(2);
  });

  it("stops between batches when asked, without sending what's left", async () => {
    const controller = new AbortController();
    const src = source(9);
    const send = vi.fn(async (batch: { page: number }[]) => {
      controller.abort();
      return batch.map((b) => ({ page: b.page, markdown: "x" }));
    });
    await expect(transcribeDocument({ source: src, send, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(src.rendered).toEqual([1, 2, 3]);
  });

  it("won't start on a document that's too long", async () => {
    const src = source(500);
    await expect(transcribeDocument({ source: src, send: echo })).rejects.toBeInstanceOf(TooManyPagesError);
    expect(src.rendered).toEqual([]);
  });
});

describe("fitScale", () => {
  it("scales a page's longer side to the target, and only shrinks an image", () => {
    expect(fitScale(612, 792)).toBeCloseTo(TARGET_LONG_SIDE / 792);
    expect(fitScale(800, 400, 1600, 1)).toBe(1);
    expect(fitScale(4000, 3000, 1600, 1)).toBeCloseTo(0.4);
    expect(fitScale(10, 10)).toBe(4);
    expect(fitScale(0, 0)).toBe(1);
  });
});
