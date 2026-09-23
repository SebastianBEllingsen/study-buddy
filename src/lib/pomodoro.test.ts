import { describe, it, expect } from "vitest";
import {
  DEFAULT_POMODORO_SETTINGS,
  advancePhase,
  applySettings,
  formatRemaining,
  getProgress,
  getRemainingMs,
  initialPomodoroState,
  nextPhase,
  pauseTimer,
  resetTimer,
  sanitizeSettings,
  sanitizeState,
  startTimer,
  tickTimer,
  withTimerTitle,
  type PomodoroSettings,
} from "./pomodoro";

const S: PomodoroSettings = {
  ...DEFAULT_POMODORO_SETTINGS,
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 3,
  autoStartBreaks: true,
  autoStartFocus: false,
};
const MIN = 60_000;

describe("sanitizeSettings", () => {
  it("falls back to defaults for garbage input", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_POMODORO_SETTINGS);
    expect(sanitizeSettings("nope")).toEqual(DEFAULT_POMODORO_SETTINGS);
  });

  it("clamps and rounds numbers, keeps valid booleans", () => {
    const s = sanitizeSettings({
      focusMinutes: 0,
      shortBreakMinutes: 9999,
      longBreakMinutes: "20",
      sessionsBeforeLongBreak: 2.6,
      autoStartBreaks: false,
      autoStartFocus: "yes",
      sound: false,
    });
    expect(s.focusMinutes).toBe(1);
    expect(s.shortBreakMinutes).toBe(180);
    expect(s.longBreakMinutes).toBe(20);
    expect(s.sessionsBeforeLongBreak).toBe(3);
    expect(s.autoStartBreaks).toBe(false);
    expect(s.autoStartFocus).toBe(DEFAULT_POMODORO_SETTINGS.autoStartFocus);
    expect(s.sound).toBe(false);
  });
});

describe("start / pause / reset", () => {
  it("starts from the full focus length and counts down from endsAt", () => {
    const s0 = initialPomodoroState(S);
    expect(getRemainingMs(s0, 0)).toBe(25 * MIN);
    const running = startTimer(s0, 1000);
    expect(running.status).toBe("running");
    expect(running.endsAt).toBe(1000 + 25 * MIN);
    expect(getRemainingMs(running, 1000 + 10 * MIN)).toBe(15 * MIN);
    expect(getProgress(running, S, 1000 + 5 * MIN)).toBeCloseTo(0.2);
  });

  it("pausing freezes the remaining time and resuming continues from it", () => {
    const running = startTimer(initialPomodoroState(S), 0);
    const paused = pauseTimer(running, 10 * MIN);
    expect(paused.status).toBe("paused");
    expect(paused.endsAt).toBeNull();
    expect(getRemainingMs(paused, 999 * MIN)).toBe(15 * MIN);
    const resumed = startTimer(paused, 100 * MIN);
    expect(resumed.endsAt).toBe(115 * MIN);
  });

  it("start is a no-op when already running, pause a no-op when not", () => {
    const running = startTimer(initialPomodoroState(S), 0);
    expect(startTimer(running, 5 * MIN)).toBe(running);
    const idle = initialPomodoroState(S);
    expect(pauseTimer(idle, 5)).toBe(idle);
  });

  it("reset returns to the full length of the current phase, idle", () => {
    const paused = pauseTimer(startTimer(initialPomodoroState(S), 0), 3 * MIN);
    const reset = resetTimer(paused, S);
    expect(reset).toMatchObject({ status: "idle", endsAt: null, remainingMs: 25 * MIN, phase: "focus" });
  });
});

describe("nextPhase", () => {
  it("alternates focus and short breaks, with a long break every Nth session", () => {
    let p = { phase: "focus" as const, cycleCount: 0 } as ReturnType<typeof nextPhase>;
    const seq: string[] = [];
    for (let i = 0; i < 8; i++) {
      p = nextPhase(p.phase, p.cycleCount, S);
      seq.push(p.phase);
    }
    expect(seq).toEqual([
      "shortBreak",
      "focus",
      "shortBreak",
      "focus",
      "longBreak",
      "focus",
      "shortBreak",
      "focus",
    ]);
  });

  it("goes straight to long breaks when sessionsBeforeLongBreak is 1", () => {
    expect(nextPhase("focus", 0, { ...S, sessionsBeforeLongBreak: 1 }).phase).toBe("longBreak");
  });

  it("resets the cycle after a long break", () => {
    expect(nextPhase("longBreak", 3, S)).toEqual({ phase: "focus", cycleCount: 0 });
  });
});

