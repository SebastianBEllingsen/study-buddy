import { describe, it, expect, vi, afterEach } from "vitest";
import { fetcher } from "./swrFetcher";

function mockFetchOnce(response: Partial<Response> & { json: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      ...response,
    } as Response)
  );
}

describe("fetcher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed JSON body on a successful response", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ hello: "world" }) });
    await expect(fetcher("/api/whatever")).resolves.toEqual({ hello: "world" });
  });

  it("throws the response body's error message on a non-ok response", async () => {
    mockFetchOnce({ ok: false, status: 404, json: async () => ({ error: "Not found" }) });
    await expect(fetcher("/api/whatever")).rejects.toThrow("Not found");
  });

  it("falls back to a generic status-based message when the error body is malformed", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("not json");
      },
    });
    await expect(fetcher("/api/whatever")).rejects.toThrow("Request failed (500)");
  });

  it("falls back to a generic status-based message when the error body has no 'error' field", async () => {
    mockFetchOnce({ ok: false, status: 400, json: async () => ({}) });
    await expect(fetcher("/api/whatever")).rejects.toThrow("Request failed (400)");
  });

  it("passes the given URL through to fetch unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    await fetcher("/api/some-endpoint");
    expect(fetchMock).toHaveBeenCalledWith("/api/some-endpoint");
  });
});
