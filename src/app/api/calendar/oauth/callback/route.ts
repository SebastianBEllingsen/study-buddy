import { exchangeGoogleAuthCode, describeGoogleCalendarError } from "@/lib/googleCalendar";

// Google redirects the user's browser here after they approve (or deny)
// consent — see the "Authorized redirect URI" this must exactly match on
// the Google Cloud OAuth client, and lib/googleCalendar.ts's redirectUri().
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return Response.redirect(
      new URL(`/?calendarError=${encodeURIComponent(`Google: ${error}`)}`, request.url)
    );
  }
  if (!code) {
    return Response.redirect(
      new URL(`/?calendarError=${encodeURIComponent("Google didn't return an authorization code")}`, request.url)
    );
  }

  try {
    await exchangeGoogleAuthCode(code);
    return Response.redirect(new URL("/?calendarConnected=1", request.url));
  } catch (err) {
    const message = describeGoogleCalendarError(err);
    return Response.redirect(new URL(`/?calendarError=${encodeURIComponent(message)}`, request.url));
  }
}
