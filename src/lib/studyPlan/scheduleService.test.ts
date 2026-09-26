import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StudyPlan } from "./types";

const createEvent = vi.fn();
const deleteEvent = vi.fn();
vi.mock("../googleCalendar", () => ({
  createEvent: (...a: unknown[]) => createEvent(...a),
  deleteEvent: (...a: unknown[]) => deleteEvent(...a),
}));
vi.mock("../models", () => ({ getCourse: async () => ({ id: 1, name: "Sample Course" }) }));

let plan: StudyPlan;
const replaceOpenSessions = vi.fn();
const setPlanOptions = vi.fn();
const setSessionGoogleEventId = vi.fn();
vi.mock("./store", () => ({
  getStudyPlan: async () => plan,
  replaceOpenSessions: (...a: unknown[]) => replaceOpenSessions(...a),
  setPlanOptions: (...a: unknown[]) => setPlanOptions(...a),
  setSessionGoogleEventId: (...a: unknown[]) => setSessionGoogleEventId(...a),
}));

const { reschedulePlan, setGoogleCalendarSync, pushSessionsToGoogle } = await import("./scheduleService");
const { PRESET_DEFAULTS } = await import("./options");

function makePlan(options: Partial<StudyPlan["options"]>, sessions: StudyPlan["sessions"] = []): StudyPlan {
  return {
    id: 1,
    course_id: 1,
    options: { ...PRESET_DEFAULTS.guided, ...options },
    chapters: [
      {
        id: 10,
        position: 0,
        stage: 1,
        title: "Foundations",
        estimated_minutes: 60,
        current_level: null,
        completed_at: null,
        subtopics: [],
        mastery: null,
      },
    ],
    sessions,
  } as unknown as StudyPlan;
}

const session = (id: number, overrides: Partial<StudyPlan["sessions"][number]> = {}) => ({
  id,
  plan_id: 1,
  chapter_id: 10,
  date: "2099-01-05",
  minutes: 60,
  kind: "study" as const,
  done_at: null,
  google_event_id: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  createEvent.mockImplementation(async () => ({ id: `evt-${createEvent.mock.calls.length}` }));
});

describe("reschedulePlan", () => {
  it("saves a fresh schedule from today", async () => {
    plan = makePlan({ schedule: true });
    const { warnings } = await reschedulePlan(1);
    expect(warnings).toEqual([]);
    const sessions = replaceOpenSessions.mock.calls[0][1];
    expect(sessions.reduce((a: number, s: { minutes: number }) => a + s.minutes, 0)).toBe(60);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("clears open sessions when the schedule is off", async () => {
    plan = makePlan({ schedule: false });
    await reschedulePlan(1);
    expect(replaceOpenSessions).toHaveBeenCalledWith(1, []);
  });

  it("replaces the Google events of open sessions when syncing", async () => {
    plan = makePlan({ schedule: true, googleCalendar: true }, [
      session(1, { google_event_id: "old" }),
      session(2, { google_event_id: "kept", done_at: "2026-01-01 00:00:00" }),
    ]);
    await reschedulePlan(1);
    expect(deleteEvent).toHaveBeenCalledWith("old");
    expect(deleteEvent).not.toHaveBeenCalledWith("kept");
    expect(setSessionGoogleEventId).toHaveBeenCalledWith(1, null);
  });
});

describe("Google Calendar sync", () => {
  it("adds each open, unsynced session as an all-day event", async () => {
    plan = makePlan({ schedule: true }, [
      session(1),
      session(2, { done_at: "2026-01-01 00:00:00" }),
      session(3, { google_event_id: "already" }),
      session(4, { kind: "review", date: "2099-01-31" }),
    ]);
    await pushSessionsToGoogle(1);
    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Study: Foundations", start: "2099-01-05", end: "2099-01-06", allDay: true })
    );
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: "Review: Foundations", end: "2099-02-01" }));
    expect(setSessionGoogleEventId).toHaveBeenCalledWith(1, "evt-1");
  });

  it("switching off removes the events and clears the flag", async () => {
    plan = makePlan({ schedule: true, googleCalendar: true }, [session(1, { google_event_id: "a" })]);
    deleteEvent.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: 404 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await setGoogleCalendarSync(1, false);
    expect(setSessionGoogleEventId).toHaveBeenCalledWith(1, null);
    expect(setPlanOptions).toHaveBeenCalledWith(1, expect.objectContaining({ googleCalendar: false }));
  });

  it("switching on sets the flag before pushing", async () => {
    plan = makePlan({ schedule: true }, [session(1)]);
    createEvent.mockRejectedValueOnce(new Error("offline"));
    await expect(setGoogleCalendarSync(1, true)).rejects.toThrow("offline");
    expect(setPlanOptions).toHaveBeenCalledWith(1, expect.objectContaining({ googleCalendar: true }));
  });
});
