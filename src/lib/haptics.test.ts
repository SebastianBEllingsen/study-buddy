// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { tap } from "./haptics";

describe("tap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls navigator.vibrate with the given pattern", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    tap(50);
    expect(vibrate).toHaveBeenCalledWith(50);
  });

  it("calls navigator.vibrate with an array pattern", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    tap([10, 20, 10]);
    expect(vibrate).toHaveBeenCalledWith([10, 20, 10]);
  });

  it("defaults to a 10ms pulse", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    tap();
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it("silently does nothing when the Vibration API isn't supported", () => {
    vi.stubGlobal("navigator", {});
    expect(() => tap()).not.toThrow();
  });

  it("silently swallows an error thrown by vibrate (e.g. called outside a user gesture)", () => {
    const vibrate = vi.fn(() => {
      throw new Error("not allowed");
    });
    vi.stubGlobal("navigator", { vibrate });
    expect(() => tap()).not.toThrow();
  });
});
