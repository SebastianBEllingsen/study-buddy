"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { isStickerImageUrl } from "@/lib/imageTransparency";
import { shouldShowWallpaper } from "@/lib/appWallpaper";
import { useHeaderReflection } from "@/lib/useHeaderReflection";
import {
  BookOpen,
  CalendarDays,
  Clock,
  FileText,
  Flame,
  GitFork,
  GripVertical,
  Layers,
  ListChecks,
  Palette,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type {
  AppSettings,
  CalendarFeed,
  CourseSummary,
  DueFlashcardItem,
  GenerationNotification,
  HomeWidgetConfig,
  RecentView,
} from "@/lib/models";
import { setDragPayload, readDragPayload } from "@/lib/dragDrop";
import { tileGridStyle } from "@/lib/dashboardGrid";
import { BACKGROUND_ASPECT } from "@/lib/imageCropPresets";
import StudyHeatmap from "@/components/StudyHeatmap";
import LinksWidget from "@/components/LinksWidget";
import PomodoroWidget from "@/components/pomodoro/PomodoroWidget";
import { CustomizeCourseDialog } from "@/components/CustomizeCourseDialog";
import { DashboardCustomizeDialog } from "@/components/DashboardCustomizeDialog";
import { DueFlashcardsDialog } from "@/components/DueFlashcardsDialog";
import { RowActionsMenu } from "@/components/RowActionsMenu";
import { useViewTransitionRouter } from "@/lib/useViewTransitionRouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { EventInfoTooltip } from "@/components/EventInfoTooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
function CourseCard({
  course,
  hasNotification,
  onRename,
  onDelete,
  onReorder,
  onCustomized,
}: {
  course: CourseSummary;
  // Cards due, or a pending generation popup not yet opened/dismissed.
  hasNotification: boolean;
  onRename: (courseId: number, name: string) => Promise<void>;
  onDelete: (courseId: number) => Promise<void>;
  onReorder: (draggedCourseId: number, targetCourseId: number) => void;
  onCustomized: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(course.name);
  const [dragOver, setDragOver] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const { push: pushWithTransition } = useViewTransitionRouter();

  async function commitRename() {
    const trimmed = nameDraft.trim();
    setRenaming(false);
    if (!trimmed || trimmed === course.name) {
      setNameDraft(course.name);
      return;
    }
    await onRename(course.id, trimmed);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const payload = readDragPayload(e);
    if (payload?.kind === "course" && payload.id !== course.id) {
      onReorder(payload.id, course.id);
    }
  }

  // Opt-in (see CustomizeCourseDialog) — the cover banner as the card's own
  // background, with a dark scrim so title/icons stay legible over a busy
  // photo regardless of what's under it.
  const showCoverOnCard = course.show_cover_on_card && !!course.cover_image;
  const mutedIconClass = showCoverOnCard ? "text-white/70" : "text-muted-foreground";
  const noIconFrame = !!course.icon_image && !course.show_icon_frame;

  return (
    <Card
      className={`relative h-full overflow-hidden [contain:paint] transition-shadow hover:shadow-md hover:ring-primary/30 ${
        dragOver ? "ring-2 ring-primary" : ""
      } ${showCoverOnCard ? "bg-cover bg-center text-white" : ""}`}
      style={showCoverOnCard ? { backgroundImage: `url(${course.cover_image})` } : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {showCoverOnCard && <div className="absolute inset-0 bg-black/55" />}
      {hasNotification && (
        // Replaces a former border-l accent: a border sits outside the
        // scrim overlay's reach (box-model gap), so it always showed a
        // sliver of raw, unmuted cover-image color. This dot is painted
        // after the overlay in DOM order, so it stays on top instead.
        <span aria-hidden="true" className="absolute right-2.5 top-2.5 z-10 size-2 rounded-full bg-focus" />
      )}
      <CardContent className="relative flex items-start gap-2">
        <div
          draggable
          onDragStart={(e) => setDragPayload(e, { kind: "course", id: course.id })}
          className="cursor-grab select-none pt-1.5 active:cursor-grabbing"
        >
          <GripVertical className={`size-4 ${mutedIconClass}`} />
        </div>
        <div
          // "No frame" drops the rounded/tinted container entirely so a
          // transparent-background badge reads as a sticker sitting
          // directly on the card, rather than a photo cropped into a box —
          // and uses bg-contain (not bg-cover) so the sticker's own shape
          // isn't cropped to a square.
          className={`flex size-9 shrink-0 items-center justify-center bg-center ${
            noIconFrame
              ? "bg-contain"
              : `overflow-hidden rounded-lg bg-cover ${showCoverOnCard ? "bg-white/15 backdrop-blur-sm" : "bg-muted"}`
          }`}
          style={
            course.icon_image
              ? { backgroundImage: `url(${course.icon_image})` }
              : course.color && !showCoverOnCard
                ? { backgroundColor: `${course.color}26` }
                : undefined
          }
        >
          {!course.icon_image &&
            (course.icon ? (
              <span className="text-base">{course.icon}</span>
            ) : (
              <BookOpen className={`size-4.5 ${mutedIconClass}`} />
            ))}
        </div>
        <div className="min-w-0 flex-1 pt-1">
          {renaming ? (
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                }
                if (e.key === "Escape") {
                  setNameDraft(course.name);
                  setRenaming(false);
                }
              }}
              className="h-7"
            />
          ) : (
            <Link
              href={`/courses/${course.id}`}
              onClick={(e) => {
                // Let modified clicks (new tab, etc.) fall through to normal
                // Link behavior; only intercept a plain left click to add
                // the view transition.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                pushWithTransition(`/courses/${course.id}`);
              }}
            >
              <CardTitle className="truncate">{course.name}</CardTitle>
            </Link>
          )}
        </div>
        {!renaming && (
          <RowActionsMenu
            ariaLabel={`Actions for ${course.name}`}
            triggerIconClassName={mutedIconClass}
            actions={[
              { label: "Rename", icon: Pencil, onSelect: () => setRenaming(true) },
              { label: "Customize appearance", icon: Palette, onSelect: () => setCustomizeOpen(true) },
            ]}
            deleteLabel="Delete course"
            deleteDescription="This permanently deletes all its folders, documents, and generated notes/quizzes/flashcards — including attempt and review history. This can't be undone."
            onDelete={() => onDelete(course.id)}
          />
        )}
      </CardContent>
      <CustomizeCourseDialog
        course={course}
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        onSaved={onCustomized}
      />
    </Card>
  );
}

