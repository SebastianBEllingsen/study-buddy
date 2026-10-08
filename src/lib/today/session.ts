import { runningFocusMs, type PomodoroState } from "../pomodoro";
import type { TodayStep } from "./planDay";

// A running Today session, kept in the browser (per device, like the
// Pomodoro timer it runs alongside). The step list is a snapshot taken at
// Start; later plans from the server only tick steps off and add the next
// step of something already in the session — the session doesn't grow
// beyond what the learner signed up for.

export type StepStatus = "pending" | "done" | "skipped";
// doneAt: when it was ticked off (ms), for measuring how long the work took.
// partial: "done for today" — today's share of a plan resource is done but
// the resource itself (a whole playlist, a book) is still open in the plan.
export type SessionStep = TodayStep & { status: StepStatus; doneAt?: number; partial?: boolean };

export interface TodaySession {
  date: string;
  courseId: number | null;
  minutes: number;
  startedAt: number;
  // Focus time (ms) the Pomodoro timer has run since the session started,
  // for stretches that have ended. A stretch still running is added on top
  // by sessionFocusMs.
  focusMs: number;
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
    focusMs: 0,
    steps: input.steps.map((s) => ({ ...s, status: "pending" })),
  };
}

// Steps of the same group follow on from each other: finishing one
// resource of a chapter brings up that chapter's next step.
export function stepGroup(step: TodayStep): string {
  if (step.kind === "chapter") return step.id.split(":").slice(0, 2).join(":");
  if (step.kind === "concept" || step.kind === "code") return step.id;
  return step.kind;
}

// Kinds whose disappearance from a fresh plan means the work is done (no
// reviews left, no confident mistakes left, that resource/subtopic
// ticked off). A concept or coding step can drop out for other reasons, so
// it never auto-completes.
const AUTO_COMPLETES = new Set(["reviews", "mistakes", "chapter", "exam"]);

// `fresh` is the server's current plan, fetched without a time limit so
// nothing is missing just for lack of minutes.
export function mergeFresh(
  session: TodaySession,
  fresh: TodayStep[],
  doneSessions: { planId: number; sessionId: number }[] = []
): TodaySession {
  const freshById = new Map(fresh.map((s) => [s.id, s]));
  // A chapter step whose plan session was ticked off in the plan itself was
  // not done here, so it leaves the session rather than counting as today's work.
  const ticked = new Set(doneSessions.map((d) => `${d.planId}:${d.sessionId}`));
  const droppedExternally = (step: SessionStep) =>
    step.kind === "chapter" && !!step.sessionId && ticked.has(`${step.sessionId.planId}:${step.sessionId.sessionId}`);
  let steps: SessionStep[] = session.steps.flatMap((step): SessionStep[] => {
    if (step.status !== "pending") return [step];
    const update = freshById.get(step.id);
    if (update) return [{ ...update, minutes: step.minutes, status: "pending" }];
    if (droppedExternally(step)) return [];
    return [AUTO_COMPLETES.has(step.kind) ? { ...step, status: "done" } : step];
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
      delete next.partial;
      return next;
    }),
  };
}

// "Done for today": counts as today's work but leaves the plan resource
// open, so it comes back tomorrow. Only the session knows — nothing is
// recorded in the study plan.
export function markDoneForToday(session: TodaySession, id: string, now = Date.now()): TodaySession {
  return {
    ...session,
    steps: session.steps.map((s) => (s.id === id ? { ...s, status: "done", doneAt: now, partial: true } : s)),
  };
}

// How long a step's work took, for crediting the time to the plan: the time
// since the previous step was ticked off (or the session started), at most
// what the step was planned for. Ticked within moments, the planned time
// stands — it was studied before Today was opened.
export function studiedMinutes(session: TodaySession, step: { minutes: number }, now: number): number {
  const since = session.steps.reduce((t, s) => (s.status === "done" && s.doneAt !== undefined ? Math.max(t, s.doneAt) : t), session.startedAt);
  const elapsed = Math.round((now - since) / 60_000);
  return elapsed >= 5 ? Math.min(elapsed, step.minutes) : step.minutes;
}

