import { describe, expect, it } from "vitest";
import { isExternalHttpUrl, isLocalSameOriginRequest } from "./externalLinks";

describe("isExternalHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isExternalHttpUrl("https://example.com/a")).toBe(true);
    expect(isExternalHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects non-http schemes and garbage", () => {
    expect(isExternalHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isExternalHttpUrl("mailto:a@b.c")).toBe(false);
    expect(isExternalHttpUrl("/vault/1")).toBe(false);
    expect(isExternalHttpUrl("")).toBe(false);
  });

  it("treats links to the app's own origin as internal", () => {
    expect(isExternalHttpUrl("http://localhost:3000/vault/1", "http://localhost:3000")).toBe(false);
    expect(isExternalHttpUrl("https://example.com", "http://localhost:3000")).toBe(true);
  });
});

describe("isLocalSameOriginRequest", () => {
  it("allows the local app calling itself", () => {
    expect(isLocalSameOriginRequest("localhost:3000", "http://localhost:3000")).toBe(true);
    expect(isLocalSameOriginRequest("127.0.0.1:3000", "http://127.0.0.1:3000")).toBe(true);
  });

  it("rejects other sites and remote hosts", () => {
    expect(isLocalSameOriginRequest("localhost:3000", "https://evil.example")).toBe(false);
    expect(isLocalSameOriginRequest("192.168.1.5:3000", "http://192.168.1.5:3000")).toBe(false);
    expect(isLocalSameOriginRequest("localhost:3000", null)).toBe(false);
    expect(isLocalSameOriginRequest(null, "http://localhost:3000")).toBe(false);
  });
});
