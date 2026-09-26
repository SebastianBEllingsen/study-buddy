import type { TodayStep } from "./planDay";

// A running Today session, kept in the browser (per device, like the
// Pomodoro timer it runs alongside). The step list is a snapshot taken at
// Start; later plans from the server only tick steps off and add the next
// step of something already in the session — the session doesn't grow
// beyond what the learner signed up for.

export type StepStatus = "pending" | "done" | "skipped";
export type SessionStep = TodayStep & { status: StepStatus };

export interface TodaySession {
  date: string;
  courseId: number | null;
  minutes: number;
  startedAt: number;
  steps: SessionStep[];
}

export function startSession(input: {
  date: string;
  courseId: number | null;
  minutes: number;
  steps: TodayStep[];
  now: number;
}): TodaySession {
  return {
    date: input.date,
    courseId: input.courseId,
    minutes: input.minutes,
    startedAt: input.now,
    steps: input.steps.map((s) => ({ ...s, status: "pending" })),
  };
}

// Steps of the same group follow on from each other: finishing one
// resource of a chapter brings up that chapter's next step.
export function stepGroup(step: TodayStep): string {
  if (step.kind === "chapter") return step.id.split(":").slice(0, 2).join(":");
  if (step.kind === "concept") return step.id;
  return step.kind;
}

// Kinds whose disappearance from a fresh plan means the work is done (no
// reviews left, no confident mistakes left, that resource/subtopic
// ticked off). A concept can drop out for other reasons, so it never
// auto-completes.
const AUTO_COMPLETES = new Set(["reviews", "mistakes", "chapter", "exam"]);

// `fresh` is the server's current plan, fetched without a time limit so
// nothing is missing just for lack of minutes.
export function mergeFresh(session: TodaySession, fresh: TodayStep[]): TodaySession {
  const freshById = new Map(fresh.map((s) => [s.id, s]));
  let steps: SessionStep[] = session.steps.map((step) => {
    if (step.status !== "pending") return step;
    const update = freshById.get(step.id);
    if (update) return { ...update, minutes: step.minutes, status: "pending" };
    return AUTO_COMPLETES.has(step.kind) ? { ...step, status: "done" } : step;
  });

  const groups = new Set(session.steps.map(stepGroup));
  const known = new Set(steps.map((s) => s.id));
  for (const step of fresh) {
    const group = stepGroup(step);
    if (known.has(step.id) || !groups.has(group)) continue;
    if (steps.some((s) => s.status === "pending" && stepGroup(s) === group)) continue;
    const previous = [...steps].reverse().find((s) => stepGroup(s) === group);
    // Picks up where the finished step left off, in its time slot.
    steps = [...steps, { ...step, minutes: previous?.minutes ?? step.minutes, status: "pending" }];
    known.add(step.id);
  }
  const changed = JSON.stringify(steps) !== JSON.stringify(session.steps);
  return changed ? { ...session, steps } : session;
}

export function setStepStatus(session: TodaySession, id: string, status: StepStatus): TodaySession {
  return { ...session, steps: session.steps.map((s) => (s.id === id ? { ...s, status } : s)) };
}

// Later today: the step moves behind everything else still pending.
export function snoozeStep(session: TodaySession, id: string): TodaySession {
  const step = session.steps.find((s) => s.id === id);
  if (!step || step.status !== "pending") return session;
  return { ...session, steps: [...session.steps.filter((s) => s.id !== id), step] };
}

export function currentStep(session: TodaySession): SessionStep | null {
  return session.steps.find((s) => s.status === "pending") ?? null;
}

export function sessionProgress(session: TodaySession) {
  const done = session.steps.filter((s) => s.status === "done");
  return {
    done: done.length,
    total: session.steps.filter((s) => s.status !== "skipped").length,
    minutesDone: done.reduce((n, s) => n + s.minutes, 0),
  };
}

// Plan sessions whose chapter work got done today — marked done on Finish.
export function finishedPlanSessions(session: TodaySession): { planId: number; sessionId: number }[] {
  const seen = new Map<number, { planId: number; sessionId: number }>();
  for (const step of session.steps) {
    if (step.status === "done" && step.sessionId) seen.set(step.sessionId.sessionId, step.sessionId);
  }
  return [...seen.values()];
}

// The pending step whose page the learner is on, if any.
export function stepForLocation(session: TodaySession, pathAndQuery: string): SessionStep | null {
  return session.steps.find((s) => s.status === "pending" && !s.external && s.href === pathAndQuery) ?? null;
}

export function parseSession(raw: unknown): TodaySession | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<TodaySession>;
  if (typeof s.date !== "string" || typeof s.minutes !== "number" || typeof s.startedAt !== "number") return null;
  if (!Array.isArray(s.steps) || !s.steps.every((x) => x && typeof x.id === "string" && typeof x.status === "string")) {
    return null;
  }
  return { date: s.date, courseId: typeof s.courseId === "number" ? s.courseId : null, minutes: s.minutes, startedAt: s.startedAt, steps: s.steps };
}