// Focus time of the session: finished stretches plus the one running now.
export function sessionFocusMs(session: TodaySession, pomodoro: PomodoroState, now: number): number {
  return session.focusMs + runningFocusMs(pomodoro, now, session.startedAt);
}

// Later today: the step moves behind everything else still pending.
export function snoozeStep(session: TodaySession, id: string): TodaySession {
  const step = session.steps.find((s) => s.id === id);
  if (!step || step.status !== "pending") return session;
  return { ...session, steps: [...session.steps.filter((s) => s.id !== id), step] };
}

// Chapter quiz ("Test yourself") steps that are new since `knownIds` and
// still waiting: the chapter's study steps are finished and its check is
// next. A session starts with the plan's steps, so only ones brought up
// later — by finishing the chapter's last resource or subtopic — are new.
export function newChapterQuizSteps(session: TodaySession, knownIds: ReadonlySet<string>): SessionStep[] {
  return session.steps.filter(
    (s) => s.status === "pending" && s.kind === "chapter" && s.id.endsWith(":practice") && !knownIds.has(s.id)
  );
}

export function currentStep(session: TodaySession): SessionStep | null {
  return session.steps.find((s) => s.status === "pending") ?? null;
}

export function sessionProgress(session: TodaySession) {
  const done = session.steps.filter((s) => s.status === "done");
  return {
    done: done.length,
    total: session.steps.filter((s) => s.status !== "skipped").length,
  };
}

// Plan sessions whose chapter work got done today — marked done on Finish.
// `minutes` is how long the work really took: the time from the previous
// step being ticked off (or the session's start) to each of its steps being
// done, when every one of its steps has a timestamp. Given the session's
// focus time, those durations are scaled down to the share that was really
// focus (breaks, pauses and idle time excluded) — never scaled up.
export function finishedPlanSessions(session: TodaySession, focusMs?: number): { planId: number; sessionId: number; chapterId?: number; minutes?: number }[] {
  const seen = new Map<number, { planId: number; sessionId: number; chapterId?: number; minutes?: number }>();
  const timed = new Map<number, number | null>();
  let boundary = session.startedAt;
  let wallMs = 0;
  const done = session.steps
    .filter((s) => s.status === "done")
    .sort((a, b) => (a.doneAt ?? Infinity) - (b.doneAt ?? Infinity));
  for (const step of done) {
    const elapsed = step.doneAt === undefined ? null : Math.max(0, step.doneAt - boundary);
    if (step.doneAt !== undefined) boundary = step.doneAt;
    if (elapsed !== null) wallMs += elapsed;
    if (!step.sessionId) continue;
    const id = step.sessionId.sessionId;
    seen.set(id, {
      planId: step.sessionId.planId,
      sessionId: id,
      ...(step.sessionId.chapterId !== undefined ? { chapterId: step.sessionId.chapterId } : {}),
    });
    const so_far = timed.get(id);
    timed.set(id, elapsed === null || so_far === null ? null : (so_far ?? 0) + elapsed);
  }
  const scale = focusMs !== undefined && wallMs > 0 ? Math.min(1, Math.max(0, focusMs) / wallMs) : 1;
  for (const [id, entry] of seen) {
    const ms = timed.get(id);
    if (ms === null || ms === undefined) continue;
    const focused = ms * scale;
    if (focused >= 60_000) entry.minutes = Math.round(focused / 60_000);
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
    focusMs: typeof s.focusMs === "number" && Number.isFinite(s.focusMs) && s.focusMs > 0 ? s.focusMs : 0,
    steps: s.steps,
    chapterIds: Array.isArray(s.chapterIds) ? s.chapterIds.filter((n) => Number.isInteger(n)) : [],
  };
}

// What today's finished sessions add up to, kept on the server after each one
// ends (lib/today/finished.ts) so the Today card can show the day as done
// (and still offer another session).
export interface DayTotals {
  date: string;
  sessions: number;
  steps: number;
  focusMs: number;
}
