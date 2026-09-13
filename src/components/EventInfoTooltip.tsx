"use client";

import { ExternalLink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Duck-typed rather than importing a shared CalendarEvent — page.tsx and
// calendar/page.tsx each declare their own local copy of that shape (this
// app's established convention for small page-local types), and this only
// needs the fields relevant to the tooltip itself.
interface EventInfo {
  description: string | null;
  htmlLink: string | null;
  start: string;
  end: string;
  allDay: boolean;
}

function formatEventRange(event: EventInfo): string {
  if (event.allDay) return "All day";
  const start = new Date(event.start);
  const end = new Date(event.end);
  const timeFmt = { hour: "numeric", minute: "2-digit" } as const;
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${start.toLocaleTimeString(undefined, timeFmt)} – ${end.toLocaleTimeString(undefined, timeFmt)}`
    : `${start.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} – ${end.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

// Wraps an event row/chip with a hover tooltip showing its time range,
// description (when the source feed/Google event has one), and — this is
// the "take me to its Canvas page" ask — a link to htmlLink when present.
// A Canvas ICS feed's VEVENT carries this as a URL;VALUE=URI property (see
// calendarFeeds.ts); Google events already point back to the Google
// Calendar event page. Renders children unwrapped when there's nothing to
// show, so callers don't need to check first.
export function EventInfoTooltip({ event, children }: { event: EventInfo; children: React.ReactNode }) {
  if (!event.description && !event.htmlLink) return <>{children}</>;

  return (
    <Tooltip>
      {/* `block`, not `contents` — a `display: contents` wrapper has no
          box of its own, so the browser never fires pointerenter/leave on
          it and the tooltip's hover detection never triggers. */}
      <TooltipTrigger render={<span className="block" />}>{children}</TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1.5 whitespace-normal">
        <p className="text-background/70">{formatEventRange(event)}</p>
        {event.description && <p className="line-clamp-5 whitespace-pre-line">{event.description}</p>}
        {event.htmlLink && (
          <a
            href={event.htmlLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 font-medium underline underline-offset-2"
          >
            <ExternalLink className="size-3" />
            Open
          </a>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
