import { describe, it, expect, vi, beforeEach } from "vitest";

// isSafeExternalUrl resolves hostnames via node:dns/promises — mocked so
// these tests are deterministic and never touch the network, and so the
// "hostname resolves to a private address" case (impossible to reliably
// trigger against a real DNS server) can be exercised directly.
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  default: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

const { checkExternalUrl, isSafeExternalUrl, safeFetch, safeProbe } = await import("./urlSafety");

beforeEach(() => {
  lookupMock.mockReset();
});

describe("isSafeExternalUrl", () => {
  it("rejects malformed URLs", async () => {
    expect(await isSafeExternalUrl("not a url")).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects non-http(s) protocols", async () => {
    expect(await isSafeExternalUrl("ftp://example.com/file")).toBe(false);
    expect(await isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  describe("literal IPv4 addresses (no DNS lookup needed)", () => {
    it.each([
      ["http://127.0.0.1/", "loopback"],
      ["http://169.254.169.254/latest/meta-data/", "link-local / cloud metadata"],
      ["http://10.0.0.5/", "private (10/8)"],
      ["http://172.16.0.5/", "private (172.16/12)"],
      ["http://192.168.1.1/", "private (192.168/16)"],
      ["http://0.0.0.0/", "this network"],
      ["http://224.0.0.1/", "multicast"],
    ])("rejects %s (%s)", async (url) => {
      expect(await isSafeExternalUrl(url)).toBe(false);
      expect(lookupMock).not.toHaveBeenCalled();
    });

    it("accepts a public IPv4 literal", async () => {
      expect(await isSafeExternalUrl("http://93.184.216.34/")).toBe(true);
      expect(lookupMock).not.toHaveBeenCalled();
    });
  });

  describe("literal IPv6 addresses", () => {
    it("rejects the IPv6 loopback address", async () => {
      expect(await isSafeExternalUrl("http://[::1]/")).toBe(false);
    });

    it("rejects an IPv6 link-local address", async () => {
      expect(await isSafeExternalUrl("http://[fe80::1]/")).toBe(false);
    });

    it("rejects an IPv4-mapped private address", async () => {
      expect(await isSafeExternalUrl("http://[::ffff:127.0.0.1]/")).toBe(false);
    });

    // Regression coverage: an earlier version of urlSafety.ts matched
    // IPv4-mapped IPv6 addresses with a regex tied to one specific textual
    // form ("::ffff:a.b.c.d"), missing equivalent-but-differently-written
    // forms of the same address. Both of these are 127.0.0.1 — the second
    // is the same address as "::ffff:127.0.0.1" above with the trailing
    // 32 bits written as hex groups instead of dotted-decimal.
    it("rejects the fully-expanded textual form of an IPv4-mapped loopback address", async () => {
      expect(await isSafeExternalUrl("http://[0:0:0:0:0:ffff:7f00:1]/")).toBe(false);
    });

    it("rejects the hex-group-compressed textual form of an IPv4-mapped loopback address", async () => {
      expect(await isSafeExternalUrl("http://[::ffff:7f00:1]/")).toBe(false);
    });

    it("rejects the hex-group form of an IPv4-mapped link-local/metadata address", async () => {
      // ::ffff:169.254.169.254, written as hex groups (a9fe:a9fe = 169.254.169.254)
      expect(await isSafeExternalUrl("http://[::ffff:a9fe:a9fe]/")).toBe(false);
    });

    it("accepts a public IPv4-mapped address", async () => {
      expect(await isSafeExternalUrl("http://[::ffff:93.184.216.34]/")).toBe(true);
    });

    it("rejects an IPv6 unique-local address", async () => {
      expect(await isSafeExternalUrl("http://[fc00::1]/")).toBe(false);
    });

    it("rejects the unspecified IPv6 address", async () => {
      expect(await isSafeExternalUrl("http://[::]/")).toBe(false);
    });

    it("accepts a public IPv6 literal", async () => {
      expect(await isSafeExternalUrl("http://[2606:2800:220:1:248:1893:25c8:1946]/")).toBe(true);
    });
  });

  describe("hostnames (resolved via mocked DNS)", () => {
    it("accepts a hostname that resolves only to public addresses", async () => {
      lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      expect(await isSafeExternalUrl("http://example.com/feed.ics")).toBe(true);
    });

    it("rejects a hostname that resolves to a private address", async () => {
      lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
      expect(await isSafeExternalUrl("http://internal.example.com/")).toBe(false);
    });

    it("rejects a hostname with mixed public/private A records (any-match blocks)", async () => {
      lookupMock.mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
      expect(await isSafeExternalUrl("http://rebind.example.com/")).toBe(false);
    });

    it("rejects when DNS resolution fails", async () => {
      lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
      expect(await isSafeExternalUrl("http://does-not-exist.invalid/")).toBe(false);
    });

    it("rejects when DNS resolves to no addresses at all", async () => {
      lookupMock.mockResolvedValue([]);
      expect(await isSafeExternalUrl("http://example.com/")).toBe(false);
    });
  });
});

describe("safeFetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("fetches and returns the body for a plain safe URL", async () => {
    fetchMock.mockResolvedValue(new Response("hello", { status: 200 }));
    const result = await safeFetch("http://93.184.216.34/feed.ics");
    expect(result).toEqual({ ok: true, text: "hello" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("rejects a URL that doesn't resolve to a permitted address, without fetching", async () => {
    const result = await safeFetch("http://127.0.0.1/");
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows a redirect to another safe address", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: "http://93.184.216.35/final" } })
      )
      .mockResolvedValueOnce(new Response("final body", { status: 200 }));
    const result = await safeFetch("http://93.184.216.34/start");
    expect(result).toEqual({ ok: true, text: "final body" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("http://93.184.216.35/final");
  });

  // This is the actual SSRF gap being closed: isSafeExternalUrl alone only
  // validates the URL a caller passes in — a plain fetch() with the default
  // redirect:"follow" would validate that URL, then blindly follow a 30x
  // response wherever it points, including straight past the guard to an
  // internal address. safeFetch must re-validate every hop.
  it("refuses to follow a redirect to a blocked address", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data/" } })
    );
    const result = await safeFetch("http://93.184.216.34/start");
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to follow a relative redirect to a blocked address", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "//127.0.0.1/evil" } }));
    const result = await safeFetch("http://93.184.216.34/start");
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after too many redirects", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(null, { status: 302, headers: { Location: "http://93.184.216.34/next" } })
    );
    const result = await safeFetch("http://93.184.216.34/start");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too many redirects/i);
    // 1 initial + MAX_REDIRECTS retries, never unbounded.
    expect(fetchMock.mock.calls.length).toBeLessThan(10);
  });

  it("rejects a redirect response with no Location header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    const result = await safeFetch("http://93.184.216.34/start");
    expect(result.ok).toBe(false);
  });

  it("rejects a non-ok, non-redirect response", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const result = await safeFetch("http://93.184.216.34/start");
    expect(result.ok).toBe(false);
  });

  it("caps how much of the response body it will read into memory", async () => {
    const huge = "x".repeat(5 * 1024 * 1024 + 1);
    fetchMock.mockResolvedValue(new Response(huge, { status: 200 }));
    const result = await safeFetch("http://93.184.216.34/huge");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exceeded/i);
  });
});

