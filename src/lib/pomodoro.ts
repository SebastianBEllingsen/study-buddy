// Pure Pomodoro state machine — no timers, no DOM. The provider
// (components/pomodoro/PomodoroProvider.tsx) owns the ticking and side
// effects (sound, notifications, persistence); everything here just maps
// (state, settings, now) to the next state so it can be unit-tested.
//
// A running phase is stored as an absolute `endsAt` timestamp rather than a
// countdown decremented on every tick: browsers throttle timers in
// background tabs, so a decrementing counter drifts badly, while "time left
// = endsAt - now" is always right no matter how rarely we get to look.

export type PomodoroPhase = "focus" | "shortBreak" | "longBreak";
export type PomodoroStatus = "idle" | "running" | "paused";

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  sound: boolean;
}

export interface PomodoroState {
  phase: PomodoroPhase;
  status: PomodoroStatus;
  // Only meaningful while running.
  endsAt: number | null;
  // Time left when idle/paused; recomputed from `endsAt` while running.
  remainingMs: number;
  // Focus sessions finished in the current cycle (resets after a long break).
  cycleCount: number;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  sound: true,
};

export const MAX_PHASE_MINUTES = 180;
export const MAX_SESSIONS_BEFORE_LONG_BREAK = 12;

export const PHASE_LABELS: Record<PomodoroPhase, string> = {
  focus: "Focus",
  shortBreak: "Short break",
  longBreak: "Long break",
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// Settings come back from localStorage (or a half-typed input), so anything
// missing, non-numeric or out of range falls back to a sane value.
export function sanitizeSettings(raw: unknown): PomodoroSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_POMODORO_SETTINGS;
  return {
    focusMinutes: clampInt(r.focusMinutes, 1, MAX_PHASE_MINUTES, d.focusMinutes),
    shortBreakMinutes: clampInt(r.shortBreakMinutes, 1, MAX_PHASE_MINUTES, d.shortBreakMinutes),
    longBreakMinutes: clampInt(r.longBreakMinutes, 1, MAX_PHASE_MINUTES, d.longBreakMinutes),
    sessionsBeforeLongBreak: clampInt(
      r.sessionsBeforeLongBreak,
      1,
      MAX_SESSIONS_BEFORE_LONG_BREAK,
      d.sessionsBeforeLongBreak
    ),
    autoStartBreaks: bool(r.autoStartBreaks, d.autoStartBreaks),
    autoStartFocus: bool(r.autoStartFocus, d.autoStartFocus),
    sound: bool(r.sound, d.sound),
  };
}

export function phaseDurationMs(phase: PomodoroPhase, settings: PomodoroSettings): number {
  const minutes =
    phase === "focus"
      ? settings.focusMinutes
      : phase === "shortBreak"
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes;
  return minutes * 60_000;
}

export function initialPomodoroState(settings: PomodoroSettings): PomodoroState {
  return {
    phase: "focus",
    status: "idle",
    endsAt: null,
    remainingMs: phaseDurationMs("focus", settings),
    cycleCount: 0,
  };
}

// Restores persisted state, discarding anything malformed.
export function sanitizeState(raw: unknown, settings: PomodoroSettings): PomodoroState {
  const fallback = initialPomodoroState(settings);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const phase = r.phase === "focus" || r.phase === "shortBreak" || r.phase === "longBreak" ? r.phase : null;
  const status = r.status === "idle" || r.status === "running" || r.status === "paused" ? r.status : null;
  if (!phase || !status) return fallback;
  const endsAt = typeof r.endsAt === "number" && Number.isFinite(r.endsAt) ? r.endsAt : null;
  if (status === "running" && endsAt === null) return fallback;
  const full = phaseDurationMs(phase, settings);
  const remainingMs =
    typeof r.remainingMs === "number" && Number.isFinite(r.remainingMs)
      ? Math.min(Math.max(0, r.remainingMs), full)
      : full;
  return {
    phase,
    status,
    endsAt: status === "running" ? endsAt : null,
    remainingMs: status === "idle" ? full : remainingMs,
    cycleCount: clampInt(r.cycleCount, 0, MAX_SESSIONS_BEFORE_LONG_BREAK, 0),
  };
}

export function getRemainingMs(state: PomodoroState, now: number): number {
  if (state.status === "running" && state.endsAt !== null) return Math.max(0, state.endsAt - now);
  return state.remainingMs;
}

