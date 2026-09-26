import { describe, it, expect, vi, beforeEach } from "vitest";

// A separate file from anthropicApi.test.ts because this one replaces the
// SDK client itself (its describeError tests need the real error classes).
const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => create(...args) };
  },
}));
vi.mock("../models", () => ({ getProviderKey: vi.fn(async () => "test-key") }));

const { generateTextWithWebSearch, collectCitations } = await import("./anthropicApi");

beforeEach(() => {
  create.mockReset();
});

const searchResultBlock = {
  type: "web_search_tool_result",
  tool_use_id: "t1",
  content: [{ type: "web_search_result", url: "https://example.org/a", title: "A", encrypted_content: "", page_age: null }],
};

describe("anthropicApi generateTextWithWebSearch", () => {
  it("passes the web search tool, sized for the model", async () => {
    create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] });
    await generateTextWithWebSearch({ system: "s", user: "u", maxSearches: 4 });
    expect(create.mock.calls[0][0].tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 4 }]);

    await generateTextWithWebSearch({ system: "s", user: "u", efficient: true });
    expect(create.mock.calls[1][0].tools[0].type).toBe("web_search_20250305");
  });

  it("resumes a paused turn and returns the final text with every citation", async () => {
    create
      .mockResolvedValueOnce({
        stop_reason: "pause_turn",
        content: [{ type: "text", text: "Searching…" }, searchResultBlock],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: '{"resources":[]}',
            citations: [{ type: "web_search_result_location", url: "https://example.org/b", title: "B", cited_text: "", encrypted_index: "" }],
          },
        ],
      });

    const result = await generateTextWithWebSearch({ system: "s", user: "u" });
    expect(result.text).toBe('{"resources":[]}');
    expect(result.searched).toBe(true);
    expect(result.citations).toEqual([
      { url: "https://example.org/a", title: "A" },
      { url: "https://example.org/b", title: "B" },
    ]);
    // The paused assistant turn is sent back as-is, with no extra user message.
    const resumed = create.mock.calls[1][0].messages;
    expect(resumed).toHaveLength(2);
    expect(resumed[1].role).toBe("assistant");
  });

  it("stops resuming after a fixed number of pauses", async () => {
    create.mockResolvedValue({ stop_reason: "pause_turn", content: [{ type: "text", text: "still going" }] });
    const result = await generateTextWithWebSearch({ system: "s", user: "u" });
    expect(create).toHaveBeenCalledTimes(5);
    expect(result.text).toBe("still going");
  });
});

describe("collectCitations", () => {
  it("skips a search error block and removes duplicate URLs", () => {
    expect(
      collectCitations([
        { type: "web_search_tool_result", tool_use_id: "t", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
        searchResultBlock,
        searchResultBlock,
      ] as never)
    ).toEqual([{ url: "https://example.org/a", title: "A" }]);
  });
});
