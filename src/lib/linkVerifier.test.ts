import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SafeRequestResult } from "./urlSafety";

// Every network call goes through safeProbe — mocked, so no test here
// touches the network and each site's behavior can be scripted.
const safeProbe = vi.fn<(url: string, init?: unknown) => Promise<SafeRequestResult>>();
vi.mock("./urlSafety", () => ({ safeProbe: (url: string, init?: unknown) => safeProbe(url, init) }));

const { classifyResourceUrl, isSoftNotFound, looksLikeStorePage, verifyLink, verifyLinks, linkCheckKey } =
  await import("./linkVerifier");

function page(status: number, body = "<title>Lesson</title>", finalUrl?: string) {
  return async (url: string): Promise<SafeRequestResult> => ({
    ok: true,
    status,
    finalUrl: finalUrl ?? url,
    contentType: "text/html",
    body,
  });
}

beforeEach(() => {
  safeProbe.mockReset();
});

describe("classifyResourceUrl", () => {
  it("blocks non-web and malformed links", () => {
    expect(classifyResourceUrl("ftp://example.org/x")?.status).toBe("blocked");
    expect(classifyResourceUrl("not a url")?.status).toBe("blocked");
  });

  it("blocks store hosts and checkout paths", () => {
    expect(classifyResourceUrl("https://www.amazon.com/some-book/dp/0123456789")?.status).toBe("blocked");
    expect(classifyResourceUrl("https://www.amazon.co.uk/x")?.status).toBe("blocked");
    expect(classifyResourceUrl("https://publisher.example.com/shop/cart")?.status).toBe("blocked");
    expect(classifyResourceUrl("https://publisher.example.com/buy/123")?.status).toBe("blocked");
  });

  it("lets ordinary learning pages through to the network check", () => {
    expect(classifyResourceUrl("https://ocw.example.edu/courses/intro")).toBeNull();
    expect(classifyResourceUrl("https://example.org/buyers-guide-to-graphs")).toBeNull();
  });
});

describe("isSoftNotFound", () => {
  it("spots an error page served with 200", () => {
    expect(isSoftNotFound("https://a.example/x", "https://a.example/x", "<title>Page Not Found | Site</title>")).toBe(true);
    expect(isSoftNotFound("https://a.example/x", "https://a.example/x", "<title>404</title>")).toBe(true);
  });

  it("spots a deep link bounced to the front page", () => {
    expect(isSoftNotFound("https://a.example/course/42", "https://a.example/", "<title>Home</title>")).toBe(true);
  });

  it("accepts a real page, and a front-page link that stays on the front page", () => {
    expect(isSoftNotFound("https://a.example/x", "https://a.example/x", "<title>Vectors</title>")).toBe(false);
    expect(isSoftNotFound("https://a.example/", "https://a.example/", "<title>Home</title>")).toBe(false);
  });
});

describe("looksLikeStorePage", () => {
  it("recognizes purchase wording", () => {
    expect(looksLikeStorePage("<button>Add to cart</button>")).toBe(true);
    expect(looksLikeStorePage("<p>Read chapter 1 online</p>")).toBe(false);
  });
});

