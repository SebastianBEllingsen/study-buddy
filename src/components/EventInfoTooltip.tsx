"use client";

import { Clock, ExternalLink, MapPin, NotebookText } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Duck-typed rather than importing a shared CalendarEvent — page.tsx and
// calendar/page.tsx each declare their own local copy of that shape (this
// app's established convention for small page-local types), and this only
// needs the fields relevant to the tooltip itself.
interface EventInfo {
  title: string;
  description: string | null;
  location: string | null;
  htmlLink: string | null;
  start: string;
  end: string;
  allDay: boolean;
  source: string;
}

// Same rotation calendar/page.tsx's month-view chips hash a feed's dot color
// from — duplicated here (not imported) rather than sharing a module, so
// this card's swatch always agrees with that dot for the same source string
// without the two pages needing to coordinate on where the logic lives.
const SOURCE_DOT_COLORS = ["bg-focus", "bg-amber", "bg-sage"];
function sourceDotColor(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) | 0;
  return SOURCE_DOT_COLORS[Math.abs(hash) % SOURCE_DOT_COLORS.length];
}

function formatEventDateTime(event: EventInfo): string {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const dateStr = start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (event.allDay) return dateStr;
  const timeFmt = { hour: "numeric", minute: "2-digit" } as const;
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${dateStr} ⋅ ${start.toLocaleTimeString(undefined, timeFmt)} – ${end.toLocaleTimeString(undefined, timeFmt)}`
    : `${start.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })} – ${end.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}`;
}

// Wraps an event row/chip with a Google-Calendar-style hover card: a
// colored swatch, the title, then date/time — always, same as Google always
// shows at least that much — and location/description rows when the source
// event actually has them, plus an "Open" link to htmlLink when present
// (a Canvas assignment page, or the event's own Google Calendar page).
export function EventInfoTooltip({ event, children }: { event: EventInfo; children: React.ReactNode }) {
  const dotColor = event.source === "google" ? "bg-focus" : sourceDotColor(event.source);

  return (
    <Tooltip>
      {/* `block`, not `contents` — a `display: contents` wrapper has no
          box of its own, so the browser never fires pointerenter/leave on
          it and the tooltip's hover detection never triggers. */}
      <TooltipTrigger render={<span className="block" />}>{children}</TooltipTrigger>
      <TooltipContent className="w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-lg bg-popover p-3 text-popover-foreground whitespace-normal ring-1 ring-foreground/10 shadow-md">
        <div className="flex items-start gap-2">
          <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${dotColor}`} />
          <p className="font-medium leading-snug">{event.title}</p>
        </div>
        <div className="space-y-1.5 pl-[1.125rem] text-xs text-muted-foreground">
          <div className="flex items-start gap-1.5">
            <Clock className="mt-0.5 size-3.5 shrink-0" />
            <span>{formatEventDateTime(event)}</span>
          </div>
          {event.location && (
            <div className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              <span>{event.location}</span>
            </div>
          )}
          {event.description && (
            <div className="flex items-start gap-1.5">
              <NotebookText className="mt-0.5 size-3.5 shrink-0" />
              <span className="line-clamp-5 whitespace-pre-line">{event.description}</span>
            </div>
          )}
        </div>
        {event.htmlLink && (
          <a
            href={event.htmlLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 pl-[1.125rem] text-xs font-medium text-focus underline underline-offset-2"
          >
            <ExternalLink className="size-3" />
            Open
          </a>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