describe("advancePhase / tickTimer", () => {
  it("does nothing before the phase ends", () => {
    const running = startTimer(initialPomodoroState(S), 0);
    const r = tickTimer(running, S, 25 * MIN - 1);
    expect(r.finished).toBeNull();
    expect(r.state).toBe(running);
  });

  it("auto-starts the break when focus ends (autoStartBreaks on)", () => {
    const running = startTimer(initialPomodoroState(S), 0);
    const r = tickTimer(running, S, 25 * MIN + 500);
    expect(r.finished).toBe("focus");
    expect(r.state).toMatchObject({ phase: "shortBreak", status: "running", cycleCount: 1 });
    expect(r.state.endsAt).toBe(25 * MIN + 500 + 5 * MIN);
  });

  it("waits for the user after a break when autoStartFocus is off", () => {
    const brk = advancePhase(initialPomodoroState(S), S, 0, true);
    const r = tickTimer(brk, S, 5 * MIN);
    expect(r.finished).toBe("shortBreak");
    expect(r.state).toMatchObject({ phase: "focus", status: "idle", endsAt: null, remainingMs: 25 * MIN });
  });

  it("skipping never auto-starts the next phase", () => {
    const running = startTimer(initialPomodoroState(S), 0);
    const skipped = advancePhase(running, S, 60, false);
    expect(skipped).toMatchObject({ phase: "shortBreak", status: "idle", endsAt: null, remainingMs: 5 * MIN });
  });

  it("does not tick an idle or paused timer", () => {
    const paused = pauseTimer(startTimer(initialPomodoroState(S), 0), MIN);
    expect(tickTimer(paused, S, 999 * MIN).finished).toBeNull();
  });
});

describe("applySettings", () => {
  it("updates an idle timer to the new length", () => {
    const next = applySettings(initialPomodoroState(S), { ...S, focusMinutes: 50 });
    expect(next.remainingMs).toBe(50 * MIN);
  });

  it("leaves a running countdown alone", () => {
    const running = startTimer(initialPomodoroState(S), 0);
    expect(applySettings(running, { ...S, focusMinutes: 50 }).endsAt).toBe(25 * MIN);
  });

  it("clamps the cycle counter to a lowered sessions setting", () => {
    const s = { ...initialPomodoroState(S), cycleCount: 3 };
    expect(applySettings(s, { ...S, sessionsBeforeLongBreak: 2 }).cycleCount).toBe(2);
  });
});

describe("sanitizeState", () => {
  it("round-trips a valid running state", () => {
    const running = startTimer(initialPomodoroState(S), 1234);
    expect(sanitizeState(JSON.parse(JSON.stringify(running)), S)).toEqual(running);
  });

  it("rejects malformed state", () => {
    expect(sanitizeState({ phase: "nap", status: "running" }, S)).toEqual(initialPomodoroState(S));
    expect(sanitizeState({ phase: "focus", status: "running", endsAt: null }, S)).toEqual(initialPomodoroState(S));
    expect(sanitizeState(undefined, S)).toEqual(initialPomodoroState(S));
  });

  it("clamps a paused remaining time to the phase length", () => {
    const s = sanitizeState({ phase: "shortBreak", status: "paused", remainingMs: 99 * MIN, cycleCount: 1 }, S);
    expect(s.remainingMs).toBe(5 * MIN);
  });
});

describe("formatRemaining", () => {
  it("formats minutes and seconds, rounding up", () => {
    expect(formatRemaining(25 * MIN)).toBe("25:00");
    expect(formatRemaining(25 * MIN - 1)).toBe("25:00");
    expect(formatRemaining(61_000)).toBe("01:01");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(-5)).toBe("00:00");
  });

  it("includes hours past an hour", () => {
    expect(formatRemaining(90 * MIN)).toBe("1:30:00");
  });
});

describe("withTimerTitle", () => {
  it("prefixes and replaces its own prefix instead of stacking", () => {
    const once = withTimerTitle("Study Buddy", "24:59", "focus");
    expect(once).toBe("24:59 · Focus — Study Buddy");
    expect(withTimerTitle(once, "04:00", "shortBreak", true)).toBe("04:00 · Short break, paused — Study Buddy");
  });

  it("strips the prefix when cleared", () => {
    expect(withTimerTitle("1:30:00 · Long break — Notes", null, "longBreak")).toBe("Notes");
  });
});
