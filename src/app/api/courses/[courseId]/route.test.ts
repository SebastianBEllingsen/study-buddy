import { describe, it, expect, vi, beforeEach } from "vitest";

const order: string[] = [];
const getCourse = vi.fn();
const deleteCourse = vi.fn(async () => {
  order.push("deleteCourse");
});
const renameCourse = vi.fn();
vi.mock("@/lib/models", () => ({
  listCourseMediaText: vi.fn(async () => []),
  deleteCourse: () => deleteCourse(),
  getCourse: (...a: unknown[]) => getCourse(...a),
  listCanvasesForCourse: vi.fn(),
  listDocumentSummariesForCourse: vi.fn(),
  listFoldersForCourse: vi.fn(),
  listGeneratedItemSummariesForCourse: vi.fn(),
  listNotesForCourse: vi.fn(),
  renameCourse: (...a: unknown[]) => renameCourse(...a),
  updateCourseCustomization: vi.fn(),
}));
vi.mock("@/lib/blobStorage/cleanup", () => ({
  cleanupReplacedImage: vi.fn(),
  removeUnreferencedBlobs: vi.fn(),
}));
vi.mock("@/lib/uploads", () => ({ courseUploadsDirPath: () => "/nonexistent/uploads" }));
const getStudyPlanForCourse = vi.fn();
vi.mock("@/lib/studyPlan/store", () => ({ getStudyPlanForCourse: (...a: unknown[]) => getStudyPlanForCourse(...a) }));
vi.mock("@/lib/readiness/load", () => ({ getExamDate: vi.fn() }));
const removePlanFromGoogle = vi.fn(async (planId: number) => {
  void planId;
  order.push("removePlanFromGoogle");
});
vi.mock("@/lib/studyPlan/scheduleService", () => ({ removePlanFromGoogle: (planId: number) => removePlanFromGoogle(planId) }));

const { PATCH, DELETE } = await import("./route");

const params = { params: Promise.resolve({ courseId: "7" }) };

beforeEach(() => {
  order.length = 0;
  getCourse.mockReset();
  renameCourse.mockReset();
  getStudyPlanForCourse.mockReset();
  removePlanFromGoogle.mockClear();
  deleteCourse.mockClear();
});

describe("DELETE /api/courses/[courseId]", () => {
  it("takes the study plan's Google Calendar events off before the course (and the record of them) goes", async () => {
    getCourse.mockResolvedValue({ id: 7, cover_image: null, icon_image: null, page_background_image: null });
    getStudyPlanForCourse.mockResolvedValue({ id: 31 });
    const res = await DELETE(new Request("http://localhost/api/courses/7", { method: "DELETE" }), params);
    expect(res.status).toBe(204);
    expect(removePlanFromGoogle).toHaveBeenCalledWith(31);
    expect(order).toEqual(["removePlanFromGoogle", "deleteCourse"]);
  });

  it("still deletes the course when removing the events fails", async () => {
    getCourse.mockResolvedValue({ id: 7, cover_image: null, icon_image: null, page_background_image: null });
    getStudyPlanForCourse.mockResolvedValue({ id: 31 });
    removePlanFromGoogle.mockRejectedValueOnce(new Error("offline"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await DELETE(new Request("http://localhost/api/courses/7", { method: "DELETE" }), params);
    expect(res.status).toBe(204);
    expect(deleteCourse).toHaveBeenCalled();
    error.mockRestore();
  });

  it("does not touch Google for a course without a plan", async () => {
    getCourse.mockResolvedValue({ id: 7, cover_image: null, icon_image: null, page_background_image: null });
    getStudyPlanForCourse.mockResolvedValue(undefined);
    await DELETE(new Request("http://localhost/api/courses/7", { method: "DELETE" }), params);
    expect(removePlanFromGoogle).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/courses/[courseId]", () => {
  it("answers 404 for a course that doesn't exist, instead of reporting a change", async () => {
    getCourse.mockResolvedValue(undefined);
    const res = await PATCH(
      new Request("http://localhost/api/courses/7", { method: "PATCH", body: JSON.stringify({ name: "New" }) }),
      params
    );
    expect(res.status).toBe(404);
    expect(renameCourse).not.toHaveBeenCalled();
  });
});
