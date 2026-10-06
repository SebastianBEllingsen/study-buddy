import { randomBytes, timingSafeEqual } from "node:crypto";

// The `state` check on Google sign-in. The state is made when the sign-in
// starts, goes to Google and back in the URL, and also rides along in a
// short-lived cookie that only this browser has. The callback accepts a
// `code` only when both match — so a page that merely sends the browser to
// the callback URL with someone else's `code` is turned away.

export const OAUTH_STATE_COOKIE = "study_buddy_oauth_state";
const COOKIE_PATH = "/api/calendar/oauth";
const MAX_AGE_SECONDS = 10 * 60;

export function newOauthState(): string {
  return randomBytes(24).toString("hex");
}

// Lax: the cookie must come back on the top-level redirect from Google.
export function oauthStateCookie(state: string): string {
  return `${OAUTH_STATE_COOKIE}=${state}; Path=${COOKIE_PATH}; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`;
}

export function clearOauthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function oauthStateMatches(cookieHeader: string | null, stateParam: string | null): boolean {
  const fromCookie = readCookie(cookieHeader, OAUTH_STATE_COOKIE);
  if (!fromCookie || !stateParam) return false;
  const a = Buffer.from(fromCookie);
  const b = Buffer.from(stateParam);
  return a.length === b.length && timingSafeEqual(a, b);
}
