// Shared by /calendar's page and its grid components (MonthGrid,
// FeedWeekView) — the /api/calendar/events response shape plus the small
// local-date helpers every view keys its days by.

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink: string | null;
  source: string;
}

export function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// Monday 00:00 local of the week containing `d` — the timetable week runs
// Mon–Sun whatever the date format.
export function startOfWeek(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

// The 6-week span MonthGrid renders for a month (rows start on
// `weekStartsOn`: 0 Sunday, 1 Monday — see lib/dateFormat.ts), so a caller
// fetching by range gets the leading/trailing days' events too.
export function monthGridRange(month: Date, weekStartsOn: 0 | 1 = 0): { start: Date; end: Date } {
  const start = new Date(month);
  start.setDate(start.getDate() - ((month.getDay() - weekStartsOn + 7) % 7));
  return { start, end: addDays(start, 42) };
}

// Weekday labels in display order for a week starting on `weekStartsOn`.
export function weekdayLabels<T>(sundayFirst: readonly T[], weekStartsOn: 0 | 1): T[] {
  return [...sundayFirst.slice(weekStartsOn), ...sundayFirst.slice(0, weekStartsOn)];
}