// 0 → just started, 1 → done. For the progress ring.
export function getProgress(state: PomodoroState, settings: PomodoroSettings, now: number): number {
  const total = phaseDurationMs(state.phase, settings);
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - getRemainingMs(state, now) / total));
}

export function startTimer(state: PomodoroState, now: number): PomodoroState {
  if (state.status === "running") return state;
  return { ...state, status: "running", endsAt: now + state.remainingMs };
}

export function pauseTimer(state: PomodoroState, now: number): PomodoroState {
  if (state.status !== "running") return state;
  return { ...state, status: "paused", endsAt: null, remainingMs: getRemainingMs(state, now) };
}

// Back to the full length of the current phase, stopped.
export function resetTimer(state: PomodoroState, settings: PomodoroSettings): PomodoroState {
  return { ...state, status: "idle", endsAt: null, remainingMs: phaseDurationMs(state.phase, settings) };
}

// Which phase follows `phase`, and what the cycle counter becomes. Every
// `sessionsBeforeLongBreak`-th finished focus session earns a long break;
// the long break then starts a fresh cycle.
export function nextPhase(
  phase: PomodoroPhase,
  cycleCount: number,
  settings: PomodoroSettings
): { phase: PomodoroPhase; cycleCount: number } {
  if (phase === "focus") {
    const done = cycleCount + 1;
    return done >= settings.sessionsBeforeLongBreak
      ? { phase: "longBreak", cycleCount: done }
      : { phase: "shortBreak", cycleCount: done };
  }
  if (phase === "longBreak") return { phase: "focus", cycleCount: 0 };
  return { phase: "focus", cycleCount };
}

// Moves to the next phase, either because the current one ran out
// (`auto` = true, honoring the auto-start settings) or because the user hit
// Skip (`auto` = false: the next phase waits for them to press start).
export function advancePhase(
  state: PomodoroState,
  settings: PomodoroSettings,
  now: number,
  auto: boolean
): PomodoroState {
  const next = nextPhase(state.phase, state.cycleCount, settings);
  const duration = phaseDurationMs(next.phase, settings);
  const autoStart = auto && (next.phase === "focus" ? settings.autoStartFocus : settings.autoStartBreaks);
  return {
    phase: next.phase,
    cycleCount: next.cycleCount,
    status: autoStart ? "running" : "idle",
    endsAt: autoStart ? now + duration : null,
    remainingMs: duration,
  };
}

// Called on every tick. If the running phase has run out, advances and
// reports which phase just finished (so the caller can chime/notify);
// otherwise returns the same state object. Only ever advances one phase
// even if the tab slept through several — waking up to a chain of phases
// that silently elapsed would be more confusing than just resuming.
export function tickTimer(
  state: PomodoroState,
  settings: PomodoroSettings,
  now: number
): { state: PomodoroState; finished: PomodoroPhase | null } {
  if (state.status !== "running" || state.endsAt === null || now < state.endsAt) {
    return { state, finished: null };
  }
  return { state: advancePhase(state, settings, now, true), finished: state.phase };
}

// When settings change, an untouched (idle) timer should show the new
// length right away; a running or paused one keeps its current countdown.
export function applySettings(state: PomodoroState, settings: PomodoroSettings): PomodoroState {
  const cycleCount = Math.min(state.cycleCount, settings.sessionsBeforeLongBreak);
  if (state.status !== "idle") return { ...state, cycleCount };
  return { ...state, cycleCount, remainingMs: phaseDurationMs(state.phase, settings) };
}

// "mm:ss", or "h:mm:ss" past an hour. Rounds up so the display reads
// 25:00 at the start and only hits 0:00 when the phase is actually over.
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

const TITLE_PREFIX_RE = /^\d{1,2}:\d{2}(:\d{2})? · (Focus|Short break|Long break)(, paused)? — /;

// Prefixes the tab title with the countdown, replacing any prefix we added
// earlier — the page's own title can change underneath us on navigation, so
// this always works from whatever the current title is.
export function withTimerTitle(title: string, remaining: string | null, phase: PomodoroPhase, paused = false): string {
  const base = title.replace(TITLE_PREFIX_RE, "");
  if (remaining === null) return base;
  return `${remaining} · ${PHASE_LABELS[phase]}${paused ? ", paused" : ""} — ${base}`;
}
