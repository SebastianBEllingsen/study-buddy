import { exchangeGoogleAuthCode, describeGoogleCalendarError } from "@/lib/googleCalendar";
import { clearOauthStateCookie, oauthStateMatches } from "@/lib/oauthState";

// Google redirects the user's browser here after they approve (or deny)
// consent — see the "Authorized redirect URI" this must exactly match on
// the Google Cloud OAuth client, and lib/googleCalendar.ts's redirectUri().
//
// Only a sign-in that started in this browser is accepted (see
// lib/oauthState.ts): without that check, any page could send the browser
// here with a code of its own choosing.
function redirectHome(request: Request, query: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: new URL(`/?${query}`, request.url).toString(), "Set-Cookie": clearOauthStateCookie() },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (!oauthStateMatches(request.headers.get("cookie"), url.searchParams.get("state"))) {
    return redirectHome(
      request,
      `calendarError=${encodeURIComponent("That sign-in didn't start here — click Connect in Settings to try again")}`
    );
  }
  if (error) {
    return redirectHome(request, `calendarError=${encodeURIComponent(`Google: ${error}`)}`);
  }
  if (!code) {
    return redirectHome(request, `calendarError=${encodeURIComponent("Google didn't return an authorization code")}`);
  }

  try {
    await exchangeGoogleAuthCode(code);
    return redirectHome(request, "calendarConnected=1");
  } catch (err) {
    return redirectHome(request, `calendarError=${encodeURIComponent(describeGoogleCalendarError(err))}`);
  }
}