describe("checkExternalUrl", () => {
  it("tells an unresolvable host apart from a blocked one", async () => {
    lookupMock.mockRejectedValueOnce(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
    expect(await checkExternalUrl("https://no-such-host.example/")).toBe("unresolvable");
    lookupMock.mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }]);
    expect(await checkExternalUrl("https://internal.example/")).toBe("blocked");
    expect(await checkExternalUrl("ftp://example.com/")).toBe("blocked");
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    expect(await checkExternalUrl("https://example.com/")).toBe("ok");
  });
});

describe("safeProbe", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns any final status with the final URL instead of treating it as failure", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: "/moved" } }))
      .mockResolvedValueOnce(
        new Response("<title>Gone</title>", { status: 404, headers: { "content-type": "text/html" } })
      );
    const result = await safeProbe("http://93.184.216.34/old");
    expect(result).toEqual({
      ok: true,
      status: 404,
      finalUrl: "http://93.184.216.34/moved",
      contentType: "text/html",
      body: "<title>Gone</title>",
    });
  });

  it("passes method and headers through", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await safeProbe("http://93.184.216.34/", { method: "HEAD", headers: { "User-Agent": "test" } });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "HEAD", headers: { "User-Agent": "test" }, redirect: "manual" });
  });

  it("truncates a large body at maxBytes instead of failing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(5000), { status: 200 }));
    const result = await safeProbe("http://93.184.216.34/", { maxBytes: 100 });
    expect(result.ok && result.body.length).toBe(100);
  });

  it("re-validates redirects and reports a blocked hop", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest" } })
    );
    const result = await safeProbe("http://93.184.216.34/");
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unresolvable host without fetching", async () => {
    lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const result = await safeProbe("https://no-such-host.example/");
    expect(result).toMatchObject({ ok: false, reason: "unresolvable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
