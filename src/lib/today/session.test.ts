import { describe, expect, it } from "vitest";
import { DEFAULT_POMODORO_SETTINGS, initialPomodoroState, startTimer } from "../pomodoro";
import type { TodayStep } from "./planDay";
import {
  currentStep,
  finishedPlanSessions,
  markDoneForToday,
  mergeFresh,
  newChapterQuizSteps,
  parseSession,
  sessionFocusMs,
  sessionProgress,
  setStepStatus,
  snoozeStep,
  startSession,
  stepForLocation,
  stepGroup,
  studiedMinutes,
} from "./session";

function step(id: string, kind: TodayStep["kind"], extra: Partial<TodayStep> = {}): TodayStep {
  return {
    id,
    kind,
    title: id,
    detail: "",
    minutes: 10,
    href: `/${id}`,
    external: false,
    courseName: null,
    completion: null,
    sessionId: null,
    ...extra,
  };
}

const base = [
  step("reviews", "reviews", { href: "/review" }),
  step("mistakes", "mistakes"),
  step("chapter:5:resource:9", "chapter", { minutes: 25, sessionId: { planId: 1, sessionId: 40 } }),
  step("concept:2:graphs", "concept"),
];
const start = () => startSession({ date: "2026-03-02", courseId: null, minutes: 60, steps: base, now: 1 });

describe("stepGroup", () => {
  it("groups a chapter's steps together", () => {
    expect(stepGroup(step("chapter:5:subtopic:1", "chapter"))).toBe("chapter:5");
    expect(stepGroup(step("reviews", "reviews"))).toBe("reviews");
  });
});

describe("mergeFresh", () => {
  it("ticks off work that's gone, keeps concepts, and brings up the chapter's next step in its slot", () => {
    const merged = mergeFresh(start(), [
      step("mistakes", "mistakes", { title: "Redo 2" }),
      step("chapter:5:subtopic:0", "chapter", { minutes: 40 }),
      step("chapter:8:resource:1", "chapter"),
    ]);
    expect(merged.steps.map((s) => [s.id, s.status])).toEqual([
      ["reviews", "done"],
      ["mistakes", "pending"],
      ["chapter:5:resource:9", "done"],
      ["concept:2:graphs", "pending"],
      ["chapter:5:subtopic:0", "pending"],
    ]);
    expect(merged.steps[1].title).toBe("Redo 2");
    expect(merged.steps[4].minutes).toBe(25);
  });

  it("drops a chapter step whose plan session was ticked off in the plan, instead of marking it done", () => {
    const sessionId = { planId: 1, sessionId: 40 };
    const s = startSession({
      date: "2026-01-05",
      courseId: null,
      minutes: 60,
      now: 0,
      steps: [step("chapter:5:resource:9", "chapter", { sessionId }), step("reviews", "reviews")],
    });
    const merged = mergeFresh(s, [step("reviews", "reviews")], [sessionId]);
    expect(merged.steps.map((x) => x.id)).toEqual(["reviews"]);
    expect(finishedPlanSessions(merged)).toEqual([]);
  });

  it("still ticks off a chapter step that's gone when its plan session wasn't ticked off", () => {
    const merged = mergeFresh(start(), [step("mistakes", "mistakes")]);
    expect(merged.steps.find((x) => x.id === "chapter:5:resource:9")?.status).toBe("done");
  });

  it("doesn't re-add a step already in the session, and returns the same object when nothing changed", () => {
    const s = setStepStatus(start(), "reviews", "done");
    const merged = mergeFresh(s, base);
    expect(merged.steps.filter((x) => x.id === "reviews")).toHaveLength(1);
    expect(mergeFresh(merged, base)).toBe(merged);
  });
});

describe("finished plan sessions", () => {
  it("carry the chapter, so a session replaced by a reschedule can still be found", () => {
    const s = setStepStatus(
      startSession({
        date: "2026-03-02",
        courseId: null,
        minutes: 30,
        steps: [step("c", "chapter", { sessionId: { planId: 1, sessionId: 40, chapterId: 5 } })],
        now: 0,
      }),
      "c",
      "done"
    );
    expect(finishedPlanSessions(s)).toMatchObject([{ planId: 1, sessionId: 40, chapterId: 5 }]);
  });
});