interface Stats {
  dueFlashcards: { total: number; items: DueFlashcardItem[] };
  generationNotifications: GenerationNotification[];
  streak: number;
  activity: Record<string, number>;
}

// How much a widget shows adapts to how much room it's been given — same
// idea as an iOS/Android home-screen widget rendering less detail at a
// smaller size, not just clipping the same content.
interface WidgetLayout {
  colSpan: number;
  rowSpan: number;
}

function StreakWidget({ stats, transparent }: { stats: Stats; transparent: boolean }) {
  if (stats.streak === 0) {
    return (
      <Card
        elevation="flat"
        className={`h-full items-center justify-center gap-1 overflow-hidden text-center ${transparent ? "" : "border"}`}
      >
        <Flame className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">No streak yet — study today to start one.</p>
      </Card>
    );
  }
  return (
    <Card
      elevation={transparent ? "flat" : "raised"}
      className={`h-full items-center justify-center gap-1 overflow-hidden text-center ${transparent ? "" : "border"}`}
    >
      <span className="stat-glow font-heading text-3xl font-semibold text-amber">{stats.streak}</span>
      <span className="flex items-center gap-1 text-sm text-muted-foreground">
        <Flame className="size-3.5 text-amber" />
        day streak
      </span>
    </Card>
  );
}

function DueCardsWidget({
  stats,
  layout,
  transparent,
}: {
  stats: Stats;
  layout: WidgetLayout;
  transparent: boolean;
}) {
  const { dueFlashcards } = stats;
  const [dialogOpen, setDialogOpen] = useState(false);

  if (dueFlashcards.total === 0) {
    return (
      <Card
        elevation="flat"
        className={`h-full items-center justify-center gap-1 overflow-hidden text-center ${transparent ? "" : "border"}`}
      >
        <Layers className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Nothing due — you&apos;re all caught up.</p>
      </Card>
    );
  }

  // A single row of height doesn't have room for a header plus even one
  // list row, and a narrow column doesn't have room for the list's
  // course-name/count columns — either way this falls back to the same
  // compact number+label look as the streak widget rather than squeezing
  // in a list that doesn't fit. It's clickable either way — resizing the
  // widget shouldn't be the only way to see which sets are due.
  if (layout.colSpan <= 2 || layout.rowSpan === 1) {
    return (
      <>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setDialogOpen(true)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setDialogOpen(true)}
          elevation={transparent ? "flat" : "raised"}
          className={`h-full cursor-pointer items-center justify-center gap-1 overflow-hidden text-center transition-colors hover:bg-muted/40 ${transparent ? "" : "border"}`}
        >
          <span className="stat-glow font-heading text-3xl font-semibold text-amber">
            {dueFlashcards.total}
          </span>
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Layers className="size-3.5" />
            card{dueFlashcards.total === 1 ? "" : "s"} due
          </span>
        </Card>
        <DueFlashcardsDialog open={dialogOpen} onOpenChange={setDialogOpen} items={dueFlashcards.items} />
      </>
    );
  }

  const maxShown = layout.rowSpan >= 3 ? 9 : 6;
  const shown = dueFlashcards.items.slice(0, maxShown);
  const remaining = dueFlashcards.items.length - shown.length;

  return (
    <>
      <Card
        elevation={transparent ? "flat" : "raised"}
        className={`h-full space-y-3 overflow-hidden p-4 ${transparent ? "" : "border"}`}
      >
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="flex items-baseline gap-2 text-left"
        >
          <span className="stat-glow font-heading text-3xl font-semibold text-amber">
            {dueFlashcards.total}
          </span>
          <span className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline">
            <Layers className="size-3.5" />
            card{dueFlashcards.total === 1 ? "" : "s"} due
          </span>
        </button>
        <ul className="space-y-1">
          {shown.map((item) => (
            <li key={item.itemId}>
              <Link
                href={`/items/${item.itemId}`}
                className="flex items-center gap-2 rounded-md px-2 py-1 -mx-2 text-sm hover:bg-muted"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-amber" />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="shrink-0 text-muted-foreground">{item.courseName}</span>
                <span className="shrink-0 text-muted-foreground">{item.dueCount} due</span>
              </Link>
            </li>
          ))}
        </ul>
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="px-2 text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            +{remaining} more set{remaining === 1 ? "" : "s"} with cards due
          </button>
        )}
      </Card>
      <DueFlashcardsDialog open={dialogOpen} onOpenChange={setDialogOpen} items={dueFlashcards.items} />
    </>
  );
}

