import { describe, it, expect, vi, beforeEach } from "vitest";

const generateStructured = vi.fn();
vi.mock("../aiClient", () => ({ generateStructured: (...a: unknown[]) => generateStructured(...a) }));
vi.mock("../models", () => ({
  getAppSettings: async () => ({ aiEfficiencyMode: false, preferredLanguage: "en" }),
}));
const reschedulePlan = vi.fn();
vi.mock("./scheduleService", () => ({ reschedulePlan: (...a: unknown[]) => reschedulePlan(...a) }));
const getStudyPlan = vi.fn();
vi.mock("./store", () => ({ getStudyPlan: (...a: unknown[]) => getStudyPlan(...a) }));

const { replanStudyPlan } = await import("./replan");

const chapter = (id: number, position: number, mastery: number | null) => ({
  id,
  position,
  stage: 1,
  title: `Chapter ${id}`,
  subtopics: [],
  completed_at: null,
  current_level: null,
  mastery,
});

beforeEach(() => {
  vi.clearAllMocks();
  getStudyPlan.mockResolvedValue({
    id: 1,
    options: { deadline: "2099-06-01" },
    chapters: [chapter(10, 0, 0.3), chapter(11, 1, 0.95)],
    sessions: [{ chapter_id: 10, date: "2000-01-01", done_at: null, minutes: 60 }],
  });
  reschedulePlan.mockResolvedValue({ warnings: [] });
});

describe("replanStudyPlan", () => {
  it("turns the AI's adjustments into extra review for real chapters", async () => {
    generateStructured.mockResolvedValue({
      adjustments: [
        { chapter: 1, extraReviewMinutes: 60 },
        { chapter: 7, extraReviewMinutes: 60 },
      ],
      message: "Chapter 1 needs another look.",
    });
    const result = await replanStudyPlan(1);
    expect(reschedulePlan).toHaveBeenCalledWith(1, new Map([[10, 60]]));
    expect(result).toEqual({
      message: "Chapter 1 needs another look.",
      warnings: [],
      extraReview: [{ chapterId: 10, minutes: 60 }],
    });
    const { user } = generateStructured.mock.calls[0][0];
    expect(user).toContain("1. Chapter 10 — not finished, mastery 30%, 1 missed session");
    expect(user).toContain("Deadline: 2099-06-01");
  });

  it("still reschedules when the AI isn't available", async () => {
    generateStructured.mockRejectedValue(new Error("AI off"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await replanStudyPlan(1);
    expect(reschedulePlan).toHaveBeenCalledWith(1, new Map());
    expect(result.message).toBe("Moved 1 missed session forward from today.");
  });
});