describe("studiedMinutes", () => {
  const MIN = 60_000;
  const session = (steps: TodayStep[]) => startSession({ date: "2026-03-02", courseId: null, minutes: 60, steps, now: 0 });

  it("credits the time since the session started, up to what the step was planned for", () => {
    const s = session([step("a", "chapter", { minutes: 25 })]);
    expect(studiedMinutes(s, { minutes: 25 }, 12 * MIN)).toBe(12);
    expect(studiedMinutes(s, { minutes: 25 }, 90 * MIN)).toBe(25);
  });

  it("measures from the previous step being ticked off", () => {
    const s = setStepStatus(session([step("a", "chapter"), step("b", "chapter")]), "a", "done", 20 * MIN);
    expect(studiedMinutes(s, { minutes: 25 }, 38 * MIN)).toBe(18);
  });

  it("gives the planned time when ticked within moments (studied before opening Today)", () => {
    expect(studiedMinutes(session([step("a", "chapter")]), { minutes: 25 }, 2 * MIN)).toBe(25);
  });
});

describe("step actions", () => {
  it("snoozes behind the rest, skips, and tracks progress", () => {
    let s = snoozeStep(start(), "reviews");
    expect(currentStep(s)?.id).toBe("mistakes");
    expect(s.steps.at(-1)?.id).toBe("reviews");
    s = setStepStatus(s, "mistakes", "skipped");
    s = setStepStatus(s, "chapter:5:resource:9", "done");
    expect(currentStep(s)?.id).toBe("concept:2:graphs");
    expect(sessionProgress(s)).toEqual({ done: 1, total: 3 });
    expect(finishedPlanSessions(s)).toMatchObject([{ planId: 1, sessionId: 40 }]);
    expect(snoozeStep(s, "mistakes")).toBe(s);
  });

  it("finds the pending step for the current page", () => {
    expect(stepForLocation(start(), "/review")?.id).toBe("reviews");
    expect(stepForLocation(setStepStatus(start(), "reviews", "done"), "/review")).toBeNull();
  });
});

