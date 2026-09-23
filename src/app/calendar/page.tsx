"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { AppSettings, CalendarFeed } from "@/lib/models";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/DateTimePicker";
import { prefersReducedMotion } from "@/lib/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { EventInfoTooltip } from "@/components/EventInfoTooltip";
import {
  Dialog,
  DialogCancel,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface CalendarEvent {
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

// "YYYY-MM-DDTHH:mm" in the viewer's own local time, for <input
// type="datetime-local">, which has no timezone concept of its own — the
// browser always shows/edits it in local time, so round-tripping through
// Date's local getters (not UTC ones) is what keeps the displayed time
// matching what the event's ISO instant actually means locally.
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Deterministic per-source color for a feed-sourced event's indicator dot —
// see the identical helper in page.tsx's UpcomingEventsWidget for why
// (hashing avoids hand-assigning a color to every feed a viewer might add).
const SOURCE_DOT_COLORS = ["bg-focus", "bg-amber", "bg-sage"];
function sourceDotColor(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) | 0;
  return SOURCE_DOT_COLORS[Math.abs(hash) % SOURCE_DOT_COLORS.length];
}

interface EventDraft {
  title: string;
  description: string;
  allDay: boolean;
  start: string;
  end: string;
}

function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// The Google Calendar date a day-cell click should seed a new event on. A
// "new event for this day" draft defaults to a sensible daytime slot rather
// than midnight, so the time inputs don't open on an awkward default.
//
// `forceAllDay` lets the All-day checkbox reseed a fresh draft in the right
// shape for the mode it's switching TO — without it, toggling All-day on
// left start/end as full "YYYY-MM-DDTHH:mm" strings, which neither this
// nor a native <input type="date"> can parse as a plain date (silently
// rendering blank instead of erroring).
function draftFromEvent(event?: CalendarEvent, initialDate?: Date, forceAllDay?: boolean): EventDraft {
  if (!event) {
    const start = initialDate ? new Date(initialDate) : new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(initialDate ? 9 : start.getHours() + 1);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    const allDay = forceAllDay ?? false;
    return {
      title: "",
      description: "",
      allDay,
      start: allDay ? dateKey(start) : toDatetimeLocalValue(start.toISOString()),
      end: allDay ? dateKey(end) : toDatetimeLocalValue(end.toISOString()),
    };
  }
  return {
    title: event.title,
    description: event.description ?? "",
    allDay: event.allDay,
    start: event.allDay ? event.start : toDatetimeLocalValue(event.start),
    end: event.allDay ? event.end : toDatetimeLocalValue(event.end),
  };
}

function EventDialog({
  open,
  onOpenChange,
  event,
  initialDate,
  onSaved,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // undefined = creating a new event; present = editing this one.
  event?: CalendarEvent;
  // For a new event opened by clicking a day cell — seeds the date.
  initialDate?: Date;
  onSaved: () => void;
  onDelete?: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<EventDraft>(() => draftFromEvent(event, initialDate));
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(event?.id ?? null);

  // Re-seeds when a different event (or a different clicked day) is opened,
  // adjusted during render rather than in an effect — see
  // CustomizeCourseDialog.tsx for the same pattern.
  const currentKey = event?.id ?? (initialDate ? `new-${dateKey(initialDate)}` : "new");
  if (open && seededFor !== currentKey) {
    setDraft(draftFromEvent(event, initialDate));
    setSeededFor(currentKey);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim() || !draft.start || !draft.end) return;
    setSaving(true);
    try {
      const start = draft.allDay ? draft.start : new Date(draft.start).toISOString();
      const end = draft.allDay ? draft.end : new Date(draft.end).toISOString();
      const body = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        start,
        end,
        allDay: draft.allDay,
      };
      const res = await fetch(event ? `/api/calendar/events/${event.id}` : "/api/calendar/events", {
        method: event ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(resBody.error ?? "Couldn't save event");
        return;
      }
      toast.success(event ? "Event updated" : "Event created");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Couldn't save event");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
            <DialogDescription>
              {event ? "Changes sync to your Google Calendar." : "Added directly to your Google Calendar."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="event-title">Title</Label>
              <Input
                id="event-title"
                autoFocus
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. Networking midterm"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="event-description">Notes (optional)</Label>
              <Textarea
                id="event-description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={3}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.allDay}
                onCheckedChange={(checked) => {
                  const allDay = checked === true;
                  // Switching representations needs a fresh, valid pair of
                  // values in the new format — reseed from "now" rather
                  // than trying to convert the existing draft's strings.
                  setDraft({
                    ...draftFromEvent(undefined, undefined, allDay),
                    title: draft.title,
                    description: draft.description,
                  });
                }}
              />
              All-day
            </label>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="event-start">Start</Label>
                <DateTimePicker
                  id="event-start"
                  mode={draft.allDay ? "date" : "datetime"}
                  value={draft.start}
                  onChange={(value) => setDraft({ ...draft, start: value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="event-end">End</Label>
                <DateTimePicker
                  id="event-end"
                  mode={draft.allDay ? "date" : "datetime"}
                  value={draft.end}
                  onChange={(value) => setDraft({ ...draft, end: value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter className={event ? "sm:justify-between" : undefined}>
            {event && (
              <div className="flex items-center gap-1">
                {onDelete && <DeleteEventButton onConfirm={onDelete} />}
                {event.htmlLink && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    nativeButton={false}
                    render={<Link href={event.htmlLink} target="_blank" rel="noopener noreferrer" />}
                  >
                    <ExternalLink />
                    Google Calendar
                  </Button>
                )}
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <DialogCancel />
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : event ? "Save changes" : "Add event"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteEventButton({ onConfirm }: { onConfirm: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {/* Labelled and colored as destructive, not a bare icon: it also
          deletes the event from Google Calendar. */}
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          />
        }
      >
        <Trash2 />
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this event?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes it from your Google Calendar too. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={deleting} onClick={handleConfirm}>
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A real in-app month grid, not Google's embeddable widget: that widget
// only renders anything once the *viewing browser* has its own separate
// signed-in Google session (it uses calendar.google.com's cookies, not this
// app's OAuth connection) and Google refuses to let you sign in inside the
// iframe at all — it bounces out to a new window instead. It's also
// cross-origin, so it can never support in-place editing or pick up this
// app's theme. Building the grid ourselves fixes all three: it always
// works once this app is connected, editing is real, and it's just our own
// themed components.
function MonthGrid({
  events,
  onDayClick,
  onEventClick,
  initialMonth,
  highlightEventId,
}: {
  events: CalendarEvent[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  // Arriving from the Upcoming widget's "?date=" — jumps straight to that
  // event's month instead of always opening on the current one.
  initialMonth?: Date;
  // Arriving from the Upcoming widget's "?highlight=" — scrolled into view
  // and flashed once the matching event chip exists in the DOM, the same
  // navigate-and-highlight idea search results already use
  // (lib/scrollToHighlight.ts), just matched by element id instead of a
  // text search since a calendar event has a stable id to target directly.
  highlightEventId?: string;
}) {
  const [month, setMonth] = useState(() => startOfMonth(initialMonth ?? new Date()));
  const today = new Date();

  useEffect(() => {
    if (!highlightEventId) return;
    const el = document.querySelector(`[data-event-id="${CSS.escape(highlightEventId)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    el.classList.add("ring-2", "ring-focus");
    const timeout = setTimeout(() => el.classList.remove("ring-2", "ring-focus"), 1500);
    return () => clearTimeout(timeout);
  }, [highlightEventId]);

  const days = useMemo(() => {
    const gridStart = new Date(month);
    gridStart.setDate(gridStart.getDate() - month.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [month]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      // All-day event dates are plain "YYYY-MM-DD" strings — using them
      // directly (rather than `new Date(event.start)`, which parses as UTC
      // midnight) avoids shifting the event a day in negative-UTC zones.
      const key = event.allDay ? event.start : dateKey(new Date(event.start));
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
        <span className="font-heading text-sm font-semibold">
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setMonth(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b text-center text-xs text-muted-foreground">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-1.5">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = dateKey(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = sameDay(d, today);
          const dayEvents = eventsByDay.get(key) ?? [];
          let visible = dayEvents.slice(0, 3);
          // A highlighted event past the 3-visible cutoff would otherwise
          // never render as a chip at all, so the scroll-to-it effect above
          // would have nothing to find — always keep it in the visible set.
          if (highlightEventId && !visible.some((e) => e.id === highlightEventId)) {
            const target = dayEvents.find((e) => e.id === highlightEventId);
            if (target) visible = [target, ...visible.slice(0, 2)];
          }
          const overflow = dayEvents.length - visible.length;
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onDayClick(d)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onDayClick(d);
              }}
              className={cn(
                "min-h-[92px] cursor-pointer border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0 hover:bg-muted/40",
                !inMonth && "bg-muted/20"
              )}
            >
              <span
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full text-xs",
                  !inMonth && "text-muted-foreground",
                  isToday && "bg-focus font-medium text-background"
                )}
              >
                {d.getDate()}
              </span>
              <div className="mt-1 space-y-0.5">
                {visible.map((event) =>
                  // Feed-sourced events (see lib/calendarFeeds.ts) are
                  // someone else's calendar mirrored in read-only — editing
                  // a Mine Studier lecture or a Canvas assignment through
                  // this app makes no sense the way editing your own Google
                  // event does, so these render inert, with a muted tint
                  // instead of the focus color that signals "yours, click
                  // to edit".
                  event.source === "google" ? (
                    <EventInfoTooltip key={event.id} event={event}>
                      <button
                        type="button"
                        data-event-id={event.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(event);
                        }}
                        className="block w-full truncate rounded-md border border-focus/20 bg-focus/10 px-1 py-0.5 text-left text-[11px] text-focus hover:bg-focus/20"
                      >
                        {event.title}
                      </button>
                    </EventInfoTooltip>
                  ) : (
                    <EventInfoTooltip key={event.id} event={event}>
                      <div
                        data-event-id={event.id}
                        className="flex items-center gap-1 truncate rounded-md border border-border bg-muted px-1 py-0.5 text-[11px] text-muted-foreground"
                      >
                        <span className={`size-1.5 shrink-0 rounded-full ${sourceDotColor(event.source)}`} />
                        <span className="truncate">{event.title}</span>
                      </div>
                    </EventInfoTooltip>
                  )
                )}
                {overflow > 0 && <p className="px-1 text-[10px] text-muted-foreground">+{overflow} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// useSearchParams (for the ?date=/?highlight= deep link the dashboard's
// Upcoming widget navigates here with) needs a Suspense boundary somewhere
// above it for static generation — see the default export at the bottom of
// this file, matching src/app/page.tsx's HomePage/HomePageContent split.
function CalendarPageContent() {
  const searchParams = useSearchParams();
  // Cached across navigation (see SWRProvider) — leaving and coming back to
  // /calendar shows the same month instantly instead of blanking to a
  // skeleton and re-fetching settings/feeds/events from zero every time.
  const { data: settings } = useSWR<AppSettings>("/api/settings");
  const { data: feedsData } = useSWR<{ feeds: CalendarFeed[] }>("/api/calendar-feeds");
  const feeds = feedsData?.feeds ?? null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | undefined>(undefined);
  const [newEventDate, setNewEventDate] = useState<Date | undefined>(undefined);

  const dateParam = searchParams.get("date");
  const highlightParam = searchParams.get("highlight");
  const viewParam = searchParams.get("view");
  // "My calendar" mixes Google with feeds you've turned on for it;
  // "Assignments" is a dedicated, feeds-only view — some people want their
  // school deadlines visually separate from their personal calendar rather
  // than blended into one grid.
  const [view, setView] = useState<"personal" | "assignments">(
    viewParam === "assignments" ? "assignments" : "personal"
  );

  const initialMonth = useMemo(() => {
    if (!dateParam) return undefined;
    const parsed = new Date(`${dateParam}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }, [dateParam]);

  // A generous explicit maxResults — this page browses month-by-month over
  // the feeds' full year-ahead lookahead (see the API route's
  // FEED_LOOKAHEAD_MS), and the route's default cap of 20 total events
  // (across Google + every feed, merged and sorted by date) would otherwise
  // silently starve later months once ~20 sooner events exist anywhere in
  // that window — easy to hit with even one weekly-lecture feed. Both "My
  // calendar" and "Assignments" derive their own view from this single
  // fetch (see personalEvents/assignmentEvents below), so this can't ask
  // the route to pre-filter by show_on_calendar the way the dashboard's
  // Upcoming widget does — that would remove events the Assignments tab
  // still needs to see.
  //
  // Only fetched once settings confirm there's something to fetch — a null
  // key tells useSWR to skip the request entirely rather than firing one
  // that would just 400/return empty.
  const shouldLoadEvents = !!(settings?.googleCalendarConnected || settings?.hasCalendarFeeds);
  const {
    data: eventsData,
    error: eventsError,
    mutate: refreshEvents,
  } = useSWR<{ events: CalendarEvent[] }>(shouldLoadEvents ? "/api/calendar/events?maxResults=1000" : null);
  const events = eventsData?.events ?? null;
  const loadError = eventsError instanceof Error ? eventsError.message : null;

  function openNewEvent(date?: Date) {
    setEditingEvent(undefined);
    setNewEventDate(date);
    setDialogOpen(true);
  }

  function openEditEvent(event: CalendarEvent) {
    setEditingEvent(event);
    setNewEventDate(undefined);
    setDialogOpen(true);
  }

  async function handleDelete(eventId: string) {
    const res = await fetch(`/api/calendar/events/${eventId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't delete event");
      return;
    }
    toast.success("Event deleted");
    refreshEvents();
  }

  // Feeds are read-only external subscriptions — hiding one here only
  // affects the "My calendar" view, not the Upcoming widget's own
  // show_in_widget toggle (see AssignmentsWidget on the dashboard).
  const hiddenFeedLabels = useMemo(
    () => new Set((feeds ?? []).filter((f) => !f.show_on_calendar).map((f) => f.label)),
    [feeds]
  );
  const personalEvents = useMemo(
    () => events?.filter((event) => !hiddenFeedLabels.has(event.source)) ?? null,
    [events, hiddenFeedLabels]
  );
  // Every feed event, unconditionally — the whole point of this view is to
  // show all of them regardless of the "on calendar"/"in assignments
  // widget" toggles, which only govern the mixed personal view and the
  // dashboard checklist respectively.
  const assignmentEvents = useMemo(
    () => events?.filter((event) => event.source !== "google") ?? null,
    [events]
  );
  const visibleEvents = view === "personal" ? personalEvents : assignmentEvents;

  if (!settings) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (!settings.googleCalendarConnected && !settings.hasCalendarFeeds) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold">Calendar</h1>
        <Card elevation="flat" className="items-center border py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-focus/10">
            <CalendarDays className="size-6 text-focus" />
          </div>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            Connect your Google Calendar or add a calendar feed in Settings to see and manage your
            deliverables and exams here.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Calendar</h1>
        {view === "personal" && settings.googleCalendarConnected && (
          <Button onClick={() => openNewEvent()}>
            <Plus />
            New event
          </Button>
        )}
      </div>

      {feeds && feeds.length > 0 && (
        <div className="inline-flex rounded-lg border bg-muted/30 p-0.5">
          <button
            type="button"
            onClick={() => setView("personal")}
            aria-pressed={view === "personal"}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              view === "personal" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            My calendar
          </button>
          <button
            type="button"
            onClick={() => setView("assignments")}
            aria-pressed={view === "assignments"}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              view === "assignments" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Assignments
          </button>
        </div>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {visibleEvents === null && !loadError && <Skeleton className="h-[500px] rounded-xl" />}

      {visibleEvents && (
        <MonthGrid
          events={visibleEvents}
          onDayClick={(date) => view === "personal" && openNewEvent(date)}
          onEventClick={(event) => openEditEvent(event)}
          initialMonth={initialMonth}
          highlightEventId={highlightParam ?? undefined}
        />
      )}

      <EventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editingEvent}
        initialDate={newEventDate}
        onSaved={refreshEvents}
        onDelete={
          editingEvent
            ? async () => {
                await handleDelete(editingEvent.id);
                setDialogOpen(false);
              }
            : undefined
        }
      />
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageContent />
    </Suspense>
  );
}
