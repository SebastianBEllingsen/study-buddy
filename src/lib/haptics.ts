/**
 * Best-effort haptic tap — silently does nothing anywhere the Vibration API
 * isn't supported, which in practice is almost everywhere this app runs:
 * Safari has never implemented it (iOS or macOS), and desktop browsers have
 * no vibration hardware regardless of API support. Only Android
 * Chrome/Firefox/Edge users will ever actually feel this. Never treat it as
 * load-bearing feedback — pair every call with a real visual cue.
 */
export function tap(pattern: number | number[] = 10): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignore — e.g. called outside a user gesture, or a browser that lies
    // about supporting the API.
  }
}
