import { getGoogleAuthUrl, describeGoogleCalendarError } from "@/lib/googleCalendar";

// A real browser navigation (not fetch) — the Settings UI's "Connect"
// button renders as a plain link to here, since the whole point is to
// redirect the user's browser to Google's own consent screen.
export async function GET(request: Request) {
  try {
    const url = await getGoogleAuthUrl();
    return Response.redirect(url);
  } catch (err) {
    const message = describeGoogleCalendarError(err);
    return Response.redirect(new URL(`/?calendarError=${encodeURIComponent(message)}`, request.url));
  }
}
