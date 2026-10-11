import { afterEach, describe, expect, it, vi } from "vitest";
import { browserOpenCommand, isExternalHttpUrl, isLocalSameOriginRequest, openExternal } from "./externalLinks";

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

describe("browserOpenCommand", () => {
  const url = "https://example.com/?a=1&b=2";

  it("uses each platform's default-browser handler, passing the URL as one argument", () => {
    expect(browserOpenCommand("darwin", url)).toEqual({ command: "open", args: [url] });
    expect(browserOpenCommand("win32", url)).toEqual({ command: "explorer.exe", args: [url] });
    expect(browserOpenCommand("linux", url)).toEqual({ command: "xdg-open", args: [url] });
    expect(browserOpenCommand("freebsd", url)).toEqual({ command: "xdg-open", args: [url] });
  });
});

describe("openExternal", () => {
  const url = "https://example.com/page";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stub(fetchImpl: () => Promise<{ ok: boolean }>) {
    const open = vi.fn();
    vi.stubGlobal("fetch", vi.fn(fetchImpl));
    vi.stubGlobal("window", { open });
    return open;
  }

  it("lets the server open the link when it can", async () => {
    const open = stub(async () => ({ ok: true }));
    await openExternal(url);
    expect(open).not.toHaveBeenCalled();
  });

  it("falls back to a new tab when the server refuses (remote client)", async () => {
    const open = stub(async () => ({ ok: false }));
    await openExternal(url);
    expect(open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  });

  it("falls back to a new tab when the request fails", async () => {
    const open = stub(async () => {
      throw new Error("network");
    });
    await openExternal(url);
    expect(open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  });
});
