import { describe, expect, it } from "vitest";
import type { TodayStep } from "./planDay";
import {
  currentStep,
  finishedPlanSessions,
  mergeFresh,
  parseSession,
  sessionProgress,
  setStepStatus,
  snoozeStep,
  startSession,
  stepForLocation,
  stepGroup,
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

  it("doesn't re-add a step already in the session, and returns the same object when nothing changed", () => {
    const s = setStepStatus(start(), "reviews", "done");
    const merged = mergeFresh(s, base);
    expect(merged.steps.filter((x) => x.id === "reviews")).toHaveLength(1);
    expect(mergeFresh(merged, base)).toBe(merged);
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
    expect(sessionProgress(s)).toEqual({ done: 1, total: 3, minutesDone: 25 });
    expect(finishedPlanSessions(s)).toEqual([{ planId: 1, sessionId: 40 }]);
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
