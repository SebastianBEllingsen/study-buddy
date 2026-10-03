import { describe, it, expect, vi, beforeEach } from "vitest";

// The dashboard's widget list, as the settings route validates it.
const setHomeWidgets = vi.fn();
const getAppSettings = vi.fn();
vi.mock("@/lib/models", () => ({
  getAppSettings: (...a: unknown[]) => getAppSettings(...a),
  setHomeWidgets: (...a: unknown[]) => setHomeWidgets(...a),
  HOME_WIDGET_IDS: ["streak", "due"],
  HOME_WIDGET_ZONES: ["top", "bottom"],
  MAX_NEW_CARDS_PER_DAY: 200,
  IMAGE_CAPABLE_BACKENDS: [],
}));
vi.mock("@/lib/blobStorage/cleanup", () => ({ cleanupReplacedImage: vi.fn() }));

const { POST } = await import("./route");

const post = (body: unknown) => POST(new Request("http://localhost/api/settings", { method: "POST", body: JSON.stringify(body) }));
const widget = (id: string, extra: Record<string, unknown> = {}) => ({ id, enabled: true, zone: "top", col: 0, row: 0, colSpan: 3, rowSpan: 1, ...extra });

beforeEach(() => {
  setHomeWidgets.mockReset();
  getAppSettings.mockReset().mockResolvedValue({});
});

describe("POST /api/settings homeWidgets, frosted", () => {
  it("accepts frosted as true or false, or left out", async () => {
    const widgets = [widget("streak", { frosted: true }), widget("due", { frosted: false })];
    expect((await post({ homeWidgets: widgets })).status).toBe(200);
    expect(setHomeWidgets).toHaveBeenCalledWith(widgets);
    expect((await post({ homeWidgets: [widget("streak"), widget("due")] })).status).toBe(200);
  });

  it("refuses anything else for frosted", async () => {
    for (const frosted of ["yes", 1, null, []]) {
      const res = await post({ homeWidgets: [widget("streak", { frosted }), widget("due")] });
      expect(res.status, JSON.stringify(frosted)).toBe(400);
    }
    expect(setHomeWidgets).not.toHaveBeenCalled();
  });
});
