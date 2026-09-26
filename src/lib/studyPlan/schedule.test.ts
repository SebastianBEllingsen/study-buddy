import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAPTER_MINUTES,
  buildSchedule,
  chapterMinutesNeeded,
  localToday,
  missedSessions,
  scheduleInputFromPlan,
  type ScheduleChapter,
  type ScheduleInput,
} from "./schedule";

// 2026-01-05 is a Monday.
const MONDAY = "2026-01-05";

function ch(id: number, overrides: Partial<ScheduleChapter> = {}): ScheduleChapter {
  return {
    id,
    position: id,
    stage: 1,
    estimatedMinutes: 120,
    level: null,
    complete: false,
    doneMinutes: 0,
    mastery: null,
    ...overrides,
  };
}

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    chapters: [],
    startDate: MONDAY,
    deadline: null,
    studyDays: [1, 2, 3, 4, 5],
    minutesPerDay: 60,
    ...overrides,
  };
}

const minutesFor = (sessions: { chapterId: number; minutes: number }[], id: number) =>
  sessions.filter((s) => s.chapterId === id).reduce((a, s) => a + s.minutes, 0);

describe("chapterMinutesNeeded", () => {
  it("scales by level, subtracts done time, and defaults an unknown estimate", () => {
    expect(chapterMinutesNeeded(ch(1))).toBe(120);
    expect(chapterMinutesNeeded(ch(1, { level: "familiar" }))).toBe(70);
    expect(chapterMinutesNeeded(ch(1, { level: "known" }))).toBe(30);
    expect(chapterMinutesNeeded(ch(1, { doneMinutes: 90 }))).toBe(30);
    expect(chapterMinutesNeeded(ch(1, { doneMinutes: 500 }))).toBe(0);
    expect(chapterMinutesNeeded(ch(1, { complete: true }))).toBe(0);
    expect(chapterMinutesNeeded(ch(1, { estimatedMinutes: null }))).toBe(DEFAULT_CHAPTER_MINUTES);
  });
});

