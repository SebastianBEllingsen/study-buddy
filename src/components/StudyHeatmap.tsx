"use client";

// A compact GitHub-style activity graph — quiz attempts and flashcard
// reviews per day. The streak counter already tells you "how many days in a
// row," but not "was last week actually lighter than usual" — this is the
// shape of that answer, not just a number.
const DEFAULT_WEEKS = 14;

function levelFor(count: number): string {
  if (count === 0) return "bg-muted";
  if (count === 1) return "bg-amber/25";
  if (count <= 3) return "bg-amber/50";
  if (count <= 6) return "bg-amber/75";
  return "bg-amber";
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// `weeks` shrinks when the dashboard widget is resized narrower, and
// `showLabel` drops when it's resized shorter (see page.tsx) — a real
// widget resize, not just a CSS overflow clip, same idea as an iOS/Android
// widget showing less detail at a smaller size. The label's own line is
// taller than a row of squares, so it's the first thing to go: at the
// shortest widget height there's exactly enough room for the 7 squares and
// no more.
export default function StudyHeatmap({
  activity,
  weeks: weeksCount = DEFAULT_WEEKS,
  showLabel = true,
}: {
  activity: Record<string, number>;
  weeks?: number;
  showLabel?: boolean;
}) {
  // Always renders, even with zero activity anywhere — an all-empty grid is
  // itself the "nothing yet" state (same idea as GitHub's own contribution
  // graph), and the home page now places this widget deliberately rather
  // than showing it only opportunistically, so it shouldn't disappear.

  // Everything here runs in UTC (getUTCDay/setUTCDate/setUTCHours), matching
  // streak.ts and every stored timestamp in this app (see lib/time.ts) —
  // mixing in local Date methods here previously left the grid position
  // (computed locally) and the toDateKey() label/lookup (UTC, via
  // toISOString) disagreeing by a day outside UTC, so "today" showed up
  // correctly placed but labeled/counted as if it were the day before.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // Start on the Sunday of the week (weeksCount - 1) weeks before today's,
  // so the grid is always exactly weeksCount*7 days — a clean rectangle, no
  // trailing partial week. (A previous version re-read start.getDay()
  // *after* mutating start to compute the loop bound, picking up the
  // shifted day of week instead of today's — that off-by-a-few-days error
  // produced one extra day dangling past the last full column.)
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - today.getUTCDay() - (weeksCount - 1) * 7);

  const days: { key: string; date: Date; count: number }[] = [];
  for (let i = 0; i < weeksCount * 7; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const key = toDateKey(date);
    days.push({ key, date, count: activity[key] ?? 0 });
  }

  const weeks: (typeof days)[] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      {showLabel && (
        <p className="truncate text-xs text-muted-foreground">Study activity — last {weeksCount} weeks</p>
      )}
      <div className="flex gap-[3px]">
        {weeks.map((week, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {week.map((day) => {
              const isFuture = day.date > today;
              return (
                <div
                  key={day.key}
                  title={isFuture ? undefined : `${day.count} ${day.count === 1 ? "activity" : "activities"} on ${day.key}`}
                  className={`size-2.5 rounded-sm ${isFuture ? "bg-transparent" : levelFor(day.count)}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
