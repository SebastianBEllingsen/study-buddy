import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const { Autosave } = await import("./autosave");

type Call = { body: Record<string, unknown>; keepalive?: boolean; resolve: (res: Response) => void; reject: (e: Error) => void };
let calls: Call[];

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          calls.push({ body: JSON.parse(init.body as string), keepalive: init.keepalive, resolve, reject });
        })
    )
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ok = () => new Response("{}", { status: 200 });

describe("Autosave", () => {
  it("batches quick edits into one save", async () => {
    const saver = new Autosave<{ title: string; markdown: string }>("/api/notes/1", "fail", () => {});
    saver.schedule({ title: "a" });
    saver.schedule({ markdown: "b" });
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.map((c) => c.body)).toEqual([{ title: "a", markdown: "b" }]);
  });

  it("never has two saves in flight, so the newest text lands last", async () => {
    const saver = new Autosave<{ markdown: string }>("/api/notes/1", "fail", () => {});
    saver.schedule({ markdown: "old" });
    await vi.advanceTimersByTimeAsync(800);
    saver.schedule({ markdown: "new" });
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(1); // still waiting for the first
    calls[0].resolve(ok());
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.map((c) => c.body.markdown)).toEqual(["old", "new"]);
  });

  it("keeps edits through a network failure and retries them", async () => {
    const states: string[] = [];
    const saver = new Autosave<{ markdown: string }>("/api/notes/1", "fail", (s) => states.push(s));
    saver.schedule({ markdown: "text" });
    await vi.advanceTimersByTimeAsync(800);
    calls[0].reject(new TypeError("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toBe("error");
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls[1].body).toEqual({ markdown: "text" });
    calls[1].resolve(ok());
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toBe("saved");
    expect(saver.dirty).toBe(false);
  });

  it("doesn't retry what the server rejects", async () => {
    const saver = new Autosave<{ markdown: string }>("/api/notes/1", "fail", () => {});
    saver.schedule({ markdown: "text" });
    await vi.advanceTimersByTimeAsync(800);
    calls[0].resolve(new Response('{"error":"Note not found"}', { status: 404 }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });

  it("sends unsent edits with keepalive when the tab closes, unless too big", async () => {
    const saver = new Autosave<{ markdown: string }>("/api/notes/1", "fail", () => {});
    saver.schedule({ markdown: "small" });
    expect(saver.flushOnUnload()).toBe(true);
    expect(calls[0]).toMatchObject({ body: { markdown: "small" }, keepalive: true });

    const big = new Autosave<{ markdown: string }>("/api/notes/2", "fail", () => {});
    big.schedule({ markdown: "x".repeat(70_000) });
    expect(big.flushOnUnload()).toBe(false); // the page asks before closing
    expect(big.dirty).toBe(true);
  });

  it("drops unsent edits when the document is deleted", async () => {
    const saver = new Autosave<{ markdown: string }>("/api/notes/1", "fail", () => {});
    saver.schedule({ markdown: "text" });
    saver.discard();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(0);
  });
});
