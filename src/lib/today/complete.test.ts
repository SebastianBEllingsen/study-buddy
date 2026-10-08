import { describe, it, expect, vi, beforeEach } from "vitest";

const store = {
  addDoneSession: vi.fn(),
  addSessionMinutes: vi.fn(),
  findChapterSession: vi.fn(),
  getChapter: vi.fn(),
  getSession: vi.fn(),
  setSessionDone: vi.fn(),
  updateChapter: vi.fn(),
  updateResource: vi.fn(),
};
vi.mock("../studyPlan/store", () => store);
const findChapterInPlan = vi.fn();
const findResourceInPlan = vi.fn();
vi.mock("../studyPlan/ownership", () => ({
  findChapterInPlan: (...a: unknown[]) => findChapterInPlan(...a),
  findResourceInPlan: (...a: unknown[]) => findResourceInPlan(...a),
}));
const chapterWasComplete = vi.fn();
const rescheduleIfFinishedChanged = vi.fn();
vi.mock("../studyPlan/scheduleService", () => ({
  chapterWasComplete: (...a: unknown[]) => chapterWasComplete(...a),
  rescheduleIfFinishedChanged: (...a: unknown[]) => rescheduleIfFinishedChanged(...a),
}));

const { completeStep } = await import("./complete");

beforeEach(() => {
  vi.resetAllMocks();
  findChapterInPlan.mockResolvedValue({ id: 4, plan_id: 2 });
  findResourceInPlan.mockResolvedValue({ id: 7, chapter_id: 4 });
  chapterWasComplete.mockResolvedValue(false);
});

describe("completing a session whose id was replaced by a reschedule", () => {
  it("ticks off the chapter's session for today instead", async () => {
    store.getSession.mockResolvedValue(undefined);
    store.findChapterSession.mockResolvedValue({ id: 99, minutes: 60 });
    expect(await completeStep({ type: "session", planId: 2, sessionId: 9, chapterId: 4, minutes: 40 })).toBe(true);
    expect(store.setSessionDone).toHaveBeenCalledWith(99, true, 40);
  });

  it("is still a success when the chapter has no session left today", async () => {
    store.getSession.mockResolvedValue(undefined);
    store.findChapterSession.mockResolvedValue(undefined);
    expect(await completeStep({ type: "session", planId: 2, sessionId: 9, chapterId: 4 })).toBe(true);
    expect(store.setSessionDone).not.toHaveBeenCalled();
  });

  it("is not found without a chapter to fall back on, or when the chapter isn't in the plan", async () => {
    store.getSession.mockResolvedValue(undefined);
    expect(await completeStep({ type: "session", planId: 2, sessionId: 9 })).toBe(false);
    findChapterInPlan.mockResolvedValue(null);
    expect(await completeStep({ type: "session", planId: 2, sessionId: 9, chapterId: 4 })).toBe(false);
  });

  it("never touches another plan's session", async () => {
    store.getSession.mockResolvedValue({ id: 9, plan_id: 5, minutes: 30 });
    expect(await completeStep({ type: "session", planId: 2, sessionId: 9 })).toBe(false);
    expect(store.setSessionDone).not.toHaveBeenCalled();
  });
});

describe("recording study for the plan's Today frequency", () => {
  it("adds a finished session for study done on a day with none scheduled", async () => {
    store.findChapterSession.mockResolvedValue(undefined);
    await completeStep({ type: "progress", planId: 2, resourceId: 7, minutes: 23 });
    expect(store.updateResource).not.toHaveBeenCalled();
    expect(store.addDoneSession).toHaveBeenCalledWith(2, 4, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 23);
  });

  it("leaves a scheduled session for finishing the Today session to tick off", async () => {
    store.findChapterSession.mockResolvedValue({ id: 50, done_at: null });
    await completeStep({ type: "progress", planId: 2, resourceId: 7, minutes: 23 });
    expect(store.setSessionDone).not.toHaveBeenCalled();
    expect(store.addDoneSession).not.toHaveBeenCalled();
  });

  it("adds later steps' time to the session Today recorded earlier that day", async () => {
    store.findChapterSession.mockResolvedValue({ id: 50, done_at: "2026-03-02 09:00:00", created_at: "2026-03-02 09:00:00" });
    await completeStep({ type: "progress", planId: 2, resourceId: 7, minutes: 20 });
    expect(store.addSessionMinutes).toHaveBeenCalledWith(50, 20);
    expect(store.addDoneSession).not.toHaveBeenCalled();
  });

  it("never credits one step with more than four hours", async () => {
    store.findChapterSession.mockResolvedValue(undefined);
    await completeStep({ type: "progress", planId: 2, resourceId: 7, minutes: 5000 });
    expect(store.addDoneSession).toHaveBeenCalledWith(2, 4, expect.any(String), 240);
  });

  it("doesn't count the same day twice", async () => {
    store.findChapterSession.mockResolvedValue({ id: 50, done_at: "2026-03-02 09:00:00", created_at: "2026-03-01 08:00:00" });
    await completeStep({ type: "resource", planId: 2, resourceId: 7, minutes: 23 });
    expect(store.updateResource).toHaveBeenCalledWith(7, { done: true });
    expect(store.setSessionDone).not.toHaveBeenCalled();
    expect(store.addDoneSession).not.toHaveBeenCalled();
  });

  it("records a ticked subtopic, and reschedules when it finishes the chapter", async () => {
    store.getChapter.mockResolvedValue({ id: 4, subtopics: [{ text: "a", done: false }] });
    store.findChapterSession.mockResolvedValue(undefined);
    expect(await completeStep({ type: "subtopic", planId: 2, chapterId: 4, index: 0, minutes: 15 })).toBe(true);
    expect(store.updateChapter).toHaveBeenCalledWith(4, { subtopics: [{ text: "a", done: true }] });
    expect(store.addDoneSession).toHaveBeenCalledWith(2, 4, expect.any(String), 15);
    expect(rescheduleIfFinishedChanged).toHaveBeenCalledWith(2, 4, false);
  });

  it("records nothing when the step carries no minutes and no session exists", async () => {
    store.findChapterSession.mockResolvedValue(undefined);
    await completeStep({ type: "progress", planId: 2, resourceId: 7 });
    expect(store.addDoneSession).not.toHaveBeenCalled();
  });
});
