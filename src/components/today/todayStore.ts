"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import useSWR from "swr";
import { localToday } from "@/lib/studyPlan/schedule";
import { localDayStart } from "@/lib/review/session";
import type { TodayStep } from "@/lib/today/planDay";
import {
  addFinishedSession,
  mergeFresh,
  parseDayTotals,
  parseSession,
  type DayTotals,
  type TodaySession,
} from "@/lib/today/session";

// The running Today session lives in localStorage (per device, like the
// Pomodoro timer), shared by every component through this tiny store.

const KEY = "studybuddy-today-session";
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cached: TodaySession | null = null;

function read(): TodaySession | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cached = raw ? parseSession(JSON.parse(raw)) : null;
    } catch {
      cached = null;
    }
  }
  return cached;
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function saveTodaySession(session: TodaySession | null) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the session just won't persist
  }
  emit();
}

// What today's finished sessions add up to — see DayTotals. Per device too.
const DONE_KEY = "studybuddy-today-finished";
let cachedDoneRaw: string | null = null;
let cachedDone: DayTotals | null = null;

function readDone(): DayTotals | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(DONE_KEY);
  } catch {
    return null;
  }
  if (raw !== cachedDoneRaw) {
    cachedDoneRaw = raw;
    try {
      cachedDone = raw ? parseDayTotals(JSON.parse(raw)) : null;
    } catch {
      cachedDone = null;
    }
  }
  return cachedDone;
}

function subscribeDone(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === DONE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// Adds a just-finished session to its day's totals.
export function recordFinishedSession(session: TodaySession, focusMs: number) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(addFinishedSession(readDone(), session, focusMs)));
  } catch {
    // storage unavailable: the day just won't show as done
  }
  emit();
}

// Today's finished sessions, or null when none has been finished today.
export function useTodayFinished(): DayTotals | null {
  const totals = useSyncExternalStore(subscribeDone, readDone, () => null);
  return totals && totals.date === localToday() ? totals : null;
}

// The running session as it is right now, outside of rendering.
export function currentTodaySession(): TodaySession | null {
  return read();
}

export function updateTodaySession(fn: (s: TodaySession) => TodaySession) {
  const current = read();
  if (current) saveTodaySession(fn(current));
}

// Today's running session, or null (a session from an earlier day is over).
export function useTodaySession(): TodaySession | null {
  const session = useSyncExternalStore(subscribe, read, () => null);
  return session && session.date === localToday() ? session : null;
}

export function todayUrl(courseId: number | null, minutes?: number, chapterIds: number[] = []): string {
  const params = new URLSearchParams({ dayStart: localDayStart() });
  if (courseId !== null) params.set("courseId", String(courseId));
  if (minutes !== undefined) params.set("minutes", String(minutes));
  if (chapterIds.length > 0) params.set("chapters", chapterIds.join(","));
  return `/api/today?${params}`;
}

// Keeps a running session in step with the server: work that's done gets
// ticked off, and a chapter's next step shows up. Fetched without a time
// limit (see mergeFresh). With `refreshOnProgress`, every step that gets
// ticked off or skipped fetches the plan again right away, so what follows
// it (a chapter's quiz, say) appears without waiting for the tab to be
// refocused. Only one mounted instance should ask for that.
export function useTodaySync(session: TodaySession | null, options: { refreshOnProgress?: boolean } = {}) {
  const { data, mutate } = useSWR<{ steps: TodayStep[]; doneSessions?: { planId: number; sessionId: number }[] }>(session ? todayUrl(session.courseId, 480, session.chapterIds) : null, {
    revalidateOnFocus: true,
  });
  useEffect(() => {
    if (!session || !data) return;
    const merged = mergeFresh(session, data.steps, data.doneSessions);
    if (merged !== session) saveTodaySession(merged);
  }, [session, data]);

  const refresh = options.refreshOnProgress ?? false;
  const settled = session ? session.steps.filter((s) => s.status !== "pending").length : 0;
  const lastSettled = useRef(settled);
  useEffect(() => {
    const changed = lastSettled.current !== settled;
    lastSettled.current = settled;
    if (refresh && changed && settled > 0) void mutate();
  }, [refresh, settled, mutate]);
}
