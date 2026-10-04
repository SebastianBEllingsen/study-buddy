import { describe, expect, it } from "vitest";
import { todayCardLook } from "./useTransparentWidgets";

describe("todayCardLook", () => {
  it("is a solid card whenever widgets aren't transparent, frosted setting or not", () => {
    for (const frosted of [true, false]) {
      expect(todayCardLook({ dashboardTransparentWidgets: false, todayCardShown: true, todayCardFrosted: frosted })).toMatchObject({ shown: true, look: "solid" });
    }
  });

  it("picks frosted or plain when widgets are transparent", () => {
    expect(todayCardLook({ dashboardTransparentWidgets: true, todayCardShown: true, todayCardFrosted: true })).toMatchObject({ shown: true, look: "frosted" });
    expect(todayCardLook({ dashboardTransparentWidgets: true, todayCardShown: true, todayCardFrosted: false })).toMatchObject({ shown: true, look: "plain" });
  });

  it("hides the card when told to, whatever its look", () => {
    expect(todayCardLook({ dashboardTransparentWidgets: true, todayCardShown: false, todayCardFrosted: true }).shown).toBe(false);
    expect(todayCardLook({ dashboardTransparentWidgets: false, todayCardShown: false, todayCardFrosted: true }).shown).toBe(false);
  });

  it("shows a frosted-if-transparent card until the settings arrive, so nothing flashes", () => {
    expect(todayCardLook(undefined)).toMatchObject({ shown: true, look: "solid" });
  });

  it("offers the courses list unless Settings turns it off, and by default until settings arrive", () => {
    const base = { dashboardTransparentWidgets: false, todayCardShown: true, todayCardFrosted: true };
    expect(todayCardLook(undefined).coursesShown).toBe(true);
    expect(todayCardLook(base).coursesShown).toBe(true);
    expect(todayCardLook({ ...base, todayCoursesShown: true }).coursesShown).toBe(true);
    expect(todayCardLook({ ...base, todayCoursesShown: false }).coursesShown).toBe(false);
  });
});
