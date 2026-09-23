import { describe, expect, it } from "vitest";
import { APP_THEMES, appThemeBootScript, isAppTheme } from "./appThemes";

function runBootScript(stored: string | null): string | null {
  const attrs: Record<string, string> = {};
  const localStorage = { getItem: () => stored };
  const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
  new Function("localStorage", "document", appThemeBootScript())(localStorage, document);
  return attrs["data-app-theme"] ?? null;
}

describe("appThemeBootScript", () => {
  it("applies every stored non-default theme before paint", () => {
    for (const theme of APP_THEMES.slice(1)) expect(runBootScript(theme)).toBe(theme);
  });

  it("leaves calm, unknown and missing values alone", () => {
    expect(runBootScript("calm")).toBeNull();
    expect(runBootScript("nonsense")).toBeNull();
    expect(runBootScript(null)).toBeNull();
  });
});

describe("isAppTheme", () => {
  it("accepts known themes only", () => {
    expect(isAppTheme("index-card")).toBe(true);
    expect(isAppTheme("Index-card")).toBe(false);
    expect(isAppTheme(undefined)).toBe(false);
  });
});
