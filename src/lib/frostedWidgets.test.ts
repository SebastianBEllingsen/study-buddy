import { describe, expect, it } from "vitest";
import { allFrosted, withFrosted } from "./frostedWidgets";
import type { HomeWidgetConfig } from "./models";

const widget = (id: HomeWidgetConfig["id"], enabled: boolean, frosted?: boolean): HomeWidgetConfig => ({
  id, enabled, zone: "top", col: 0, row: 0, colSpan: 3, rowSpan: 1, ...(frosted === undefined ? {} : { frosted }),
});
const settings = (homeWidgets: HomeWidgetConfig[], todayCardShown = true, todayCardFrosted = true) => ({ homeWidgets, todayCardShown, todayCardFrosted });

describe("allFrosted", () => {
  it("is true only when every showing widget, and Today, is frosted", () => {
    expect(allFrosted(settings([widget("streak", true, true), widget("due", true, true)]))).toBe(true);
    expect(allFrosted(settings([widget("streak", true, true), widget("due", true)]))).toBe(false);
    expect(allFrosted(settings([widget("streak", true, true)], true, false))).toBe(false);
  });

  it("doesn't count hidden widgets, or a hidden Today card", () => {
    expect(allFrosted(settings([widget("streak", true, true), widget("links", false)]))).toBe(true);
    expect(allFrosted(settings([widget("streak", true, true)], false, false))).toBe(true);
  });

  it("is false when there's nothing showing to frost", () => {
    expect(allFrosted(settings([widget("links", false)], false, true))).toBe(false);
    expect(allFrosted(settings([], true, true))).toBe(true);
  });
});

describe("withFrosted", () => {
  it("sets every widget the same, hidden ones too, and leaves the rest of each alone", () => {
    const widgets = [{ ...widget("streak", true), label: "Mine" }, widget("links", false, true), widget("due", true, false)];
    const on = withFrosted(widgets, true);
    expect(on.every((w) => w.frosted === true)).toBe(true);
    expect(on[0]).toMatchObject({ id: "streak", enabled: true, label: "Mine", colSpan: 3 });
    const off = withFrosted(on, false);
    expect(off.every((w) => !("frosted" in w))).toBe(true);
    // The original isn't touched.
    expect(widgets[1].frosted).toBe(true);
  });
});
