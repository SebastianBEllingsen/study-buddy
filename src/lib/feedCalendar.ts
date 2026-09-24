// Pure helpers for a feed's own /calendar tab (components/calendar/
// FeedWeekView.tsx) — no db or server imports, so both the PATCH route
// (validating a saved config) and the client (rendering it) share one
// definition of the config shape, the colour palette, and how a feed
// event's title splits into course code + type.

// Pastel block colours matching a university timetable's look — dark text
// on a light fill with a stronger border, in both themes (the fill is the
// signal, not something that should invert with the app theme).
export const PALETTE = {
  green: { bg: "#a8e4b3", border: "#36b85a" },
  pink: { bg: "#fcc4dc", border: "#e0558f" },
  blue: { bg: "#aad7f7", border: "#3b93d9" },
  yellow: { bg: "#fde9a5", border: "#e0b20b" },
  purple: { bg: "#d9cbfb", border: "#8b5cf6" },
  orange: { bg: "#fdd0a8", border: "#f28a2e" },
  teal: { bg: "#a5e8e0", border: "#14a898" },
  grey: { bg: "#e4e4e4", border: "#9ca3af" },
} as const;

export type PaletteKey = keyof typeof PALETTE;

export const PALETTE_KEYS = Object.keys(PALETTE) as PaletteKey[];

// Grey is kept back for events with no course code (a room booking, a
// generic event) so it reads as "not a course" rather than landing on some
// course by hash.
const AUTO_KEYS = PALETTE_KEYS.filter((k) => k !== "grey");

export function isPaletteKey(value: unknown): value is PaletteKey {
  return typeof value === "string" && (PALETTE_KEYS as string[]).includes(value);
}

// Same string hash as /calendar's sourceDotColor, so a course's colour is
// stable across reloads without anyone having to assign one.
export function autoCourseColor(code: string | null): PaletteKey {
  if (!code) return "grey";
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) | 0;
  return AUTO_KEYS[Math.abs(hash) % AUTO_KEYS.length];
}

// "IKT300 Forelesning" → { code: "IKT300", type: "Forelesning" };
// "MA-224 Lecture 2" → { code: "MA-224", type: "Lecture 2" }. Mine
// Studier titles its Canvas deadlines the other way round ("Assignment -
// MA-224"), so a trailing " - CODE" is recognized too. A title without a
// course code (e.g. "Bookings Booking") comes back whole as the type with a
// null code. An optional "-1"-style group suffix on the code is dropped so
// every group of one course shares a colour.
const CODE = "[A-ZÆØÅ]{2,6}-?\\d{2,4}[A-Z]?";
const LEADING_CODE_RE = new RegExp(`^(${CODE})(?:-\\d{1,2})?(?:\\s*[-–:]\\s*|\\s+|$)(.*)$`);
const TRAILING_CODE_RE = new RegExp(`^(.+?)\\s+[-–]\\s+(${CODE})$`);

export function parseCourseEvent(title: string): { code: string | null; type: string } {
  const trimmed = title.trim();
  const leading = trimmed.match(LEADING_CODE_RE);
  if (leading) return { code: leading[1], type: leading[2].trim() };
  const trailing = trimmed.match(TRAILING_CODE_RE);
  if (trailing) return { code: trailing[2], type: trailing[1].trim() };
  return { code: null, type: trimmed };
}

// A deadline rather than a scheduled session — gets a check icon on its
// block. Zero-length events are deadlines by shape; Mine Studier gives its
// Canvas assignments a nominal hour, so those are recognized by type.
export function isDeadlineEvent(type: string, start: string, end: string): boolean {
  return start === end || /^assignment\b/i.test(type);
}

// "C-bygget Grimstad C2 041 https://link.mazemap.com/…" → "C C2 041", the
// compact form the student portal shows on a timetable block. The map link
// is returned separately so the details popover can still offer it.
export function shortLocation(location: string): { text: string; mapUrl: string | null } {
  const mapUrl = location.match(/https?:\/\/\S+/)?.[0] ?? null;
  const text = location
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b([A-Z])-bygget(?: Grimstad| Kristiansand)?\b/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
  return { text, mapUrl };
}

export interface CourseSettings {
  color?: PaletteKey;
  alias?: string;
}

