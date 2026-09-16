// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CropRect } from "@/components/ask-ai/useCropToAsk";

// html2canvas-pro does real rendering work this test has no interest in —
// mocked so captureElementRegion's own geometry-clamping logic (the actual
// thing worth testing here) can be exercised directly.
const html2canvas = vi.fn();
vi.mock("html2canvas-pro", () => ({ default: html2canvas }));

const { captureElementRegion } = await import("./cropCapture");

function fakeElement(rect: { left: number; top: number; right: number; bottom: number }): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

beforeEach(() => {
  html2canvas.mockReset();
  html2canvas.mockResolvedValue({ toDataURL: () => "data:image/png;base64,MOCK" });
});

describe("captureElementRegion", () => {
  it("passes the crop rect through unchanged when it's fully inside the element", async () => {
    const el = fakeElement({ left: 0, top: 0, right: 500, bottom: 500 });
    const rect: CropRect = { left: 50, top: 60, width: 100, height: 80 };
    await captureElementRegion(el, rect);
    expect(html2canvas).toHaveBeenCalledWith(
      el,
      expect.objectContaining({ x: 50, y: 60, width: 100, height: 80 })
    );
  });

  it("clamps the crop rect to the element's own bounds when the selection overhangs it", async () => {
    const el = fakeElement({ left: 0, top: 0, right: 200, bottom: 200 });
    // Selection starts before the element and extends past its right/bottom edge.
    const rect: CropRect = { left: -50, top: -50, width: 300, height: 300 };
    await captureElementRegion(el, rect);
    expect(html2canvas).toHaveBeenCalledWith(el, expect.objectContaining({ x: 0, y: 0, width: 200, height: 200 }));
  });

  it("offsets x/y relative to the element, not the viewport", async () => {
    const el = fakeElement({ left: 100, top: 100, right: 600, bottom: 600 });
    const rect: CropRect = { left: 150, top: 160, width: 100, height: 80 };
    await captureElementRegion(el, rect);
    // Selection's viewport-relative left=150 minus the element's own
    // left=100 -> x=50 relative to the element.
    expect(html2canvas).toHaveBeenCalledWith(el, expect.objectContaining({ x: 50, y: 60 }));
  });

  it("returns null without calling html2canvas for a too-small selection", async () => {
    const el = fakeElement({ left: 0, top: 0, right: 500, bottom: 500 });
    const rect: CropRect = { left: 10, top: 10, width: 5, height: 5 };
    const result = await captureElementRegion(el, rect);
    expect(result).toBeNull();
    expect(html2canvas).not.toHaveBeenCalled();
  });

  it("returns the rendered canvas's data URL on success", async () => {
    const el = fakeElement({ left: 0, top: 0, right: 500, bottom: 500 });
    const rect: CropRect = { left: 10, top: 10, width: 100, height: 100 };
    const result = await captureElementRegion(el, rect);
    expect(result).toBe("data:image/png;base64,MOCK");
  });
});