describe("parseSession", () => {
  it("round-trips a session and rejects malformed data", () => {
    const s = start();
    expect(parseSession(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseSession({ date: "x" })).toBeNull();
    expect(parseSession(null)).toBeNull();
    expect(parseSession({ ...s, steps: [{}] })).toBeNull();
  });
});

describe("chosen chapters in a session", () => {
  it("are kept with the session, and default to none for an older saved one", () => {
    const s = startSession({ date: "2026-03-02", courseId: null, minutes: 60, steps: base, chapterIds: [4, 9], now: 1 });
    expect(parseSession(JSON.parse(JSON.stringify(s)))?.chapterIds).toEqual([4, 9]);
    const old: Record<string, unknown> = JSON.parse(JSON.stringify(s));
    delete old.chapterIds;
    expect(parseSession(old)?.chapterIds).toEqual([]);
  });
});

describe("measuring how long plan sessions took", () => {
  const MIN = 60_000;
  const t0 = 1_700_000_000_000;
  const started = () =>
    startSession({
      date: "2026-01-05",
      courseId: null,
      minutes: 60,
      now: t0,
      steps: [
        step("a", "chapter", { sessionId: { planId: 1, sessionId: 40 } }),
        step("b", "chapter", { sessionId: { planId: 1, sessionId: 40 } }),
        step("c", "chapter", { sessionId: { planId: 1, sessionId: 41 } }),
      ],
    });

  it("adds up the time from one tick to the next, per plan session", () => {
    let s = setStepStatus(started(), "a", "done", t0 + 20 * MIN);
    s = setStepStatus(s, "b", "done", t0 + 35 * MIN);
    s = setStepStatus(s, "c", "done", t0 + 50 * MIN);
    expect(finishedPlanSessions(s)).toEqual([
      { planId: 1, sessionId: 40, minutes: 35 },
      { planId: 1, sessionId: 41, minutes: 15 },
    ]);
  });

  it("gives no measurement when a step has no timestamp, or the time is trivially short", () => {
    const untimed = { ...started(), steps: started().steps.map((x, i) => (i === 0 ? { ...x, status: "done" as const } : x)) };
    expect(finishedPlanSessions(untimed)).toEqual([{ planId: 1, sessionId: 40 }]);
    expect(finishedPlanSessions(setStepStatus(started(), "c", "done", t0 + 10_000))).toEqual([
      { planId: 1, sessionId: 41 },
    ]);
  });
});

describe("focus time of a session", () => {
  const MIN = 60_000;
  const t0 = 1_700_000_000_000;
  const s = startSession({ date: "2026-01-05", courseId: null, minutes: 60, now: t0, steps: base });

  it("starts at zero, and defaults to zero for an older saved session", () => {
    expect(s.focusMs).toBe(0);
    const old: Record<string, unknown> = JSON.parse(JSON.stringify(s));
    delete old.focusMs;
    expect(parseSession(old)?.focusMs).toBe(0);
    expect(parseSession({ ...old, focusMs: 5 * MIN })?.focusMs).toBe(5 * MIN);
    expect(parseSession({ ...old, focusMs: -4 })?.focusMs).toBe(0);
  });

  it("adds the running stretch to what's banked, but only from the session's start", () => {
    const idle = initialPomodoroState(DEFAULT_POMODORO_SETTINGS);
    expect(sessionFocusMs({ ...s, focusMs: 10 * MIN }, idle, t0)).toBe(10 * MIN);
    const running = startTimer(idle, t0 - 5 * MIN);
    expect(sessionFocusMs({ ...s, focusMs: 10 * MIN }, running, t0 + 3 * MIN)).toBe(13 * MIN);
  });
});

describe("done for today", () => {
  it("counts the step as done without a plan completion, and finishing it for good clears the flag", () => {
    const s = markDoneForToday(start(), "chapter:5:resource:9", 1234);
    const step = s.steps.find((x) => x.id === "chapter:5:resource:9");
    expect(step).toMatchObject({ status: "done", doneAt: 1234, partial: true });
    expect(sessionProgress(s).done).toBe(1);
    expect(setStepStatus(s, "chapter:5:resource:9", "done").steps[2].partial).toBeUndefined();
  });

  it("isn't undone or re-added by a fresh plan that still lists the resource", () => {
    const s = markDoneForToday(start(), "chapter:5:resource:9");
    const merged = mergeFresh(s, [step("chapter:5:resource:9", "chapter", { minutes: 25 })]);
    expect(merged.steps.filter((x) => x.id === "chapter:5:resource:9")).toEqual([
      expect.objectContaining({ status: "done", partial: true }),
    ]);
    expect(currentStep(merged)?.id).not.toBe("chapter:5:resource:9");
  });
});

describe("plan session time from focus time", () => {
  const MIN = 60_000;
  const t0 = 1_700_000_000_000;
  const done = () => {
    const s = startSession({
      date: "2026-01-05",
      courseId: null,
      minutes: 60,
      now: t0,
      steps: [step("a", "chapter", { sessionId: { planId: 1, sessionId: 40 } }), step("b", "reviews")],
    });
    return setStepStatus(setStepStatus(s, "b", "done", t0 + 20 * MIN), "a", "done", t0 + 60 * MIN);
  };

  it("scales the wall-clock time down to the focus share", () => {
    // 60 minutes on the clock, 45 of them focus: the plan session (40 of the
    // 60) gets 30.
    expect(finishedPlanSessions(done(), 45 * MIN)).toEqual([{ planId: 1, sessionId: 40, minutes: 30 }]);
  });

  it("never scales time up, and records nothing when no focus time ran", () => {
    expect(finishedPlanSessions(done(), 90 * MIN)).toEqual([{ planId: 1, sessionId: 40, minutes: 40 }]);
    expect(finishedPlanSessions(done(), 0)).toEqual([{ planId: 1, sessionId: 40 }]);
  });
});

describe("a chapter's quiz turning up", () => {
  it("is reported once its study steps are done and the plan brings up the quiz step", () => {
    const s = start();
    const known = new Set(s.steps.map((x) => x.id));
    expect(newChapterQuizSteps(s, known)).toEqual([]);
    const done = setStepStatus(s, "chapter:5:resource:9", "done");
    const merged = mergeFresh(done, [step("chapter:5:practice", "chapter", { title: "Test yourself: Induction" })]);
    expect(newChapterQuizSteps(merged, known).map((x) => x.id)).toEqual(["chapter:5:practice"]);
    expect(newChapterQuizSteps(merged, new Set(merged.steps.map((x) => x.id)))).toEqual([]);
  });

  it("ignores other new steps, and a quiz step that isn't waiting any more", () => {
    const known = new Set<string>();
    const other = mergeFresh(setStepStatus(start(), "chapter:5:resource:9", "done"), [step("chapter:5:subtopic:0", "chapter")]);
    expect(newChapterQuizSteps(other, known).map((x) => x.id)).toEqual([]);
    const quiz = mergeFresh(setStepStatus(start(), "chapter:5:resource:9", "done"), [step("chapter:5:practice", "chapter")]);
    expect(newChapterQuizSteps(setStepStatus(quiz, "chapter:5:practice", "skipped"), known)).toEqual([]);
  });
});
