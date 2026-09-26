"use client";

import { useEffect, useSyncExternalStore } from "react";
import useSWR from "swr";
import { localToday } from "@/lib/studyPlan/schedule";
import { localDayStart } from "@/lib/review/session";
import type { TodayStep } from "@/lib/today/planDay";
import { mergeFresh, parseSession, type TodaySession } from "@/lib/today/session";

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

export function updateTodaySession(fn: (s: TodaySession) => TodaySession) {
  const current = read();
  if (current) saveTodaySession(fn(current));
}

// Today's running session, or null (a session from an earlier day is over).
export function useTodaySession(): TodaySession | null {
  const session = useSyncExternalStore(subscribe, read, () => null);
  return session && session.date === localToday() ? session : null;
}

export function todayUrl(courseId: number | null, minutes?: number): string {
  const params = new URLSearchParams({ dayStart: localDayStart() });
  if (courseId !== null) params.set("courseId", String(courseId));
  if (minutes !== undefined) params.set("minutes", String(minutes));
  return `/api/today?${params}`;
}

// Keeps a running session in step with the server: work that's done gets
// ticked off, and a chapter's next step shows up. Fetched without a time
// limit (see mergeFresh).
export function useTodaySync(session: TodaySession | null) {
  const { data } = useSWR<{ steps: TodayStep[] }>(session ? todayUrl(session.courseId, 480) : null, {
    revalidateOnFocus: true,
  });
  useEffect(() => {
    if (!session || !data) return;
    const merged = mergeFresh(session, data.steps);
    if (merged !== session) saveTodaySession(merged);
  }, [session, data]);
}