// Fewer weeks at a narrower width, so squares stay a legible size instead
// of shrinking to fit — a real resize of the content, not a CSS clip.
function HeatmapWidget({
  activity,
  layout,
  transparent,
}: {
  activity: Record<string, number>;
  layout: WidgetLayout;
  transparent: boolean;
}) {
  return (
    <Card
      elevation={transparent ? "flat" : "raised"}
      className={`h-full overflow-hidden p-3 ${transparent ? "" : "border"}`}
    >
      <StudyHeatmap activity={activity} showLabel={layout.rowSpan >= 2} />
    </Card>
  );
}

interface UpcomingCalendarEvent {
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

// A small dot before a feed-sourced event's title (never shown for the
// user's own "google" events, which need no extra label) — a structural
// indicator of which calendar an event came from, not decoration, same
// idea as CourseCard's due-indicator left border. Hashing the label into
// one of the theme's existing semantic tokens means a new feed doesn't
// need a color assigned by hand, and stays stable across reloads.
const SOURCE_DOT_COLORS = ["bg-focus", "bg-amber", "bg-sage"];
function sourceDotColor(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) | 0;
  return SOURCE_DOT_COLORS[Math.abs(hash) % SOURCE_DOT_COLORS.length];
}

// The date a Google Calendar event's `start` represents, in local calendar
// terms. All-day dates are plain "YYYY-MM-DD" strings — building a Date
// straight from that string's own Y/M/D (rather than `new Date(iso)`, which
// parses as UTC midnight) avoids shifting the event a day in negative-UTC
// zones. Timed events use the instant itself, which Date already resolves
// to the viewer's local day.
function eventLocalDate(event: UpcomingCalendarEvent): Date {
  if (event.allDay) {
    const [y, m, d] = event.start.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(event.start);
}

function eventDayLabel(event: UpcomingCalendarEvent): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = eventLocalDate(event);
  day.setHours(0, 0, 0, 0);
  if (day.getTime() === today.getTime()) return "Today";
  if (day.getTime() === tomorrow.getTime()) return "Tomorrow";
  return day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function eventTimeLabel(event: UpcomingCalendarEvent): string {
  if (event.allDay) return "All day";
  return new Date(event.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Links an Upcoming-widget event straight to its own day on /calendar,
// flashed and scrolled into view there (see MonthGrid's highlightEventId in
// calendar/page.tsx) — the same "navigate and highlight" idea already used
// for search results (lib/scrollToHighlight.ts), applied to a specific
// element by id instead of a text match.
function eventCalendarHref(event: UpcomingCalendarEvent): string {
  const day = eventLocalDate(event);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateParam = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  return `/calendar?date=${dateParam}&highlight=${encodeURIComponent(event.id)}`;
}

// Same as above, but for the Assignments widget specifically: that widget's
// events are feed-sourced only, and a feed can be toggled off "On calendar"
// (personal view) while still appearing in the widget — so its links must
// always land on the dedicated Assignments calendar tab, or the highlight
// target might not even be in the personal view's event list.
function assignmentsCalendarHref(event: UpcomingCalendarEvent): string {
  return `${eventCalendarHref(event)}&view=assignments`;
}

// More events at a bigger size — the same "show more detail when there's
// more room" adaptation as the other widgets.
function upcomingMaxResultsFor(layout: WidgetLayout): number {
  const base = layout.colSpan >= 6 ? 5 : layout.colSpan >= 3 ? 4 : 2;
  const bonus = layout.rowSpan >= 3 ? 4 : layout.rowSpan >= 2 ? 2 : 0;
  return base + bonus;
}

// A compact agenda list — like the Google Calendar widget you'd pin to a
// phone's home screen — rather than the full month grid on /calendar.
function UpcomingEventsWidget({
  connected,
  layout,
  label,
  transparent,
}: {
  connected: boolean;
  layout: WidgetLayout;
  label?: string;
  transparent: boolean;
}) {
  const maxResults = upcomingMaxResultsFor(layout);
  // The list's date/time columns need more room than a narrow tile has —
  // below that width it falls back to just the next event, the same
  // compact-number-card look as the streak/due widgets.
  const compact = layout.colSpan <= 2;

  // Cached across navigation (see SWRProvider), and revalidates on window
  // focus — so a switch back to this tab after generating an event
  // elsewhere (or just coming back from /calendar) catches up on its own.
  // excludeHiddenFeeds: a feed toggled off "On calendar" in Settings
  // shouldn't show up here either — done server-side (see
  // api/calendar/events/route.ts) so it's applied BEFORE maxResults caps
  // the result, not after, which could otherwise leave far fewer events
  // visible than maxResults if hidden-feed events crowded the top of the
  // sorted list.
  const { data, error: fetchError } = useSWR<{ events: UpcomingCalendarEvent[] }>(
    connected ? `/api/calendar/events?maxResults=${maxResults}&excludeHiddenFeeds=true` : null
  );
  const events = data?.events ?? null;
  const error = fetchError instanceof Error ? fetchError.message : null;

  if (!connected) {
    return (
      <Card
        elevation="flat"
        className={`h-full items-center justify-center gap-1 overflow-hidden p-2 text-center ${transparent ? "" : "border"}`}
      >
        <CalendarDays className={compact ? "size-5 text-muted-foreground" : "size-5 text-focus"} />
        <p className="text-xs text-muted-foreground">
          {compact
            ? "Connect Calendar"
            : "Connect Google Calendar or add a calendar feed in Settings to see what's coming up here."}
        </p>
      </Card>
    );
  }

  if (compact) {
    const next = events?.[0];
    return (
      <Card
        elevation={transparent ? "flat" : "raised"}
        className={`h-full items-center justify-center gap-1 overflow-hidden p-2 text-center ${transparent ? "" : "border"}`}
      >
        <CalendarDays className="size-5 text-focus" />
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && events === null && <Skeleton className="h-4 w-16 rounded" />}
        {!error && events && !next && <p className="text-xs text-muted-foreground">Nothing coming up.</p>}
        {!error && next && (
          <Link href={eventCalendarHref(next)} className="w-full hover:underline">
            <p className="flex items-center justify-center gap-1.5 truncate text-sm font-medium">
              {next.source !== "google" && (
                <span className={`size-1.5 shrink-0 rounded-full ${sourceDotColor(next.source)}`} />
              )}
              {next.title}
            </p>
            <p className="text-xs text-muted-foreground">{eventDayLabel(next)}</p>
          </Link>
        )}
      </Card>
    );
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-xl ${transparent ? "" : "border"}`}>
      <div
        className={`flex shrink-0 items-center justify-between gap-2 px-4 py-2.5 ${transparent ? "" : "border-b bg-card"}`}
      >
        <span className="flex items-center gap-1.5 font-heading text-sm font-semibold">
          <CalendarDays className="size-4 text-focus" />
          {label ?? "Upcoming"}
        </span>
        <Link href="/calendar" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Open calendar
        </Link>
      </div>
      {/* `min-h-0` is required for a flex child to actually shrink below its
          content size — without it `flex-1` still lets this grow past the
          tile's height, so `overflow-y-auto` never has anything to scroll
          and the list just gets clipped by the parent's `overflow-hidden`
          instead (silently losing events past the visible area). */}
      <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto">
        {error && <p className="px-4 py-6 text-sm text-destructive">{error}</p>}
        {!error && events === null && (
          <div className="space-y-2 p-3">
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
          </div>
        )}
        {!error && events && events.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing coming up.</p>
        )}
        {!error && events && events.length > 0 && (
          <ul className="divide-y">
            {events.map((event) => (
              <li key={event.id}>
                <EventInfoTooltip event={event}>
                  <Link
                    href={eventCalendarHref(event)}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/40"
                  >
                    <span className="w-20 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      {eventDayLabel(event)}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                      {event.source !== "google" && (
                        <span className={`size-1.5 shrink-0 rounded-full ${sourceDotColor(event.source)}`} />
                      )}
                      <span className="min-w-0 flex-1 truncate">{event.title}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{eventTimeLabel(event)}</span>
                  </Link>
                </EventInfoTooltip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Which feeds actually feed into "assignments due" (show_in_widget) is
// configured in Settings now, not here — this widget is a checklist of the
// *assignments themselves*: each one can be ticked off (persisted via
// /api/assignments/completed, keyed by the feed event's own id) and gets a
// green/checkmark treatment once done. Only feed-sourced events show here —
// the user's own Google events already have the Upcoming widget.
function AssignmentsWidget({
  feeds,
  layout,
  label,
  transparent,
}: {
  feeds: CalendarFeed[] | null;
  layout: WidgetLayout;
  label?: string;
  transparent: boolean;
}) {
  // Cached across navigation, revalidates on focus — see UpcomingEventsWidget.
  const { data: eventsData, error: fetchError } = useSWR<{ events: UpcomingCalendarEvent[] }>(
    "/api/calendar/events?maxResults=50"
  );
  const events = eventsData?.events ?? null;
  const error = fetchError instanceof Error ? fetchError.message : null;

  const { data: completedData, mutate: mutateCompleted } = useSWR<{ ids: string[] }>(
    "/api/assignments/completed"
  );
  const completedIds = completedData ? new Set(completedData.ids) : null;
  const compact = layout.colSpan <= 2 || layout.rowSpan === 1;

  async function toggleCompleted(eventId: string) {
    const wasCompleted = completedIds?.has(eventId) ?? false;
    const optimisticIds = new Set(completedData?.ids ?? []);
    if (wasCompleted) optimisticIds.delete(eventId);
    else optimisticIds.add(eventId);
    try {
      // Shows the optimistic result immediately; SWR rolls the cache back
      // to what it was before if the request rejects, matching the manual
      // set/rollback this used to do by hand.
      await mutateCompleted(
        fetch("/api/assignments/completed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, completed: !wasCompleted }),
        }).then((res) => {
          if (!res.ok) throw new Error("Couldn't save that");
          return { ids: Array.from(optimisticIds) };
        }),
        { optimisticData: { ids: Array.from(optimisticIds) }, rollbackOnError: true }
      );
    } catch {
      toast.error("Couldn't save that");
    }
  }

  if (feeds && feeds.length === 0) {
    return (
      <Card
        elevation="flat"
        className={`h-full items-center justify-center gap-1 overflow-hidden p-2 text-center ${transparent ? "" : "border"}`}
      >
        <ListChecks className={compact ? "size-5 text-muted-foreground" : "size-5 text-focus"} />
        <p className="text-xs text-muted-foreground">
          {compact ? "Add a feed" : "Add a calendar feed in Settings to track it here."}
        </p>
      </Card>
    );
  }

  const enabledLabels = new Set((feeds ?? []).filter((f) => f.show_in_widget).map((f) => f.label));
  const assignments = (events ?? []).filter((e) => enabledLabels.has(e.source));
  const loading = events === null || feeds === null || completedIds === null;

  if (compact) {
    const next = assignments.find((e) => !completedIds?.has(e.id)) ?? assignments[0];
    return (
      <Card
        elevation={transparent ? "flat" : "raised"}
        className={`h-full items-center justify-center gap-1 overflow-hidden p-2 text-center ${transparent ? "" : "border"}`}
      >
        <ListChecks className="size-5 text-focus" />
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && loading && <Skeleton className="h-4 w-16 rounded" />}
        {!error && !loading && !next && <p className="text-xs text-muted-foreground">Nothing due.</p>}
        {!error && next && (
          <Link href={assignmentsCalendarHref(next)} className="w-full hover:underline">
            <p className="truncate text-sm font-medium">{next.title}</p>
            <p className="text-xs text-muted-foreground">{eventDayLabel(next)}</p>
          </Link>
        )}
      </Card>
    );
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-xl ${transparent ? "" : "border"}`}>
      <div
        className={`flex shrink-0 items-center justify-between gap-2 px-4 py-2.5 ${transparent ? "" : "border-b bg-card"}`}
      >
        <span className="flex items-center gap-1.5 font-heading text-sm font-semibold">
          <ListChecks className="size-4 text-focus" />
          {label ?? "Assignments"}
        </span>
        <Link
          href="/calendar?view=assignments"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Open calendar
        </Link>
      </div>
      <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto">
        {error && <p className="px-4 py-6 text-sm text-destructive">{error}</p>}
        {!error && loading && (
          <div className="space-y-2 p-3">
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
          </div>
        )}
        {!error && !loading && assignments.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing due from the selected feeds.</p>
        )}
        {!error && assignments.length > 0 && (
          <ul className="divide-y">
            {assignments.map((event) => {
              const done = completedIds?.has(event.id) ?? false;
              return (
                <li
                  key={event.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/40",
                    done && "bg-sage/10"
                  )}
                >
                  <Checkbox
                    checked={done}
                    onCheckedChange={() => toggleCompleted(event.id)}
                    aria-label={done ? `Mark ${event.title} as not done` : `Mark ${event.title} as done`}
                  />
                  <EventInfoTooltip event={event}>
                    <Link
                      href={assignmentsCalendarHref(event)}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <span className="w-20 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                        {eventDayLabel(event)}
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                        <span className={`size-1.5 shrink-0 rounded-full ${sourceDotColor(event.source)}`} />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate",
                            done && "text-muted-foreground line-through"
                          )}
                        >
                          {event.title}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{eventTimeLabel(event)}</span>
                    </Link>
                  </EventInfoTooltip>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function recentViewHref(view: RecentView): string {
  if (view.type === "note") return `/vault/${view.id}`;
  if (view.type === "document") return `/courses/${view.courseId}?document=${view.id}`;
  if (view.type === "canvas") return `/canvas/${view.id}`;
  return `/items/${view.id}`;
}

function RecentViewIcon({ type }: { type: RecentView["type"] }) {
  const className = "size-3.5 shrink-0 text-muted-foreground";
  if (type === "note") return <StickyNote className={className} />;
  if (type === "document") return <FileText className={className} />;
  if (type === "canvas") return <GitFork className={className} />;
  return <Sparkles className={className} />;
}

// Coarse "how long ago" — this widget only ever needs a rough sense of
// recency (minutes/hours/days), not a precise timestamp, so a small local
// formatter is simpler than pulling in a date-relative-time library for it.
function formatRelativeTime(utcString: string): string {
  const then = new Date(utcString.replace(" ", "T") + "Z").getTime();
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function RecentActivityWidget({
  layout,
  label,
  transparent,
}: {
  layout: WidgetLayout;
  label?: string;
  transparent: boolean;
}) {
  // Cached across navigation, revalidates on focus — see UpcomingEventsWidget.
  const { data, error: fetchError } = useSWR<{ views: RecentView[] }>("/api/recent-views");
  const views = data?.views ?? null;
  const error = fetchError instanceof Error ? fetchError.message : null;
  const compact = layout.colSpan <= 2 || layout.rowSpan === 1;

  const loading = views === null;
  const list = views ?? [];

  if (compact) {
    const next = views?.[0];
    return (
      <Card
        elevation={transparent ? "flat" : "raised"}
        className={`h-full items-center justify-center gap-1 overflow-hidden p-2 text-center ${transparent ? "" : "border"}`}
      >
        <Clock className="size-5 text-focus" />
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && loading && <Skeleton className="h-4 w-16 rounded" />}
        {!error && !loading && !next && <p className="text-xs text-muted-foreground">Nothing viewed yet.</p>}
        {!error && next && (
          <Link href={recentViewHref(next)} className="w-full hover:underline">
            <p className="truncate text-sm font-medium">{next.title}</p>
            <p className="text-xs text-muted-foreground">{formatRelativeTime(next.viewedAt)}</p>
          </Link>
        )}
      </Card>
    );
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-xl ${transparent ? "" : "border"}`}>
      <div
        className={`flex shrink-0 items-center justify-between gap-2 px-4 py-2.5 ${transparent ? "" : "border-b bg-card"}`}
      >
        <span className="flex items-center gap-1.5 font-heading text-sm font-semibold">
          <Clock className="size-4 text-focus" />
          {label ?? "Recent activity"}
        </span>
      </div>
      <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto">
        {error && <p className="px-4 py-6 text-sm text-destructive">{error}</p>}
        {!error && loading && (
          <div className="space-y-2 p-3">
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
          </div>
        )}
        {!error && !loading && list.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Nothing viewed yet — open a note, document, or generated item to see it here.
          </p>
        )}
        {!error && list.length > 0 && (
          <ul className="divide-y">
            {list.map((view) => (
              <li key={`${view.type}-${view.id}`}>
                <Link
                  href={recentViewHref(view)}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/40"
                >
                  <RecentViewIcon type={view.type} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{view.title}</span>
                    <span className="truncate text-xs text-muted-foreground">{view.courseName}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(view.viewedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// useSearchParams (only used for the Google Calendar OAuth redirect toast
// below) needs a Suspense boundary somewhere above it for static
// generation — see the default export at the bottom of this file.
function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Every one of these is cached across navigation and revalidates on
  // window focus (see SWRProvider) — coming back to "/" shows the whole
  // dashboard instantly from cache instead of every widget blanking out
  // and re-fetching from zero, which was the actual "weird pop-in".
  const { data: courses, mutate: refresh } = useSWR<CourseSummary[]>("/api/courses");
  const { data: stats } = useSWR<Stats>("/api/stats");
  const { data: settings, mutate: mutateSettings } = useSWR<AppSettings>("/api/settings");
  useHeaderReflection(settings?.dashboardBackgroundImage);
  const { data: feedsData } = useSWR<{ feeds: CalendarFeed[] }>("/api/calendar-feeds");
  const feeds = feedsData?.feeds ?? null;
  const [dashboardCustomizeOpen, setDashboardCustomizeOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);

  // Landed back here from the Google Calendar OAuth redirect (see
  // api/calendar/oauth/callback/route.ts) — surface the result once, then
  // drop the query params so refreshing/sharing the URL doesn't re-show it.
  useEffect(() => {
    const connected = searchParams.get("calendarConnected");
    const error = searchParams.get("calendarError");
    if (!connected && !error) return;
    if (connected) toast.success("Connected Google Calendar");
    if (error) toast.error(error);
    router.replace("/", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        toast.error("Couldn't create the course");
        return;
      }
      const course = await res.json();
      setOpen(false);
      router.push(`/courses/${course.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(courseId: number, newName: string) {
    await fetch(`/api/courses/${courseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    refresh();
  }

  async function handleDelete(courseId: number) {
    const res = await fetch(`/api/courses/${courseId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete the course");
      return;
    }
    toast.success("Course deleted");
    refresh();
  }

  async function handleReorder(draggedCourseId: number, targetCourseId: number) {
    if (!courses) return;
    const current = courses.map((c) => c.id);
    const from = current.indexOf(draggedCourseId);
    const to = current.indexOf(targetCourseId);
    if (from === -1 || to === -1) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, draggedCourseId);

    const res = await fetch("/api/courses/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next }),
    }).catch(() => null);
    if (!res?.ok) toast.error("Couldn't reorder courses");
    refresh();
  }

  // Updates local state immediately (so the dashboard behind the customize
  // dialog reflects every drag/toggle live) and persists in the background.
  async function persistHomeWidgets(next: HomeWidgetConfig[]) {
    mutateSettings((prev) => (prev ? { ...prev, homeWidgets: next } : prev), { revalidate: false });
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeWidgets: next }),
      });
      if (!res.ok) toast.error("Couldn't save dashboard layout");
    } catch {
      toast.error("Couldn't save dashboard layout");
    }
  }

  // The dot on a course's card — either it has cards due, or it has a
  // pending "just generated" popup it hasn't been opened/dismissed yet (see
  // Settings' "jump to newly generated content automatically" and the
  // matching banner on the course page itself).
  const coursesWithNotification = new Set([
    ...(stats?.dueFlashcards.items.map((i) => i.courseId) ?? []),
    ...(stats?.generationNotifications.map((n) => n.courseId) ?? []),
  ]);

  const newCourseDialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        New course
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>New course</DialogTitle>
            <DialogDescription>
              Give it a name — you&apos;ll upload PDFs and organize them into folders next.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="course-name">Name</Label>
            <Input
              id="course-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Organic Chemistry"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? "Creating…" : "Create course"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  const transparentWidgets = settings?.dashboardTransparentWidgets ?? false;

  function renderWidget(widget: HomeWidgetConfig) {
    const layout: WidgetLayout = { colSpan: widget.colSpan, rowSpan: widget.rowSpan };
    switch (widget.id) {
      case "streak":
        return stats && <StreakWidget key="streak" stats={stats} transparent={transparentWidgets} />;
      case "due":
        return (
          stats && (
            <DueCardsWidget key="due" stats={stats} layout={layout} transparent={transparentWidgets} />
          )
        );
      case "heatmap":
        return (
          stats && (
            <HeatmapWidget
              key="heatmap"
              activity={stats.activity}
              layout={layout}
              transparent={transparentWidgets}
            />
          )
        );
      case "calendar":
        return (
          <UpcomingEventsWidget
            key="calendar"
            connected={!!settings?.googleCalendarConnected || !!settings?.hasCalendarFeeds}
            layout={layout}
            label={widget.label}
            transparent={transparentWidgets}
          />
        );
      case "assignments":
        return (
          <AssignmentsWidget
            key="assignments"
            feeds={feeds}
            layout={layout}
            label={widget.label}
            transparent={transparentWidgets}
          />
        );
      case "recent":
        return (
          <RecentActivityWidget
            key="recent"
            layout={layout}
            label={widget.label}
            transparent={transparentWidgets}
          />
        );
      case "pomodoro":
        return (
          <PomodoroWidget key="pomodoro" layout={layout} label={widget.label} transparent={transparentWidgets} />
        );
      case "links":
        return <LinksWidget key="links" layout={layout} label={widget.label} transparent={transparentWidgets} />;
    }
  }

  const topWidgets = settings?.homeWidgets.filter((w) => w.enabled && w.zone === "top") ?? [];
  const bottomWidgets = settings?.homeWidgets.filter((w) => w.enabled && w.zone === "bottom") ?? [];

  const hasBanner = !!settings?.dashboardBackgroundImage;
  // A transparent PNG backdrop — see lib/imageTransparency.ts. Skips the
  // dark top tint, which would show as a grey band through its see-through
  // areas.
  const stickerBackdrop = isStickerImageUrl(settings?.dashboardBackgroundImage);
  // With the app wallpaper behind the dashboard too (its "Dashboard" area),
  // the banner fades out into it — the image masked away toward the bottom
  // and no fade into the solid page color — instead of ending on a band of
  // plain background, same as a course page's header.
  const overWallpaper =
    !!settings && shouldShowWallpaper(settings.appWallpaper, settings.dashboardBackgroundImage, "/");
  const fadeMask = overWallpaper ? "linear-gradient(to bottom, #000 45%, transparent)" : undefined;
  const fadeTo = overWallpaper ? "to-transparent" : "to-background";
  const bannerStyle = settings?.dashboardBannerStyle ?? "overlap";
  const lockCrop = !!settings?.dashboardLockBackgroundCrop;
  // "Backdrop" (locked or not) is the style where the picture is meant to
  // read as a real backdrop behind the page rather than a small banner up
  // top — see the stacking/absolute-fill treatment further down.
  const isBackdropStyle = hasBanner && (bannerStyle === "backdrop" || lockCrop);
  const fullPageBackdrop = isBackdropStyle && !!settings?.dashboardBackdropFullPage;

  const dashboardSection = settings && (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Your dashboard</h2>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 text-xs"
          onClick={() => setDashboardCustomizeOpen(true)}
        >
          <SlidersHorizontal className="size-3.5" />
          Customize
        </Button>
      </div>
      {topWidgets.length === 0 ? (
        <Card elevation="flat" className={`items-center py-8 text-center ${transparentWidgets ? "" : "border"}`}>
          <p className="text-sm text-muted-foreground">
            Nothing here — add a widget from Customize.
          </p>
        </Card>
      ) : (
        <div className="dashboard-grid">
          {topWidgets.map((w) => (
            <div key={w.id} className="dashboard-tile" style={tileGridStyle(w)}>
              {renderWidget(w)}
            </div>
          ))}
        </div>
      )}
      <DashboardCustomizeDialog
        open={dashboardCustomizeOpen}
        onOpenChange={setDashboardCustomizeOpen}
        widgets={settings.homeWidgets}
        onChange={persistHomeWidgets}
        renderContent={renderWidget}
      />
    </div>
  );

  const coursesSection = (
    <>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Your courses</h1>
        {courses !== undefined && courses.length > 0 && newCourseDialog}
      </div>

      {courses === undefined && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {courses?.length === 0 && (
        <Card elevation="flat" className="items-center border py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-focus/10">
            <BookOpen className="size-6 text-focus" />
          </div>
          <div className="space-y-1">
            <p className="font-heading text-lg font-semibold">An empty shelf</p>
            <p className="text-sm text-muted-foreground">
              Add a course, upload its PDFs, and generate notes, quizzes, or flashcards from them.
            </p>
          </div>
          {newCourseDialog}
        </Card>
      )}

      {courses && courses.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              hasNotification={coursesWithNotification.has(course.id)}
              onRename={handleRename}
              onDelete={handleDelete}
              onReorder={handleReorder}
              onCustomized={refresh}
            />
          ))}
        </div>
      )}
    </>
  );

  // A second, independent widget zone below the course list — same catalog
  // as the one above, positioned separately (see HomeWidgetConfig's
  // `zone`). Only rendered once something's actually there, unlike the top
  // zone's empty-state card: an empty box appearing under the courses list
  // by default (before anyone's ever touched Customize) would just be
  // clutter for a feature most people won't reach for right away.
  const bottomWidgetsSection = bottomWidgets.length > 0 && (
    <div className="dashboard-grid">
      {bottomWidgets.map((w) => (
        <div key={w.id} className="dashboard-tile" style={tileGridStyle(w)}>
          {renderWidget(w)}
        </div>
      ))}
    </div>
  );

  // Everything that should sit stacked on top of (or, for unlocked
  // backdrop, absolutely filling) the backdrop image itself — the top
  // widgets and the course grid always; the second widget zone too once
  // "Full-page backdrop" is on. Whatever's left over (bottomWidgetsSection,
  // when not full-page) renders after the backdrop box in plain flow —
  // see stackedContent/remainderContent below.
  const backdropContent = (
    <>
      {dashboardSection}
      {coursesSection}
      {fullPageBackdrop && bottomWidgetsSection}
    </>
  );

  return (
    <>
      {/* Both banner styles pull themselves up past the page's top padding,
          so the picture starts right at the header's bottom edge — same as
          a course page's backdrop. */}
      {hasBanner && bannerStyle === "overlap" && !lockCrop && (
        // Same full-bleed, Steam-library-style treatment as a course page's
        // page_background_image — see courses/[courseId]/page.tsx. The
        // dashboard section right below gets pulled up into this image's
        // bottom edge (see the negative margin further down) rather than
        // just sitting underneath it — see Settings' "Banner style".
        <div className="relative left-1/2 -mx-[50vw] right-1/2 -mt-6 w-screen sm:-mt-8">
          <div
            data-page-backdrop={settings.dashboardBackgroundImage}
            className="relative h-56 overflow-hidden bg-cover bg-center sm:h-64"
            style={{ backgroundImage: `url(${settings.dashboardBackgroundImage})`, maskImage: fadeMask }}
          >
            <div
              className={`absolute inset-0 bg-gradient-to-t ${overWallpaper ? "from-transparent" : "from-background"} via-background/40 ${stickerBackdrop ? "to-transparent" : "to-black/10"}`}
            />
          </div>
        </div>
      )}
    <div className="space-y-6">
      {isBackdropStyle ? (
        // The image sits behind everything in backdropContent as a genuine
        // backdrop, not a small banner: both "Backdrop" banner style and
        // locking the crop (which forces this treatment regardless of
        // style — see the "Lock exact crop" setting) want the picture to
        // actually read as a background behind the page, not just a strip
        // up top. By default that covers the top widgets and the course
        // grid, fading out (via the gradient) before the second widget
        // zone below the courses — "Full-page backdrop" extends it behind
        // that too, so nothing sits on the plain page background at all.
        //
        // Unlocked "backdrop" sizes the image to match backdropContent's
        // height exactly (absolute inset-0 fills whatever box its normal
        // flow establishes, so it never bleeds past it). Locked crop can't
        // do that (an exact aspect-ratio crop can't also stretch to an
        // arbitrary content height) — it keeps its own aspect-ratio height
        // instead, decoupled from content, which is often taller than the
        // content on a wide screen. Image, gradient and content are
        // stacked into the same CSS grid cell (all row/col-start-1) rather
        // than the image being absolutely positioned, so the grid
        // auto-sizes their shared row to whichever of them is tallest —
        // the wrapper's own box actually grows to contain the full
        // locked-aspect image (pushing whatever comes after it properly
        // below) instead of the image bleeding past a box sized only to
        // the shorter content.
        <div className="relative left-1/2 -mx-[50vw] right-1/2 -mt-6 w-screen sm:-mt-8">
          {lockCrop ? (
            <div className="grid overflow-hidden">
              <div
                data-page-backdrop={settings.dashboardBackgroundImage}
                className="col-start-1 row-start-1 self-start bg-center"
                style={{
                  backgroundImage: `url(${settings.dashboardBackgroundImage})`,
                  aspectRatio: BACKGROUND_ASPECT,
                  backgroundSize: "100% 100%",
                  maskImage: fadeMask,
                }}
              />
              <div
                className={`col-start-1 row-start-1 self-start bg-gradient-to-b ${stickerBackdrop ? "from-transparent" : "from-black/10"} via-background/70 ${fadeTo}`}
                style={{ aspectRatio: BACKGROUND_ASPECT }}
              />
              <div className="relative col-start-1 row-start-1 mx-auto max-w-5xl space-y-6 px-4 pt-6 pb-8 sm:px-6 sm:pt-8">
                {backdropContent}
              </div>
            </div>
          ) : (
            <>
              <div
                data-page-backdrop={settings.dashboardBackgroundImage}
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${settings.dashboardBackgroundImage})`, maskImage: fadeMask }}
              />
              <div
                className={`absolute inset-0 bg-gradient-to-b ${stickerBackdrop ? "from-transparent" : "from-black/10"} via-background/70 ${fadeTo}`}
              />
              <div className="relative mx-auto max-w-5xl space-y-6 px-4 pt-6 pb-8 sm:px-6 sm:pt-8">
                {backdropContent}
              </div>
            </>
          )}
        </div>
      ) : (
        // "overlap" (or no banner at all, where this negative margin is
        // simply never applied) — see the comment on the banner block above.
        <div className={hasBanner ? "relative -mt-12 space-y-6 sm:-mt-16" : "space-y-6"}>
          {dashboardSection}
          {coursesSection}
          {bottomWidgetsSection}
        </div>
      )}

      {isBackdropStyle && !fullPageBackdrop && bottomWidgetsSection}
    </div>
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageContent />
    </Suspense>
  );
}
