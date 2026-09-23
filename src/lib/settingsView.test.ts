import { describe, expect, it } from "vitest";
import { parseSettingsView } from "./settingsView";

describe("parseSettingsView", () => {
  it("round-trips a saved view", () => {
    const view = { tab: "appearance", scroll: { appearance: 420, ai: 80 } };
    expect(parseSettingsView(JSON.stringify(view))).toEqual(view);
  });

  it("falls back to the AI tab at the top when nothing is saved or it's garbage", () => {
    const fresh = { tab: "ai", scroll: {} };
    expect(parseSettingsView(null)).toEqual(fresh);
    expect(parseSettingsView("not json{")).toEqual(fresh);
    expect(parseSettingsView("42")).toEqual(fresh);
  });

  it("keeps the valid parts of a partly bad view", () => {
    expect(
      parseSettingsView(
        JSON.stringify({ tab: "removed-tab", scroll: { display: 99.6, bogus: 10, ai: -5, storage: "x", calendar: null } })
      )
    ).toEqual({ tab: "ai", scroll: { display: 100 } });
  });
});
