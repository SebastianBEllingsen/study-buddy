import { describe, expect, it } from "vitest";
import { chapterLastStudiedAt, isFullyLearned, revisionChapter } from "./revision";
import { chapterWhy, nextChapterStep, planDay, rankChapters, type ChapterCandidate, type TodayInput } from "./planDay";
import { PRESET_DEFAULTS } from "../studyPlan/options";
import type { StudyPlanChapter } from "../studyPlan/types";

function chapter(id: number, overrides: Partial<StudyPlanChapter> = {}): StudyPlanChapter {
  return {
    id,
    plan_id: 1,
    position: id,
    stage: 1,
    title: `Chapter ${id}`,
    summary: "",
    subtopics: [{ text: "Idea", done: true }],
    prerequisite_ids: [],
    linked_document_ids: [],
    linked_note_ids: [],
    current_level: null,
    estimated_minutes: null,
    completed_at: "2026-01-01 00:00:00",
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    resources: [],
    items: [],
    mastery: 0.9,
    ...overrides,
  };
}

const plan = (chapters: StudyPlanChapter[], practice = false) => ({
  chapters,
  options: { ...PRESET_DEFAULTS.roadmap, practice },
});

describe("isFullyLearned", () => {
  it("needs every chapter finished, and passed when practice is on", () => {
    expect(isFullyLearned(plan([chapter(1), chapter(2)]))).toBe(true);
    expect(isFullyLearned(plan([chapter(1), chapter(2, { completed_at: null, subtopics: [{ text: "x", done: false }] })]))).toBe(false);
    expect(isFullyLearned(plan([]))).toBe(false);
  });
});

describe("revisionChapter", () => {
  it("picks the weakest finished chapter, a never-tested one counting as weakest", () => {
    expect(revisionChapter(plan([chapter(1, { mastery: 0.9 }), chapter(2, { mastery: 0.4 }), chapter(3, { mastery: 0.7 })]))?.id).toBe(2);
    expect(revisionChapter(plan([chapter(1, { mastery: 0.4 }), chapter(2, { mastery: null })]))?.id).toBe(2);
  });

  it("breaks ties by who was studied longest ago, then roadmap order", () => {
    const older = chapter(1, { mastery: 0.8, completed_at: "2026-02-01 00:00:00" });
    const newer = chapter(2, { mastery: 0.8, completed_at: "2026-03-01 00:00:00" });
    expect(revisionChapter(plan([newer, older]))?.id).toBe(1);
  });

  it("is null while there is still something to learn", () => {
    const open = chapter(2, { completed_at: null, subtopics: [{ text: "x", done: false }] });
    expect(revisionChapter(plan([chapter(1), open]))).toBeNull();
  });
});

describe("chapterLastStudiedAt", () => {
  it("ignores a chapter nothing was done in", () => {
    expect(chapterLastStudiedAt(chapter(1, { completed_at: null, subtopics: [{ text: "x", done: false }] }))).toBeNull();
  });
});

describe("revision steps", () => {
  const quiz = (id: number, best_score: number | null) => ({ id, mode: "quiz" as const, title: `Quiz ${id}`, created_at: "", best_score });

  it("revisits the quiz done worst, but asks for a fresh one once every quiz is aced", () => {
    const weak = chapter(1, { items: [quiz(5, 60), quiz(6, 95)] });
    expect(nextChapterStep(weak, true, { revision: true })).toMatchObject({ type: "practice", itemId: 5 });
    const aced = chapter(1, { items: [quiz(5, 90), quiz(6, 95)] });
    expect(nextChapterStep(aced, true, { revision: true })).toMatchObject({ type: "practice", itemId: null });
    // Not revision: the same chapter just reopens its best-worst quiz.
    expect(nextChapterStep(aced, true)).toMatchObject({ itemId: 5 });
  });

  const candidate = (id: number, overrides: Partial<ChapterCandidate> = {}): ChapterCandidate => ({
    planId: 1,
    courseId: id,
    courseName: `Course ${id}`,
    chapterId: id,
    chapterTitle: `Chapter ${id}`,
    session: null,
    next: { type: "practice", itemId: null, itemTitle: null },
    ...overrides,
  });
  const none: TodayInput = {
    minutes: 45,
    courseId: null,
    reviews: { dueCards: 0, dueQuestions: 0, newCards: 0 },
    mistakes: { sure: 0, total: 0 },
    chapters: [],
    weakConcepts: [],
  };

  it("titles the step Revise and says why", () => {
    const c = candidate(1, { revision: true, mastery: 0.42 });
    expect(chapterWhy(c)).toContain("revision");
    expect(chapterWhy(c)).toContain("42%");
    const [step] = planDay({ ...none, chapters: [c] });
    expect(step.title).toBe("Revise: Chapter 1");
    expect(step.generateQuiz).toEqual({ planId: 1, chapterId: 1 });
  });

  it("ranks new learning ahead of revision, but a deadline still comes first", () => {
    const ranked = rankChapters([
      candidate(1, { revision: true }),
      candidate(2),
      candidate(3, { revision: true, deadline: "2026-04-01" }),
    ]);
    expect(ranked.map((c) => c.chapterId)).toEqual([3, 2, 1]);
  });
});
