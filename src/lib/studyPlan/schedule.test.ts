import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAPTER_MINUTES,
  buildSchedule,
  carriedExtraReview,
  learnedPace,
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
    // Chapter 1 is untouched but already tested at 90%: 25% of 120.
    expect(minutesFor(sessions.filter((s) => s.kind === "study"), 1)).toBe(30);
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

describe("carriedExtraReview", () => {
  const s = (chapter_id: number, date: string, kind: "study" | "review", done_at: string | null = null) => ({
    chapter_id,
    date,
    minutes: 30,
    kind,
    done_at,
  });

  it("keeps open review sessions that come before the first study session", () => {
    const sessions = [
      s(1, "2026-01-05", "review"),
      s(1, "2026-01-06", "review"),
      s(2, "2026-01-06", "review"),
      s(1, "2026-01-07", "study"),
      s(2, "2026-01-30", "review"), // a final review day
    ];
    expect(carriedExtraReview(sessions)).toEqual(
      new Map([
        [1, 60],
        [2, 30],
      ])
    );
  });

  it("ignores finished sessions and carries nothing when no study is left", () => {
    expect(carriedExtraReview([s(1, "2026-01-05", "review", "x"), s(1, "2026-01-07", "study")])).toEqual(new Map());
    expect(carriedExtraReview([s(1, "2026-01-05", "review")])).toEqual(new Map());
  });
});

describe("checks, diagnostics and pace", () => {
  it("adds a short check session for a studied chapter that hasn't passed, before the next stage", () => {
    const { sessions } = buildSchedule(
      input({ chapters: [ch(1, { complete: true, needsCheck: true }), ch(2, { stage: 2 })] })
    );
    expect(sessions[0]).toEqual({ chapterId: 1, date: MONDAY, minutes: 20, kind: "check" });
    expect(sessions[1]).toMatchObject({ chapterId: 2, date: MONDAY, kind: "study" });
  });

  it("needs nothing more from a passed chapter", () => {
    expect(chapterMinutesNeeded(ch(1, { complete: true, needsCheck: false }))).toBe(0);
  });

  it("uses a good early test result to shrink an unstarted chapter, not a poor one", () => {
    expect(chapterMinutesNeeded(ch(1, { mastery: 0.9 }))).toBe(30);
    expect(chapterMinutesNeeded(ch(1, { mastery: 0.75 }))).toBe(70);
    expect(chapterMinutesNeeded(ch(1, { mastery: 0.3, level: "known" }))).toBe(120);
    // Starting the chapter doesn't bring the claimed level's estimate back.
    expect(chapterMinutesNeeded(ch(1, { mastery: 0.9, doneMinutes: 15 }))).toBe(15);
    expect(chapterMinutesNeeded(ch(1, { mastery: 0.9, doneMinutes: 15, progress: 0.1 }))).toBeLessThan(60);
  });

  it("measures pace against the same factor the chapter was scheduled with", () => {
    // Pre-tested as known (30 of 120 minutes), finished in 30: exactly as estimated.
    const finished = (id: number) => ch(id, { complete: true, doneMinutes: 30, mastery: 0.9 });
    expect(learnedPace([finished(1), finished(2)])).toBe(1);
  });

  it("doesn't grow a check session on repeated reschedules", () => {
    const chapters = [ch(1, { complete: true, needsCheck: true }), ch(2, { stage: 2, prerequisites: [1] })];
    let extra: Map<number, number> | undefined;
    for (let round = 0; round < 3; round++) {
      const { sessions } = buildSchedule(input({ chapters, minutesPerDay: 20, extraReview: extra }));
      expect(sessions.filter((s) => s.kind === "check").reduce((n, s) => n + s.minutes, 0)).toBe(20);
      extra = carriedExtraReview(sessions.map((s) => ({ chapter_id: s.chapterId, date: s.date, minutes: s.minutes, kind: s.kind, done_at: null })));
      expect(extra).toEqual(new Map());
    }
  });

  it("keeps giving an unfinished chapter time after its estimate is used up", () => {
    expect(chapterMinutesNeeded(ch(1, { doneMinutes: 120, progress: 0.5 }))).toBe(120); // projected: 240 in all
    expect(chapterMinutesNeeded(ch(1, { doneMinutes: 150, progress: 0.99 }))).toBe(15);
  });

  it("learns the student's pace from finished chapters", () => {
    const finished = (id: number, done: number) => ch(id, { complete: true, doneMinutes: done });
    expect(learnedPace([finished(1, 240)])).toBe(1); // too few to say
    expect(learnedPace([finished(1, 240), finished(2, 240), ch(3)])).toBe(2);
    expect(learnedPace([finished(1, 30), finished(2, 30)])).toBe(0.5); // clamped
    const { sessions } = buildSchedule(
      input({ chapters: [finished(1, 240), finished(2, 240), ch(3, { stage: 2 })] })
    );
    expect(sessions.reduce((n, s) => n + s.minutes, 0)).toBe(240); // 120 × 2
  });
});

describe("prerequisites", () => {
  it("lets a chapter start once what it builds on is done, not the whole earlier stage", () => {
    // Stage 1: chapters 1 (120) and 2 (120). Chapter 3 (stage 2) builds only on 1.
    const { sessions } = buildSchedule(
      input({
        chapters: [ch(1), ch(2), ch(3, { stage: 2, prerequisites: [1] })],
        minutesPerDay: 120,
      })
    );
    // Day 1: chapter 1 finishes; chapter 3 can start before chapter 2 is done.
    expect(sessions.filter((s) => s.date === "2026-01-06").map((s) => s.chapterId)).toContain(3);
    const lastOf2 = sessions.filter((s) => s.chapterId === 2).map((s) => s.date).sort().pop() as string;
    const firstOf3 = sessions.find((s) => s.chapterId === 3)?.date as string;
    expect(firstOf3 <= lastOf2).toBe(true);
    // ...but never before its own prerequisite is finished.
    const lastOf1 = sessions.filter((s) => s.chapterId === 1).map((s) => s.date).sort().pop() as string;
    expect(firstOf3 >= lastOf1).toBe(true);
  });

  it("still waits for the whole earlier stage when a chapter has no known prerequisites", () => {
    const { sessions } = buildSchedule(input({ chapters: [ch(1), ch(2), ch(3, { stage: 2, prerequisites: [] })] }));
    const firstOf3 = sessions.findIndex((s) => s.chapterId === 3);
    const lastEarlier = sessions.map((s) => s.chapterId !== 3).lastIndexOf(true);
    expect(firstOf3).toBeGreaterThan(lastEarlier);
  });

  it("treats a prerequisite that needs no work as already done", () => {
    const { sessions } = buildSchedule(
      input({ chapters: [ch(1, { complete: true }), ch(2, { stage: 2, prerequisites: [1] })] })
    );
    expect(sessions[0]).toMatchObject({ chapterId: 2, date: MONDAY });
  });
});