describe("verifyLink", () => {
  it("checks YouTube videos and playlists through oEmbed", async () => {
    safeProbe.mockImplementation(page(200, "{}"));
    const result = await verifyLink("https://www.youtube.com/playlist?list=PLabcdefghij123", "playlist");
    expect(result.status).toBe("ok");
    expect(safeProbe.mock.calls[0][0]).toMatch(/^https:\/\/www\.youtube\.com\/oembed\?format=json&url=/);
  });

  it("treats a missing YouTube video as dead and an embed-disabled one as fine", async () => {
    safeProbe.mockImplementationOnce(page(404, ""));
    expect((await verifyLink("https://youtu.be/dQw4w9WgXcQ", "video")).status).toBe("dead");
    safeProbe.mockImplementationOnce(page(401, ""));
    expect((await verifyLink("https://youtu.be/dQw4w9WgXcQ", "video")).status).toBe("ok");
  });

  it("marks 404/410 pages dead", async () => {
    safeProbe.mockImplementation(page(404));
    expect(await verifyLink("https://example.org/gone", "article")).toMatchObject({ status: "dead" });
  });

  it("keeps bot-walled and rate-limited sites as unknown", async () => {
    safeProbe.mockImplementationOnce(page(403));
    expect((await verifyLink("https://example.org/a", "article")).status).toBe("unknown");
    safeProbe.mockImplementationOnce(page(429));
    expect((await verifyLink("https://example.org/b", "article")).status).toBe("unknown");
  });

  it("treats a nonexistent host as dead and a private address as blocked", async () => {
    safeProbe.mockResolvedValueOnce({ ok: false, reason: "unresolvable", error: "x" });
    expect((await verifyLink("https://no-such.example/", "article")).status).toBe("dead");
    safeProbe.mockResolvedValueOnce({ ok: false, reason: "blocked", error: "x" });
    expect((await verifyLink("https://internal.example/", "article")).status).toBe("blocked");
    safeProbe.mockResolvedValueOnce({ ok: false, reason: "network", error: "timeout" });
    expect((await verifyLink("https://slow.example/", "article")).status).toBe("unknown");
  });

  it("returns the final URL after redirects (resolving search redirect links)", async () => {
    safeProbe.mockImplementation(page(200, "<title>Lesson</title>", "https://courses.example.edu/linear-algebra"));
    const result = await verifyLink("https://redirect.example/grounding/abc", "course");
    expect(result).toEqual({ status: "ok", detail: null, finalUrl: "https://courses.example.edu/linear-algebra" });
  });

  it("blocks a redirect that lands on a store", async () => {
    safeProbe.mockImplementation(page(200, "<title>Buy</title>", "https://www.amazon.com/x/dp/123"));
    expect((await verifyLink("https://short.example/abc", "book")).status).toBe("blocked");
  });

  it("blocks a book that's a product page off the free-reading list, but not on it", async () => {
    safeProbe.mockImplementation(page(200, "<title>Great Book</title><button>Add to cart</button>"));
    expect((await verifyLink("https://publisher.example.com/great-book", "book")).status).toBe("blocked");
    expect((await verifyLink("https://openstax.org/books/great-book", "book")).status).toBe("ok");
    // Only books get the store-page check.
    expect((await verifyLink("https://publisher.example.com/article", "article")).status).toBe("ok");
  });
});

describe("verifyLinks", () => {
  it("checks each distinct link once", async () => {
    const check = vi.fn(async (url: string) => ({ status: "ok" as const, detail: null, finalUrl: url }));
    const links = [
      { url: "https://a.example/1", kind: "article" as const },
      { url: "https://a.example/1", kind: "article" as const },
      { url: "https://b.example/2", kind: "video" as const },
    ];
    const results = await verifyLinks(links, { check });
    expect(check).toHaveBeenCalledTimes(2);
    expect(results.get(linkCheckKey(links[2]))?.status).toBe("ok");
  });

  it("never has more than two requests in flight to one host", async () => {
    let active = 0;
    let peak = 0;
    const check = async (url: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { status: "ok" as const, detail: null, finalUrl: url };
    };
    const links = Array.from({ length: 8 }, (_, i) => ({ url: `https://same.example/${i}`, kind: "article" as const }));
    await verifyLinks(links, { check });
    expect(peak).toBe(2);
  });

  it("returns unknown for a check that throws, and for links past the time budget", async () => {
    const results = await verifyLinks([{ url: "https://a.example/x", kind: "article" }], {
      check: async () => {
        throw new Error("boom");
      },
    });
    expect(results.get("article https://a.example/x")?.status).toBe("unknown");

    const check = vi.fn();
    const late = await verifyLinks([{ url: "https://a.example/y", kind: "article" }], { check, budgetMs: -1 });
    expect(check).not.toHaveBeenCalled();
    expect(late.get("article https://a.example/y")?.status).toBe("unknown");
  });
});
