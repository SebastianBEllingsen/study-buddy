import { DEFAULT_QUEUE_LIMIT } from "./queue";
import { toUtcText } from "../time";

const UTC_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const MAX_QUEUE_LIMIT = 500;

// Query parameters for GET /api/review/queue. `dayStart` is the learner's
// local midnight as an ISO timestamp; anything unparseable falls back to
// the defaults rather than failing the request.
export function parseQueueParams(url: URL, now = new Date()) {
  const rawCourse = url.searchParams.get("courseId");
  const courseId = rawCourse !== null && /^\d+$/.test(rawCourse) ? Number(rawCourse) : null;

  let dayStart: string | undefined;
  const rawDay = url.searchParams.get("dayStart");
  if (rawDay) {
    const date = new Date(rawDay);
    const text = Number.isNaN(date.getTime()) ? "" : toUtcText(date);
    // A day start in the future or more than a day ago can't be "today". A local
    // day can run 25 hours (the night clocks go back), so that much is allowed.
    if (UTC_TEXT.test(text) && date <= now && now.getTime() - date.getTime() <= 25 * 3_600_000) dayStart = text;
  }

  const rawLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_QUEUE_LIMIT) : DEFAULT_QUEUE_LIMIT;
  const rawMode = url.searchParams.get("mode");
  const concept = url.searchParams.get("concept")?.trim() || null;
  const mode: "due" | "mistakes" | "concept" =
    rawMode === "mistakes" ? "mistakes" : rawMode === "concept" && concept ? "concept" : "due";
  return { courseId, dayStart, limit, mode, concept };
}
