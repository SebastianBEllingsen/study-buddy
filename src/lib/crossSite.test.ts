import { describe, it, expect } from "vitest";
import { isCrossSiteWrite, isUntrustedHost } from "./crossSite";

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

describe("isUntrustedHost", () => {
  it("accepts the machine's own names, with or without a port", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "127.0.0.1", "[::1]:3000", "LOCALHOST", "app.localhost:3000"]) {
      expect(isUntrustedHost(headers({ host }))).toBe(false);
    }
  });

  it("turns away any other hostname, including one that only starts with an allowed name", () => {
    for (const host of ["evil.example:3000", "localhost.evil.example", "127.0.0.1.evil.example:3000", "192.168.1.5:3000"]) {
      expect(isUntrustedHost(headers({ host }))).toBe(true);
    }
  });

  it("lets clients with no Host header through, and names added by setting", () => {
    expect(isUntrustedHost(headers({}))).toBe(false);
    expect(isUntrustedHost(headers({ host: "study.example:3000" }), "study.example, other.example")).toBe(false);
    expect(isUntrustedHost(headers({ host: "evil.example" }), "study.example")).toBe(true);
  });
});
