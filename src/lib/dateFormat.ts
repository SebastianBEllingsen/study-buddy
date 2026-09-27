// The app-wide date & time format (app_settings.date_format). The words
// stay English either way ("Fri 26 Sep"); what changes is the numeric date,
// the clock and which day a week starts on.

export const DATE_FORMATS = ["no", "uk", "us", "iso"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const DEFAULT_DATE_FORMAT: DateFormat = "uk";

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  no: "Norwegian — 26.09.2026, 14:30",
  uk: "UK — 26/09/2026, 14:30",
  us: "US — 9/26/2026, 2:30 PM",
  iso: "ISO — 2026-09-26, 14:30",
};

export function isDateFormat(value: unknown): value is DateFormat {
  return typeof value === "string" && (DATE_FORMATS as readonly string[]).includes(value);
}

export function normalizeDateFormat(value: unknown): DateFormat {
  return isDateFormat(value) ? value : DEFAULT_DATE_FORMAT;
}

export interface DateFormatter {
  format: DateFormat;
  // 0 = Sunday, 1 = Monday.
  weekStartsOn: 0 | 1;
  // Worded dates ("Fri 26 Sep", "September 2026"): any Intl options.
  date(d: Date, options?: Intl.DateTimeFormatOptions): string;
  // All-numeric date: 26.09.2026 / 26/09/2026 / 9/26/2026 / 2026-09-26.
  numericDate(d: Date): string;
  // Clock time: 14:30 or 2:30 PM.
  time(d: Date): string;
  // Numeric date and time together.
  dateTime(d: Date): string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function createDateFormatter(format: DateFormat): DateFormatter {
  const locale = format === "us" ? "en-US" : "en-GB";
  const twelveHour = format === "us";
  const numericDate = (d: Date) => {
    const [day, month, year] = [d.getDate(), d.getMonth() + 1, d.getFullYear()];
    switch (format) {
      case "no":
        return `${pad(day)}.${pad(month)}.${year}`;
      case "uk":
        return `${pad(day)}/${pad(month)}/${year}`;
      case "us":
        return `${month}/${day}/${year}`;
      case "iso":
        return `${year}-${pad(month)}-${pad(day)}`;
    }
  };
  const time = (d: Date) =>
    d.toLocaleTimeString(locale, {
      hour: twelveHour ? "numeric" : "2-digit",
      minute: "2-digit",
      hourCycle: twelveHour ? "h12" : "h23",
    });
  return {
    format,
    weekStartsOn: format === "us" ? 0 : 1,
    date: (d, options) => d.toLocaleDateString(locale, options),
    numericDate,
    time,
    dateTime: (d) => `${numericDate(d)} ${time(d)}`,
  };
}

// Stored timestamps are UTC "YYYY-MM-DD HH:MM:SS" text (lib/time.ts) —
// `new Date(text)` would read them as local time instead.
export function fromUtcTimestamp(text: string): Date {
  return new Date(`${text.replace(" ", "T")}Z`);
}
