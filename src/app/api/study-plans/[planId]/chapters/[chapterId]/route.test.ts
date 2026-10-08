import { describe, it, expect, vi, beforeEach } from "vitest";

const getChapterRow = vi.fn();
const getStudyPlan = vi.fn();
const updateChapter = vi.fn();
const deleteChapter = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({
  getChapterRow: (...a: unknown[]) => getChapterRow(...a),
  getResourceRow: vi.fn(),
  getStudyPlan: (...a: unknown[]) => getStudyPlan(...a),
  updateChapter: (...a: unknown[]) => updateChapter(...a),
  deleteChapter: (...a: unknown[]) => deleteChapter(...a),
}));
const listDocumentSummariesForCourse = vi.fn();
vi.mock("@/lib/models", () => ({
  listDocumentSummariesForCourse: (...a: unknown[]) => listDocumentSummariesForCourse(...a),
}));

const rescheduleQuietly = vi.fn();
const rescheduleIfFinishedChanged = vi.fn();
const removeChapterFromGoogle = vi.fn();
vi.mock("@/lib/studyPlan/scheduleService", () => ({
  rescheduleQuietly: (...a: unknown[]) => rescheduleQuietly(...a),
  chapterWasComplete: async () => false,
  removeChapterFromGoogle: (...a: unknown[]) => removeChapterFromGoogle(...a),
  rescheduleIfFinishedChanged: (...a: unknown[]) => rescheduleIfFinishedChanged(...a),
}));

const { PATCH, DELETE } = await import("./route");

function patch(body: unknown): Request {
  return new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) });
}
const params = (planId = "1", chapterId = "5") => ({ params: Promise.resolve({ planId, chapterId }) });

beforeEach(() => {
  vi.clearAllMocks();
  getChapterRow.mockResolvedValue({ id: 5, plan_id: 1 });
  getStudyPlan.mockResolvedValue({ id: 1, course_id: 3, options: { schedule: false } });
  listDocumentSummariesForCourse.mockResolvedValue([{ id: 10 }, { id: 11 }]);
});

describe("PATCH /api/study-plans/[planId]/chapters/[chapterId]", () => {
  it("404s for a chapter that belongs to a different plan, without writing", async () => {
    getChapterRow.mockResolvedValue({ id: 5, plan_id: 2 });
    expect((await PATCH(patch({ title: "X" }), params())).status).toBe(404);
    expect(updateChapter).not.toHaveBeenCalled();
  });

  it("404s for non-numeric ids", async () => {
    expect((await PATCH(patch({ title: "X" }), params("abc"))).status).toBe(404);
  });

  it("400s on an invalid patch", async () => {
    expect((await PATCH(patch({ stage: 0 }), params())).status).toBe(400);
    expect(updateChapter).not.toHaveBeenCalled();
  });

  it("only links documents from the plan's own course", async () => {
    const res = await PATCH(patch({ linkedDocumentIds: [10, 99, 11] }), params());
    expect(res.status).toBe(200);
    expect(listDocumentSummariesForCourse).toHaveBeenCalledWith(3);
    expect(updateChapter).toHaveBeenCalledWith(5, { linked_document_ids: [10, 11] });
  });
});

describe("DELETE /api/study-plans/[planId]/chapters/[chapterId]", () => {
  it("deletes a chapter of this plan and 404s for another plan's", async () => {
    expect((await DELETE(new Request("http://localhost/x"), params())).status).toBe(200);
    expect(deleteChapter).toHaveBeenCalledWith(5);
    getChapterRow.mockResolvedValue({ id: 5, plan_id: 9 });
    expect((await DELETE(new Request("http://localhost/x"), params())).status).toBe(404);
  });
});

describe("deleting a chapter that has calendar events", () => {
  it("takes its events out of Google Calendar before the chapter (and so their ids) is gone", async () => {
    const order: string[] = [];
    removeChapterFromGoogle.mockImplementation(async () => void order.push("calendar"));
    deleteChapter.mockImplementation(async () => void order.push("chapter"));
    await DELETE(new Request("http://localhost/x"), params());
    expect(removeChapterFromGoogle).toHaveBeenCalledWith(1, 5);
    expect(order).toEqual(["calendar", "chapter"]);
  });
});

describe("rescheduling after chapter changes", () => {
  it("doesn't reschedule when an edit sends the stage back unchanged", async () => {
    getChapterRow.mockResolvedValue({ id: 5, plan_id: 1, stage: 2, current_level: null, completed_at: null });
    getStudyPlan.mockResolvedValue({ id: 1, course_id: 3, options: { schedule: true } });
    await PATCH(patch({ title: "Renamed", stage: 2 }), params());
    expect(rescheduleQuietly).not.toHaveBeenCalled();
    await PATCH(patch({ stage: 3 }), params());
    expect(rescheduleQuietly).toHaveBeenCalledWith(1);
  });

  it("reschedules a scheduled plan when a chapter is finished or deleted, and checks a checklist tick for finishing it", async () => {
    getStudyPlan.mockResolvedValue({ id: 1, course_id: 3, options: { schedule: true } });
    await PATCH(patch({ subtopics: [{ text: "a", done: true }] }), params());
    expect(rescheduleQuietly).not.toHaveBeenCalled();
    expect(rescheduleIfFinishedChanged).toHaveBeenCalledWith(1, 5, false);
    await PATCH(patch({ completed: true }), params());
    expect(rescheduleQuietly).toHaveBeenCalledWith(1);
    await DELETE(new Request("http://localhost/x"), params());
    expect(rescheduleQuietly).toHaveBeenCalledTimes(2);
  });
});
