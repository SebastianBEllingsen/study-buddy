import { eq } from "drizzle-orm";
import { db, today_finished_sessions } from "../db";
import { nowUtc } from "../time";
import { type DayTotals } from "./session";

// Finished Today sessions, kept per day so the Today card's summary follows
// the learner to every device (the running session itself stays in the
// browser — see components/today/todayStore.ts).

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A day's focus can't plausibly exceed this; guards the integer column.
const MAX_FOCUS_MS = 24 * 60 * 60 * 1000;

export interface FinishedSession {
  date: string;
  steps: number;
  focusMs: number;
}

export function parseFinishedDate(raw: unknown): string | null {
  return typeof raw === "string" && DATE.test(raw) ? raw : null;
}

export function parseFinishedSession(body: Record<string, unknown>): FinishedSession | null {
  const date = parseFinishedDate(body.date);
  if (!date) return null;
  const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null);
  const steps = count(body.steps);
  const focusMs = count(body.focusMs);
  if (steps === null || focusMs === null) return null;
  return { date, steps, focusMs: Math.min(focusMs, MAX_FOCUS_MS) };
}

export async function recordFinishedToday(s: FinishedSession): Promise<void> {
  await db.insert(today_finished_sessions).values({ date: s.date, steps: s.steps, focus_ms: s.focusMs, created_at: nowUtc() });
}

// null when no session was finished that day.
export async function getDayTotals(date: string): Promise<DayTotals | null> {
  const rows = await db.select().from(today_finished_sessions).where(eq(today_finished_sessions.date, date));
  if (rows.length === 0) return null;
  return {
    date,
    sessions: rows.length,
    steps: rows.reduce((sum, r) => sum + r.steps, 0),
    focusMs: rows.reduce((sum, r) => sum + r.focus_ms, 0),
  };
}