describe("buildSchedule", () => {
  it("fills study days in stage order, skipping days off", () => {
    const { sessions, warnings } = buildSchedule(
      input({ chapters: [ch(1), ch(2, { stage: 2 })], studyDays: [1, 3] })
    );
    expect(warnings).toEqual([]);
    expect(sessions.map((s) => [s.date, s.chapterId, s.minutes])).toEqual([
      ["2026-01-05", 1, 60], // Mon
      ["2026-01-07", 1, 60], // Wed
      ["2026-01-12", 2, 60],
      ["2026-01-14", 2, 60],
    ]);
  });

  it("lets a finished chapter hand the rest of its day to the next", () => {
    const { sessions } = buildSchedule(
      input({ chapters: [ch(1, { estimatedMinutes: 90 }), ch(2, { stage: 2, estimatedMinutes: 30 })] })
    );
    expect(sessions.map((s) => [s.date, s.chapterId, s.minutes])).toEqual([
      ["2026-01-05", 1, 60],
      ["2026-01-06", 1, 30],
      ["2026-01-06", 2, 30],
    ]);
  });

  it("alternates chapters of the same stage day by day", () => {
    const { sessions } = buildSchedule(input({ chapters: [ch(1), ch(2)] }));
    expect(sessions.slice(0, 4).map((s) => s.chapterId)).toEqual([1, 2, 1, 2]);
  });

  it("never starts a later stage before the earlier one is done", () => {
    const { sessions } = buildSchedule(input({ chapters: [ch(1, { stage: 2 }), ch(2), ch(3)] }));
    const firstStage2 = sessions.findIndex((s) => s.chapterId === 1);
    const lastStage1 = sessions.map((s) => s.chapterId !== 1).lastIndexOf(true);
    expect(firstStage2).toBeGreaterThan(lastStage1);
  });

  it("schedules extra review first", () => {
    const { sessions } = buildSchedule(
      input({ chapters: [ch(1), ch(2, { stage: 2 })], extraReview: new Map([[2, 45]]) })
    );
    expect(sessions[0]).toEqual({ chapterId: 2, date: MONDAY, minutes: 45, kind: "review" });
    expect(sessions[1]).toMatchObject({ chapterId: 1, date: MONDAY, minutes: 15, kind: "study" });
  });

  it("keeps the last days before a deadline for review of the weakest chapters", () => {
    const { sessions, warnings } = buildSchedule(
      input({
        chapters: [ch(1, { mastery: 0.9 }), ch(2, { mastery: 0.2 })],
        deadline: "2026-01-30", // 20 weekdays → 2 review days
      })
    );
    expect(warnings).toEqual([]);
    const reviews = sessions.filter((s) => s.kind === "review");
    expect(reviews.map((s) => s.date)).toEqual(["2026-01-29", "2026-01-29", "2026-01-30", "2026-01-30"]);
    expect(reviews[0].chapterId).toBe(2);
    expect(minutesFor(sessions.filter((s) => s.kind === "study"), 1)).toBe(120);
  });

  it("squeezes every chapter and warns when the work doesn't fit", () => {
    const { sessions, warnings } = buildSchedule(
      input({ chapters: [ch(1, { estimatedMinutes: 300 }), ch(2, { estimatedMinutes: 300 })], deadline: "2026-01-09" })
    );
    expect(warnings).toEqual([{ type: "not_enough_time", neededMinutes: 600, availableMinutes: 300 }]);
    expect(minutesFor(sessions, 1)).toBe(150);
    expect(minutesFor(sessions, 2)).toBe(150);
    expect(sessions.every((s) => s.date <= "2026-01-09")).toBe(true);
  });

  it("ignores a deadline that has already passed, and says so", () => {
    const { sessions, warnings } = buildSchedule(input({ chapters: [ch(1)], deadline: "2025-12-01" }));
    expect(warnings).toEqual([{ type: "deadline_passed" }]);
    expect(minutesFor(sessions, 1)).toBe(120);
  });

  it("warns instead of scheduling with no study days, or with far too little time and no deadline", () => {
    expect(buildSchedule(input({ chapters: [ch(1)], studyDays: [] }))).toEqual({
      sessions: [],
      warnings: [{ type: "no_study_days" }],
    });
    const { warnings } = buildSchedule(
      input({ chapters: [ch(1, { estimatedMinutes: 12_000 })], studyDays: [0], minutesPerDay: 15 })
    );
    expect(warnings).toEqual([{ type: "too_long" }]);
  });

  it("skips finished chapters entirely", () => {
    const { sessions } = buildSchedule(input({ chapters: [ch(1, { complete: true }), ch(2)] }));
    expect(sessions.every((s) => s.chapterId === 2)).toBe(true);
  });
});

describe("scheduleInputFromPlan", () => {
  it("derives completion and done minutes from the saved plan", () => {
    const result = scheduleInputFromPlan(
      {
        options: { deadline: null, studyDays: [1], minutesPerDay: 30 },
        chapters: [
          {
            id: 1,
            position: 0,
            stage: 1,
            estimated_minutes: 60,
            current_level: "familiar",
            completed_at: null,
            subtopics: [{ done: true }],
            mastery: 0.4,
          },
          {
            id: 2,
            position: 1,
            stage: 1,
            estimated_minutes: null,
            current_level: null,
            completed_at: null,
            subtopics: [],
            mastery: null,
          },
        ],
        sessions: [
          { chapter_id: 2, minutes: 30, done_at: "2026-01-01 10:00:00" },
          { chapter_id: 2, minutes: 30, done_at: null },
        ],
      },
      MONDAY
    );
    expect(result.chapters).toEqual([
      expect.objectContaining({ id: 1, complete: true, level: "familiar", doneMinutes: 0, mastery: 0.4 }),
      expect.objectContaining({ id: 2, complete: false, doneMinutes: 30 }),
    ]);
    expect(result).toMatchObject({ startDate: MONDAY, studyDays: [1], minutesPerDay: 30 });
  });
});

describe("missedSessions / localToday", () => {
  it("finds open sessions before today", () => {
    const sessions = [
      { date: "2026-01-02", done_at: null },
      { date: "2026-01-03", done_at: "x" },
      { date: MONDAY, done_at: null },
    ];
    expect(missedSessions(sessions, MONDAY)).toEqual([sessions[0]]);
  });

  it("formats the local date", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe(MONDAY);
  });
});