export interface FeedCalendarConfig {
  hourStart: number;
  hourEnd: number;
  showWeekends: boolean;
  defaultView: "week" | "month";
  courses: Record<string, CourseSettings>;
}

export const DEFAULT_FEED_CALENDAR_CONFIG: FeedCalendarConfig = {
  hourStart: 8,
  hourEnd: 20,
  showWeekends: true,
  defaultView: "week",
  courses: {},
};

const MAX_ALIAS_LENGTH = 40;
const MAX_COURSES = 100;

function clampHour(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(24, Math.max(0, value)) : fallback;
}

// Accepts the raw DB text, an already-parsed object (a PATCH body), or
// null, and always returns a complete, valid config — anything malformed
// falls back field-by-field to the defaults rather than rejecting the whole
// thing, so one bad value can never leave the tab unrenderable.
export function parseFeedCalendarConfig(raw: unknown): FeedCalendarConfig {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  }
  if (!obj || typeof obj !== "object") return { ...DEFAULT_FEED_CALENDAR_CONFIG, courses: {} };
  const o = obj as Record<string, unknown>;

  let hourStart = clampHour(o.hourStart, DEFAULT_FEED_CALENDAR_CONFIG.hourStart);
  let hourEnd = clampHour(o.hourEnd, DEFAULT_FEED_CALENDAR_CONFIG.hourEnd);
  if (hourStart >= hourEnd) {
    hourStart = DEFAULT_FEED_CALENDAR_CONFIG.hourStart;
    hourEnd = DEFAULT_FEED_CALENDAR_CONFIG.hourEnd;
  }

  const courses: Record<string, CourseSettings> = {};
  if (o.courses && typeof o.courses === "object") {
    for (const [code, value] of Object.entries(o.courses as Record<string, unknown>).slice(0, MAX_COURSES)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const entry: CourseSettings = {};
      if (isPaletteKey(v.color)) entry.color = v.color;
      if (typeof v.alias === "string" && v.alias.trim()) entry.alias = v.alias.trim().slice(0, MAX_ALIAS_LENGTH);
      if (entry.color || entry.alias) courses[code.slice(0, 20)] = entry;
    }
  }

  return {
    hourStart,
    hourEnd,
    showWeekends: typeof o.showWeekends === "boolean" ? o.showWeekends : DEFAULT_FEED_CALENDAR_CONFIG.showWeekends,
    defaultView: o.defaultView === "month" ? "month" : "week",
    courses,
  };
}

export interface LayoutInput {
  id: string;
  // Minutes from the start of the day.
  start: number;
  end: number;
}

export interface LayoutBox {
  id: string;
  // Percent of the day column's width.
  left: number;
  width: number;
  z: number;
}

// Events starting within this many minutes of each other sit side by side;
// one starting later than that inside an already-running block is drawn on
// top of it with a small left inset instead (a short lecture inside a long
// lab session), matching how the student portal's own timetable does it.
const SIDE_BY_SIDE_MINUTES = 30;
const NESTED_INSET_PERCENT = 6;

export function layoutDayEvents(events: LayoutInput[]): LayoutBox[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const groups: LayoutInput[][] = [];
  for (const event of sorted) {
    const current = groups[groups.length - 1];
    if (
      current &&
      event.start - current[0].start < SIDE_BY_SIDE_MINUTES &&
      current.some((other) => other.end > event.start)
    ) {
      current.push(event);
    } else {
      groups.push([event]);
    }
  }

  const placed: (LayoutBox & LayoutInput)[] = [];
  for (const group of groups) {
    const groupStart = group[0].start;
    // The topmost already-placed block still running when this group
    // starts, if any — the group nests inside its horizontal span.
    let parent: (LayoutBox & LayoutInput) | undefined;
    for (const box of placed) {
      if (box.start < groupStart && box.end > groupStart && (!parent || box.z >= parent.z)) parent = box;
    }
    const spanLeft = parent ? parent.left + NESTED_INSET_PERCENT : 0;
    const spanWidth = parent ? Math.max(parent.width - NESTED_INSET_PERCENT, 20) : 100;
    const z = parent ? parent.z + 1 : 1;
    const each = spanWidth / group.length;
    group.forEach((event, i) => {
      placed.push({ ...event, left: spanLeft + i * each, width: each, z });
    });
  }

  return placed.map(({ id, left, width, z }) => ({ id, left, width, z }));
}
