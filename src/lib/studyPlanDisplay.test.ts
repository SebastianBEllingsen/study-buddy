import { describe, expect, it } from "vitest";
import type { StudyPlanChapter, StudyPlanResource } from "./studyPlan/types";
import {
  buildIsStuck,
  canBuildPlan,
  chapterIsComplete,
  formatMinutes,
  groupSessionsByWeek,
  linksAreStale,
  nextChapter,
  planProgress,
  scheduleWarningText,
  weekStart,
} from "./studyPlanDisplay";

function resource(overrides: Partial<StudyPlanResource> = {}): StudyPlanResource {
  return {
    id: 1,
    chapter_id: 1,
    position: 0,
    kind: "article",
    title: "R",
    url: "https://example.org",
    provider: null,
    language: null,
    note: "",
    origin: "ai",
    link_status: "ok",
    status_detail: null,
    checked_at: null,
    done_at: null,
    created_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

function chapter(overrides: Partial<StudyPlanChapter> = {}): StudyPlanChapter {
  return {
    id: 1,
    plan_id: 1,
    position: 0,
    stage: 1,
    title: "C",
    summary: "",
    subtopics: [],
    prerequisite_ids: [],
    linked_document_ids: [],
    current_level: null,
    estimated_minutes: null,
    completed_at: null,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    resources: [],
    items: [],
    mastery: null,
    ...overrides,
  };
}

describe("chapterIsComplete", () => {
  it("is complete when marked done or every subtopic is ticked", () => {
    expect(chapterIsComplete(chapter({ completed_at: "2026-01-02 00:00:00" }))).toBe(true);
    expect(chapterIsComplete(chapter({ subtopics: [{ text: "a", done: true }] }))).toBe(true);
    expect(chapterIsComplete(chapter({ subtopics: [{ text: "a", done: true }, { text: "b", done: false }] }))).toBe(false);
    expect(chapterIsComplete(chapter())).toBe(false);
  });
});

describe("planProgress", () => {
  it("counts ticked subtopics and done resources, and a done chapter counts in full", () => {
    const progress = planProgress({
      chapters: [
        chapter({ id: 1, subtopics: [{ text: "a", done: true }, { text: "b", done: false }], resources: [resource({ done_at: "x" })] }),
        chapter({ id: 2, completed_at: "x", subtopics: [{ text: "c", done: false }], resources: [resource()] }),
      ],
    });
    expect(progress).toEqual({ chaptersDone: 1, chaptersTotal: 2, stepsDone: 4, stepsTotal: 5, fraction: 0.8 });
  });

  it("is zero for an empty plan", () => {
    expect(planProgress({ chapters: [] }).fraction).toBe(0);
  });
});

describe("nextChapter", () => {
  it("returns the first unfinished chapter in stage order", () => {
    const plan = {
      chapters: [
        chapter({ id: 1, position: 0, stage: 1, completed_at: "x" }),
        chapter({ id: 2, position: 1, stage: 3 }),
        chapter({ id: 3, position: 2, stage: 2 }),
      ],
    };
    expect(nextChapter(plan)?.id).toBe(3);
    expect(nextChapter({ chapters: [chapter({ completed_at: "x" })] })).toBeNull();
  });
});

describe("linksAreStale", () => {
  const now = new Date("2026-03-20T12:00:00Z");
  const withLinks = [chapter({ resources: [resource()] })];

  it("is stale when never checked or checked over two weeks ago", () => {
    expect(linksAreStale({ chapters: withLinks, links_checked_at: null }, now)).toBe(true);
    expect(linksAreStale({ chapters: withLinks, links_checked_at: "2026-03-01 12:00:00" }, now)).toBe(true);
    expect(linksAreStale({ chapters: withLinks, links_checked_at: "2026-03-15 12:00:00" }, now)).toBe(false);
  });

  it("is never stale for a plan without links", () => {
    expect(linksAreStale({ chapters: [chapter()], links_checked_at: null }, now)).toBe(false);
  });
});

describe("buildIsStuck / canBuildPlan", () => {
  const now = new Date("2026-03-20T12:00:00Z");

  it("treats a long-silent build as stuck and retryable", () => {
    expect(buildIsStuck({ status: "generating", updated_at: "2026-03-20 11:30:00" }, now)).toBe(true);
    expect(buildIsStuck({ status: "generating", updated_at: "2026-03-20 11:58:00" }, now)).toBe(false);
    expect(buildIsStuck({ status: "ready", updated_at: "2020-01-01 00:00:00" }, now)).toBe(false);
  });

  it("allows building a draft, a failed plan, or a stuck one — not a ready or running one", () => {
    expect(canBuildPlan({ status: "draft_topics", updated_at: "2026-03-20 11:59:00" }, now)).toBe(true);
    expect(canBuildPlan({ status: "failed", updated_at: "2026-03-20 11:59:00" }, now)).toBe(true);
    expect(canBuildPlan({ status: "generating", updated_at: "2026-03-20 11:00:00" }, now)).toBe(true);
    expect(canBuildPlan({ status: "generating", updated_at: "2026-03-20 11:59:00" }, now)).toBe(false);
    expect(canBuildPlan({ status: "ready", updated_at: "2026-03-20 11:59:00" }, now)).toBe(false);
  });
});

describe("schedule display helpers", () => {
  it("finds the Monday of a week", () => {
    expect(weekStart("2026-01-05")).toBe("2026-01-05");
    expect(weekStart("2026-01-11")).toBe("2026-01-05"); // Sunday
    expect(weekStart("2026-01-07")).toBe("2026-01-05");
  });

  it("groups sessions into this week, next week, and later weeks", () => {
    const weeks = groupSessionsByWeek(
      [{ date: "2026-01-20" }, { date: "2026-01-06" }, { date: "2026-01-13" }, { date: "2026-01-08" }],
      "2026-01-06"
    );
    expect(weeks.map((w) => [w.label, w.sessions.map((s) => s.date)])).toEqual([
      ["this", ["2026-01-06", "2026-01-08"]],
      ["next", ["2026-01-13"]],
      ["2026-01-19", ["2026-01-20"]],
    ]);
  });

  it("formats minutes", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(95)).toBe("1 h 35 min");
  });

  it("explains a shortfall in time", () => {
    expect(scheduleWarningText({ type: "not_enough_time", neededMinutes: 600, availableMinutes: 300 })).toMatch(
      /^About 5 h of study doesn't fit/
    );
  });
});
