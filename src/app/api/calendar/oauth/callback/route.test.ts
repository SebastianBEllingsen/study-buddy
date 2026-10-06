import { beforeEach, describe, expect, it, vi } from "vitest";
import { oauthStateCookie } from "@/lib/oauthState";

const exchangeGoogleAuthCode = vi.fn();
vi.mock("@/lib/googleCalendar", () => ({
  exchangeGoogleAuthCode: (...a: unknown[]) => exchangeGoogleAuthCode(...a),
  describeGoogleCalendarError: (err: unknown) => (err instanceof Error ? err.message : "failed"),
}));

const { GET } = await import("./route");

const callback = (query: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/calendar/oauth/callback?${query}`, { headers: cookie ? { cookie } : {} }));

beforeEach(() => {
  exchangeGoogleAuthCode.mockReset().mockResolvedValue(undefined);
});

describe("GET /api/calendar/oauth/callback", () => {
  const state = "a".repeat(48);
  const cookie = oauthStateCookie(state).split(";")[0];

  it("connects when the state matches the cookie from this browser", async () => {
    const res = await callback(`code=abc&state=${state}`, cookie);
    expect(exchangeGoogleAuthCode).toHaveBeenCalledWith("abc");
    expect(res.headers.get("location")).toBe("http://localhost:3000/?calendarConnected=1");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("refuses a code that arrives with no cookie, as a page-initiated request would", async () => {
    const res = await callback(`code=attacker&state=${state}`);
    expect(exchangeGoogleAuthCode).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("calendarError=");
  });

  it("refuses a code with no state, or a different one", async () => {
    await callback("code=attacker", cookie);
    await callback(`code=attacker&state=${"b".repeat(48)}`, cookie);
    expect(exchangeGoogleAuthCode).not.toHaveBeenCalled();
  });

  it("reports Google's own error once the state checks out", async () => {
    const res = await callback(`error=access_denied&state=${state}`, cookie);
    expect(exchangeGoogleAuthCode).not.toHaveBeenCalled();
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toContain("Google: access_denied");
  });

  it("reports a failed code exchange", async () => {
    exchangeGoogleAuthCode.mockRejectedValue(new Error("bad code"));
    const res = await callback(`code=abc&state=${state}`, cookie);
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toContain("bad code");
  });
});
