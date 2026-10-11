import { describe, it, expect, vi, beforeEach } from "vitest";

const getNote = vi.fn();
const updateNoteMarkdown = vi.fn();
const setNotePinned = vi.fn();
vi.mock("@/lib/models", () => ({
  deleteNote: vi.fn(),
  getCanvasBacklinksForNote: vi.fn(),
  getNote: (...a: unknown[]) => getNote(...a),
  getNoteBacklinks: vi.fn(),
  InvalidDestinationFolderError: class extends Error {},
  moveNote: vi.fn(),
  renameNote: vi.fn(),
  setNoteGenerationSource: vi.fn(),
  setNotePinned: (...a: unknown[]) => setNotePinned(...a),
  updateNoteIcon: vi.fn(),
  updateNoteMarkdown: (...a: unknown[]) => updateNoteMarkdown(...a),
}));

const { PATCH } = await import("./route");

const params = { params: Promise.resolve({ noteId: "3" }) };
const patch = (body: unknown) =>
  new Request("http://x/api/notes/3", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  getNote.mockReset();
  updateNoteMarkdown.mockReset();
  setNotePinned.mockReset();
});

describe("PATCH /api/notes/[noteId]", () => {
  it("answers 404 for a note that no longer exists instead of reporting a save", async () => {
    getNote.mockResolvedValue(undefined);
    const res = await PATCH(patch({ markdown: "hi" }), params);
    expect(res.status).toBe(404);
    expect(updateNoteMarkdown).not.toHaveBeenCalled();
  });

  it("saves to an existing note", async () => {
    getNote.mockResolvedValue({ id: 3 });
    const res = await PATCH(patch({ markdown: "hi" }), params);
    expect(res.status).toBe(200);
    expect(updateNoteMarkdown).toHaveBeenCalledWith(3, "hi");
  });

  it("pins and unpins a note", async () => {
    getNote.mockResolvedValue({ id: 3 });
    expect((await PATCH(patch({ pinned: true }), params)).status).toBe(200);
    expect(setNotePinned).toHaveBeenLastCalledWith(3, true);
    expect((await PATCH(patch({ pinned: false }), params)).status).toBe(200);
    expect(setNotePinned).toHaveBeenLastCalledWith(3, false);
  });

  it("rejects a non-boolean pinned value", async () => {
    getNote.mockResolvedValue({ id: 3 });
    const res = await PATCH(patch({ pinned: "yes" }), params);
    expect(res.status).toBe(400);
    expect(setNotePinned).not.toHaveBeenCalled();
  });
});
