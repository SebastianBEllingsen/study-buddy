import { describe, it, expect, vi } from "vitest";

const listPinnedNotes = vi.fn();
vi.mock("@/lib/models", () => ({ listPinnedNotes: (...a: unknown[]) => listPinnedNotes(...a) }));

const { GET } = await import("./route");

describe("GET /api/notes/pinned", () => {
  it("returns the pinned notes", async () => {
    listPinnedNotes.mockResolvedValue([{ id: 1, title: "A" }]);
    const res = await GET();
    expect(await res.json()).toEqual({ notes: [{ id: 1, title: "A" }] });
  });
});
