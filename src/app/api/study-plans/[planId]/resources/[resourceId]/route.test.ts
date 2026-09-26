import { describe, it, expect, vi, beforeEach } from "vitest";

const getChapterRow = vi.fn();
const getResourceRow = vi.fn();
const updateResource = vi.fn();
const setResourceLinkCheck = vi.fn();
const deleteResource = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({
  getChapterRow: (...a: unknown[]) => getChapterRow(...a),
  getResourceRow: (...a: unknown[]) => getResourceRow(...a),
  updateResource: (...a: unknown[]) => updateResource(...a),
  setResourceLinkCheck: (...a: unknown[]) => setResourceLinkCheck(...a),
  deleteResource: (...a: unknown[]) => deleteResource(...a),
}));
const verifyLink = vi.fn();
vi.mock("@/lib/linkVerifier", () => ({ verifyLink: (...a: unknown[]) => verifyLink(...a) }));

const { PATCH, DELETE } = await import("./route");

function patch(body: unknown): Request {
  return new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) });
}
const params = { params: Promise.resolve({ planId: "1", resourceId: "7" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getResourceRow.mockResolvedValue({ id: 7, chapter_id: 5, url: "https://example.org/a", kind: "article" });
  getChapterRow.mockResolvedValue({ id: 5, plan_id: 1 });
  verifyLink.mockResolvedValue({ status: "ok", detail: null, finalUrl: "https://example.org/b" });
});

describe("PATCH /api/study-plans/[planId]/resources/[resourceId]", () => {
  it("404s for a resource in another plan's chapter", async () => {
    getChapterRow.mockResolvedValue({ id: 5, plan_id: 2 });
    expect((await PATCH(patch({ done: true }), params)).status).toBe(404);
    expect(updateResource).not.toHaveBeenCalled();
  });

  it("marks done without re-checking the link", async () => {
    expect((await PATCH(patch({ done: true }), params)).status).toBe(200);
    expect(updateResource).toHaveBeenCalledWith(7, { done: true });
    expect(verifyLink).not.toHaveBeenCalled();
  });

  it("re-checks a changed link", async () => {
    await PATCH(patch({ url: "https://example.org/b" }), params);
    expect(verifyLink).toHaveBeenCalledWith("https://example.org/b", "article");
    expect(setResourceLinkCheck).toHaveBeenCalledWith(7, { status: "ok", detail: null, url: "https://example.org/b" });
  });

  it("400s on a non-http link", async () => {
    expect((await PATCH(patch({ url: "javascript:alert(1)" }), params)).status).toBe(400);
  });
});

describe("DELETE /api/study-plans/[planId]/resources/[resourceId]", () => {
  it("deletes a resource of this plan", async () => {
    expect((await DELETE(new Request("http://localhost/x"), params)).status).toBe(200);
    expect(deleteResource).toHaveBeenCalledWith(7);
  });
});
