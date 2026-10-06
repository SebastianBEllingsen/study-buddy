import { describe, expect, it } from "vitest";
import { OAUTH_STATE_COOKIE, clearOauthStateCookie, newOauthState, oauthStateCookie, oauthStateMatches } from "./oauthState";

describe("oauthState", () => {
  it("makes a different unguessable state each time", () => {
    const a = newOauthState();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(newOauthState()).not.toBe(a);
  });

  it("accepts a callback whose state matches the cookie from this browser", () => {
    const state = newOauthState();
    const cookie = oauthStateCookie(state).split(";")[0];
    expect(oauthStateMatches(`other=1; ${cookie}; more=2`, state)).toBe(true);
  });

  it("turns away a missing cookie, a missing state, or one that differs", () => {
    const state = newOauthState();
    const cookie = oauthStateCookie(state).split(";")[0];
    expect(oauthStateMatches(null, state)).toBe(false);
    expect(oauthStateMatches("", state)).toBe(false);
    expect(oauthStateMatches(cookie, null)).toBe(false);
    expect(oauthStateMatches(cookie, "")).toBe(false);
    expect(oauthStateMatches(cookie, newOauthState())).toBe(false);
    expect(oauthStateMatches(cookie, state.slice(0, -1))).toBe(false);
    expect(oauthStateMatches(`${OAUTH_STATE_COOKIE}=`, "")).toBe(false);
  });

  it("scopes the cookie to the callback, away from page scripts, and clears it", () => {
    const set = oauthStateCookie("abc");
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/api/calendar/oauth");
    expect(clearOauthStateCookie()).toContain("Max-Age=0");
  });
});
