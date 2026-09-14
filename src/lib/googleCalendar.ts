import { google } from "googleapis";
import {
  getGoogleClientCredentials,
  getGoogleTokens,
  setGoogleTokens,
  type GoogleClientCredentials,
} from "./models";

// Read+write access to the whole calendar (create/edit/delete events), per
// the user's own request — not calendar.readonly. Requesting this scope
// means the OAuth consent screen must list it (see the setup steps this app
// walks the user through in Settings) or Google rejects the auth request.
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

// Must exactly match an "Authorized redirect URI" on the Google Cloud OAuth
// client, or Google rejects the callback with redirect_uri_mismatch.
function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/calendar/oauth/callback`;
}

export class GoogleCalendarNotConfiguredError extends Error {
  constructor() {
    super("Google Calendar isn't set up — add your Client ID/Secret in Settings first.");
    this.name = "GoogleCalendarNotConfiguredError";
  }
}

export class GoogleCalendarNotConnectedError extends Error {
  constructor() {
    super("Google Calendar isn't connected — connect it in Settings first.");
    this.name = "GoogleCalendarNotConnectedError";
  }
}

async function requireClientCredentials(): Promise<GoogleClientCredentials> {
  const creds = await getGoogleClientCredentials();
  if (!creds) throw new GoogleCalendarNotConfiguredError();
  return creds;
}

// Builds an OAuth2Client for the auth-code exchange / consent URL steps,
// where no user tokens exist yet.
async function buildAuthClient() {
  const { clientId, clientSecret } = await requireClientCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri());
}

// Builds an OAuth2Client already carrying the user's tokens, for actual
// Calendar API calls — refreshes the access token itself when expired (via
// the stored refresh token) and persists whatever changed back to the DB,
// so callers never have to think about token expiry.
async function buildAuthorizedClient() {
  const client = await buildAuthClient();
  const tokens = await getGoogleTokens();
  if (!tokens?.refreshToken) throw new GoogleCalendarNotConnectedError();

  client.setCredentials({
    access_token: tokens.accessToken ?? undefined,
    refresh_token: tokens.refreshToken,
    expiry_date: tokens.expiry ? Number(tokens.expiry) : undefined,
  });

  client.on("tokens", (newTokens) => {
    setGoogleTokens({
      accessToken: newTokens.access_token ?? undefined,
      refreshToken: newTokens.refresh_token ?? undefined,
      expiry: newTokens.expiry_date ? String(newTokens.expiry_date) : undefined,
    }).catch((err) => console.error("Failed to persist refreshed Google tokens:", err));
  });

  return client;
}

export async function getGoogleAuthUrl(): Promise<string> {
  const client = await buildAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // required to get a refresh_token back
    prompt: "consent", // forces a refresh_token even on a re-auth
    scope: SCOPES,
  });
}

export async function exchangeGoogleAuthCode(code: string): Promise<void> {
  const client = await buildAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    // Happens if the user has already granted consent before and Google
    // skips issuing a new refresh_token — prompt:"consent" above is exactly
    // what avoids this in the normal flow, but a stale authorization on
    // Google's side could still hit it.
    throw new Error(
      "Google didn't return a refresh token — revoke this app's access at myaccount.google.com/permissions and try connecting again."
    );
  }
  await setGoogleTokens({
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token,
    expiry: tokens.expiry_date ? String(tokens.expiry_date) : null,
  });
}

async function calendarClient() {
  const auth = await buildAuthorizedClient();
  return google.calendar({ version: "v3", auth });
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  // ISO 8601. All-day events use date-only strings (no time component).
  start: string;
  end: string;
  allDay: boolean;
  htmlLink: string | null;
  location: string | null;
  // "google" for events from this module; a calendar_feeds row's own
  // label for events merged in from lib/calendarFeeds.ts (see
  // api/calendar/events/route.ts) — lets the UI show read-only feed
  // events distinctly from the user's own editable Google events.
  source: string;
}

function fromGoogleEvent(event: {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
  htmlLink?: string | null;
  location?: string | null;
}): CalendarEvent | null {
  if (!event.id || !event.start || !event.end) return null;
  const allDay = !!event.start.date;
  const start = event.start.dateTime ?? event.start.date;
  const end = event.end.dateTime ?? event.end.date;
  if (!start || !end) return null;
  return {
    id: event.id,
    title: event.summary ?? "(untitled)",
    description: event.description ?? null,
    start,
    end,
    allDay,
    htmlLink: event.htmlLink ?? null,
    location: event.location ?? null,
    source: "google",
  };
}

export async function listUpcomingEvents(params: {
  timeMin: string;
  timeMax?: string;
  maxResults?: number;
}): Promise<CalendarEvent[]> {
  const calendar = await calendarClient();
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: params.timeMin,
    timeMax: params.timeMax,
    maxResults: params.maxResults ?? 20,
    singleEvents: true,
    orderBy: "startTime",
  });
  return (res.data.items ?? [])
    .map(fromGoogleEvent)
    .filter((e): e is CalendarEvent => e !== null);
}

export interface EventInput {
  title: string;
  description?: string;
  // ISO 8601 datetime, or "YYYY-MM-DD" for an all-day event.
  start: string;
  end: string;
  allDay: boolean;
}

function toGoogleEventBody(input: EventInput) {
  return {
    summary: input.title,
    description: input.description,
    start: input.allDay ? { date: input.start } : { dateTime: input.start },
    end: input.allDay ? { date: input.end } : { dateTime: input.end },
  };
}

export async function createEvent(input: EventInput): Promise<CalendarEvent> {
  const calendar = await calendarClient();
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: toGoogleEventBody(input),
  });
  const event = fromGoogleEvent(res.data);
  if (!event) throw new Error("Google returned an unexpected event shape");
  return event;
}

export async function updateEvent(eventId: string, input: EventInput): Promise<CalendarEvent> {
  const calendar = await calendarClient();
  const res = await calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody: toGoogleEventBody(input),
  });
  const event = fromGoogleEvent(res.data);
  if (!event) throw new Error("Google returned an unexpected event shape");
  return event;
}

export async function deleteEvent(eventId: string): Promise<void> {
  const calendar = await calendarClient();
  await calendar.events.delete({ calendarId: "primary", eventId });
}

// Turns a googleapis/Google API error into a short, user-facing message —
// same purpose as each aiBackends/*.describeError.
export function describeGoogleCalendarError(err: unknown): string {
  if (err instanceof GoogleCalendarNotConfiguredError || err instanceof GoogleCalendarNotConnectedError) {
    return err.message;
  }
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: number }).code;
    if (code === 401) return "Google rejected the connection — try reconnecting in Settings.";
    if (code === 403) return "Google denied this request — check the Calendar API is enabled for your project.";
    if (code === 404) return "That event no longer exists on your Google Calendar.";
  }
  return err instanceof Error ? err.message : "Google Calendar request failed.";
}
