"use client";

import { Explain } from "@/components/Explain";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, CalendarDays, CalendarX, LoaderCircle, RefreshCw, Settings2 } from "lucide-react";
import { cn } from "cn";
import type { StudyPlan, StudyPlanSession } from "@/lib/studyPlan/types";
import { buildSchedule, localToday, missedSessions, scheduleInputFromPlan } from "@/lib/studyPlan/schedule";
import {
  formatDay,
  formatMinutes,
  groupSessionsByWeek,
  scheduleWarningText,
} from "@/lib/studyPlanDisplay";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScheduleSettingsDialog, type ScheduleSettings } from "./ScheduleSettingsDialog";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const INITIAL_SESSIONS_SHOWN = 12;

function daysSummary(days: number[]): string {
  const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (sorted.join() === "1,2,3,4,5") return "Weekdays";
  if (sorted.length === 7) return "Every day";
  return sorted.map((d) => WEEKDAY_NAMES[d]).join(", ");
}

async function send(url: string, method: string, body?: unknown): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Something went wrong");
      return null;
    }
    return res;
  } catch {
    toast.error("Something went wrong");
    return null;
  }
}

// The plan's schedule: upcoming sessions by week (tick them off as you
// go), anything missed, warnings when the plan doesn't fit, and the
// controls — schedule settings, Replan, and Google Calendar.
export function ScheduleView({
  plan,
  chapterNumbers,
  googleConnected,
  onChanged,
}: {
  plan: StudyPlan;
  chapterNumbers: Map<number, number>;
  googleConnected: boolean;
  onChanged: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [replanMessage, setReplanMessage] = useState<string | null>(null);
  const today = localToday();

  const titles = new Map(plan.chapters.map((c) => [c.id, c.title]));
  const open = plan.sessions.filter((s) => !s.done_at && s.date >= today);
  const missed = missedSessions(plan.sessions, today);
  const done = plan.sessions.filter((s) => s.done_at);
  // Recomputed here rather than stored: the same warnings a reschedule
  // from today would give.
  const warnings = buildSchedule(scheduleInputFromPlan(plan, today)).warnings;
  const shown = showAll ? open : open.slice(0, INITIAL_SESSIONS_SHOWN);
  const weeks = groupSessionsByWeek(shown, today);
  const { deadline, studyDays, minutesPerDay } = plan.options;

  async function toggleSession(session: StudyPlanSession, isDone: boolean) {
    if (await send(`/api/study-plans/${plan.id}/sessions/${session.id}`, "PATCH", { done: isDone })) onChanged();
  }

  async function replan() {
    setReplanning(true);
    const res = await send(`/api/study-plans/${plan.id}/replan`, "POST");
    setReplanning(false);
    if (!res) return;
    const data = await res.json();
    setReplanMessage(data.message ?? null);
    onChanged();
  }

  async function saveSettings(settings: ScheduleSettings): Promise<boolean> {
    const ok = !!(await send(`/api/study-plans/${plan.id}`, "PATCH", { options: { schedule: true, ...settings } }));
    if (ok) onChanged();
    return ok;
  }

  async function turnOff(): Promise<boolean> {
    const ok = !!(await send(`/api/study-plans/${plan.id}`, "PATCH", { options: { schedule: false } }));
    if (ok) onChanged();
    return ok;
  }

  async function toggleGoogle() {
    setSyncing(true);
    const res = await send(`/api/study-plans/${plan.id}/google-calendar`, plan.options.googleCalendar ? "DELETE" : "POST");
    setSyncing(false);
    if (!res) return;
    toast.success(plan.options.googleCalendar ? "Removed from Google Calendar" : "Added to Google Calendar");
    onChanged();
  }

  return (
    <section className="space-y-3" aria-labelledby="schedule-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h2 id="schedule-heading" className="flex items-center gap-2 font-heading text-base font-semibold">
            <CalendarDays className="size-4 text-focus" />
            Schedule
          </h2>
          <p className="text-xs text-muted-foreground">
            {daysSummary(studyDays)} · {formatMinutes(minutesPerDay)} a day
            {deadline ? ` · finish by ${formatDay(deadline, { day: "numeric", month: "long", year: "numeric" })}` : ""}
            {plan.sessions.length > 0 && ` · ${done.length} of ${plan.sessions.length} sessions done`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Explain id="plan.replan">
          <Button variant="outline" size="sm" onClick={replan} disabled={replanning}>
            {replanning ? (
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Replan
          </Button>
          </Explain>
          {googleConnected && (
            <Button variant="outline" size="sm" onClick={toggleGoogle} disabled={syncing}>
              {plan.options.googleCalendar ? <CalendarX className="size-3.5" /> : <CalendarCheck className="size-3.5" />}
              {syncing ? "Syncing…" : plan.options.googleCalendar ? "Remove from Google Calendar" : "Add to Google Calendar"}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Schedule settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-4" />
          </Button>
        </div>
      </div>

      {replanMessage && <p className="rounded-md bg-focus/10 px-3 py-2 text-sm">{replanMessage}</p>}
      {warnings.map((warning) => (
        <p key={warning.type} className="rounded-md bg-amber/10 px-3 py-2 text-xs text-amber">
          {scheduleWarningText(warning)}
        </p>
      ))}
      {missed.length > 0 && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {missed.length} session{missed.length === 1 ? "" : "s"} missed — Replan moves them forward, with extra review
          where your quiz and flashcard results are weak.
        </p>
      )}

      <Card elevation="flat" className="py-0">
        <CardContent className="space-y-4 py-4">
          {weeks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {plan.sessions.length > 0 ? "No sessions left — the whole plan is scheduled as done." : "Nothing scheduled yet."}
            </p>
          ) : (
            weeks.map((week) => (
              <div key={week.label} className="space-y-1">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {week.label === "this"
                    ? "This week"
                    : week.label === "next"
                      ? "Next week"
                      : `Week of ${formatDay(week.label, { day: "numeric", month: "short" })}`}
                </h3>
                <ul className="divide-y divide-border/60">
                  {week.sessions.map((session) => (
                    <li key={session.id} className="flex items-center gap-3 py-1.5 text-sm">
                      <Checkbox
                        checked={!!session.done_at}
                        onCheckedChange={(v) => toggleSession(session, !!v)}
                        aria-label={`Mark the ${formatDay(session.date)} session done`}
                      />
                      <span className={cn("w-24 shrink-0 tabular-nums", session.date === today && "font-medium text-focus")}>
                        {session.date === today ? "Today" : formatDay(session.date)}
                      </span>
                      <a href={`#chapter-${session.chapter_id}`} className="min-w-0 flex-1 truncate hover:underline">
                        {session.kind === "review" && <span className="text-muted-foreground">Review · </span>}
                        {chapterNumbers.get(session.chapter_id)}. {titles.get(session.chapter_id)}
                      </a>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatMinutes(session.minutes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {open.length > INITIAL_SESSIONS_SHOWN && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${open.length} sessions`}
            </Button>
          )}
        </CardContent>
      </Card>

      <ScheduleSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initial={{ deadline, studyDays, minutesPerDay }}
        onSave={saveSettings}
        onTurnOff={turnOff}
      />
    </section>
  );
}
