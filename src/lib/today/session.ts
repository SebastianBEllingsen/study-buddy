import type { TodayStep } from "./planDay";

// A running Today session, kept in the browser (per device, like the
// Pomodoro timer it runs alongside). The step list is a snapshot taken at
// Start; later plans from the server only tick steps off and add the next
// step of something already in the session — the session doesn't grow
// beyond what the learner signed up for.

export type StepStatus = "pending" | "done" | "skipped";
// doneAt: when it was ticked off (ms), for measuring how long the work took.
export type SessionStep = TodayStep & { status: StepStatus; doneAt?: number };

export interface TodaySession {
  date: string;
  courseId: number | null;
  minutes: number;
  startedAt: number;
  steps: SessionStep[];
  // Chapters the learner picked; empty when the autopilot chose.
  chapterIds: number[];
}

export function startSession(input: {
  date: string;
  courseId: number | null;
  minutes: number;
  steps: TodayStep[];
  chapterIds?: number[];
  now: number;
}): TodaySession {
  return {
    date: input.date,
    courseId: input.courseId,
    chapterIds: input.chapterIds ?? [],
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

export function setStepStatus(session: TodaySession, id: string, status: StepStatus, now = Date.now()): TodaySession {
  return {
    ...session,
    steps: session.steps.map((s) => {
      if (s.id !== id) return s;
      const next: SessionStep = { ...s, status };
      if (status === "done") next.doneAt = now;
      else delete next.doneAt;
      return next;
    }),
  };
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
// `minutes` is how long the work really took: the time from the previous
// step being ticked off (or the session's start) to each of its steps being
// done, when every one of its steps has a timestamp.
export function finishedPlanSessions(session: TodaySession): { planId: number; sessionId: number; minutes?: number }[] {
  const seen = new Map<number, { planId: number; sessionId: number; minutes?: number }>();
  const timed = new Map<number, number | null>();
  let boundary = session.startedAt;
  const done = session.steps
    .filter((s) => s.status === "done")
    .sort((a, b) => (a.doneAt ?? Infinity) - (b.doneAt ?? Infinity));
  for (const step of done) {
    const elapsed = step.doneAt === undefined ? null : Math.max(0, step.doneAt - boundary);
    if (step.doneAt !== undefined) boundary = step.doneAt;
    if (!step.sessionId) continue;
    const id = step.sessionId.sessionId;
    seen.set(id, { planId: step.sessionId.planId, sessionId: id });
    const so_far = timed.get(id);
    timed.set(id, elapsed === null || so_far === null ? null : (so_far ?? 0) + elapsed);
  }
  for (const [id, entry] of seen) {
    const ms = timed.get(id);
    if (ms !== null && ms !== undefined && ms >= 60_000) entry.minutes = Math.round(ms / 60_000);
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
  return {
    date: s.date,
    courseId: typeof s.courseId === "number" ? s.courseId : null,
    minutes: s.minutes,
    startedAt: s.startedAt,
    steps: s.steps,
    chapterIds: Array.isArray(s.chapterIds) ? s.chapterIds.filter((n) => Number.isInteger(n)) : [],
  };
}
