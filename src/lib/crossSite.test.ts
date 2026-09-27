import { describe, it, expect } from "vitest";
import { isCrossSiteWrite } from "./crossSite";

const headers = (h: Record<string, string>) => new Headers(h);

describe("isCrossSiteWrite", () => {
  it("lets reads through from anywhere", () => {
    expect(isCrossSiteWrite("GET", headers({ "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("allows the app's own writes and non-browser clients", () => {
    expect(isCrossSiteWrite("POST", headers({ "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteWrite("POST", headers({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(false);
    expect(isCrossSiteWrite("DELETE", headers({}))).toBe(false);
  });

  it("blocks writes another site sends through the browser", () => {
    expect(isCrossSiteWrite("POST", headers({ "sec-fetch-site": "cross-site" }))).toBe(true);
    // Another origin on the same machine (a different port) too.
    expect(isCrossSiteWrite("PATCH", headers({ "sec-fetch-site": "same-site" }))).toBe(true);
    expect(isCrossSiteWrite("POST", headers({ origin: "https://evil.example", host: "localhost:3000" }))).toBe(true);
    expect(isCrossSiteWrite("POST", headers({ origin: "null", host: "localhost:3000" }))).toBe(true);
  });
});
