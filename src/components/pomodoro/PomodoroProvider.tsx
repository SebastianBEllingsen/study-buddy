"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  PHASE_LABELS,
  advancePhase,
  applySettings,
  formatRemaining,
  getRemainingMs,
  pauseTimer,
  resetTimer,
  sanitizeSettings,
  sanitizeState,
  startTimer,
  tickTimer,
  withTimerTitle,
  type PomodoroPhase,
  type PomodoroSettings,
  type PomodoroState,
} from "@/lib/pomodoro";
import PomodoroFocusMode from "./PomodoroFocusMode";

// Lives in the root layout (not on any one page) so the timer keeps running
// while you move between documents, notes, flashcards and the dashboard.
// Timer settings and state are per-device (localStorage) — a timer is
// inherently about the machine in front of you, and this keeps it instant
// with no server round-trip.

const SETTINGS_KEY = "studybuddy-pomodoro-settings";
const STATE_KEY = "studybuddy-pomodoro-state";
const TICK_MS = 250;

interface PomodoroContextValue {
  // False during SSR and hydration, when state is still the defaults the
  // server rendered with; UI that shows the live timer should wait for it.
  hydrated: boolean;
  settings: PomodoroSettings;
  state: PomodoroState;
  now: number;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  updateSettings: (patch: Partial<PomodoroSettings>) => void;
  focusModeOpen: boolean;
  openFocusMode: () => void;
  closeFocusMode: () => void;
}

const PomodoroContext = createContext<PomodoroContextValue | null>(null);

export function usePomodoro(): PomodoroContextValue {
  const ctx = useContext(PomodoroContext);
  if (!ctx) throw new Error("usePomodoro must be used inside <PomodoroProvider>");
  return ctx;
}

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota — the timer still works, it just won't survive a reload.
  }
}

// A short two-note chime synthesized with Web Audio, so there's no audio
// asset to ship. The AudioContext is created from a click (see `start`),
// since browsers refuse to play sound from a context no gesture unlocked.
function playChime(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  [
    { freq: 880, at: 0 },
    { freq: 1318.5, at: 0.18 },
  ].forEach(({ freq, at }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 1);
  });
}

function finishedMessage(finished: PomodoroPhase, next: PomodoroState): string {
  if (finished === "focus") {
    return next.phase === "longBreak" ? "Focus session done — take a long break." : "Focus session done — take a short break.";
  }
  return "Break's over — back to focus.";
}

const noopSubscribe = () => () => {};

export default function PomodoroProvider({ children }: { children: React.ReactNode }) {
  // Persisted values are read lazily (the server just gets the defaults);
  // `hydrated` keeps the header from rendering the restored timer until
  // after hydration, so server and client markup always match.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [settings, setSettings] = useState<PomodoroSettings>(() => sanitizeSettings(readJson(SETTINGS_KEY)));
  const [state, setState] = useState<PomodoroState>(() => sanitizeState(readJson(STATE_KEY), settings));
  const [now, setNow] = useState(() => Date.now());
  const [focusModeOpen, setFocusModeOpen] = useState(false);

  const stateRef = useRef(state);
  const settingsRef = useRef(settings);
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    stateRef.current = state;
    settingsRef.current = settings;
  }, [state, settings]);

  useEffect(() => writeJson(SETTINGS_KEY, settings), [settings]);
  useEffect(() => writeJson(STATE_KEY, state), [state]);

  // Keep several open tabs (e.g. a detached note window) showing the same timer.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === SETTINGS_KEY && e.newValue) {
        setSettings(sanitizeSettings(readJson(SETTINGS_KEY)));
      } else if (e.key === STATE_KEY && e.newValue) {
        setState(sanitizeState(readJson(STATE_KEY), settingsRef.current));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleFinished = useCallback((finished: PomodoroPhase, next: PomodoroState) => {
    const message = finishedMessage(finished, next);
    if (settingsRef.current.sound && audioRef.current) {
      try {
        playChime(audioRef.current);
      } catch {
        // Audio blocked — the toast/notification still tell them.
      }
    }
    toast(message);
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(`${PHASE_LABELS[finished]} finished`, { body: message, tag: "studybuddy-pomodoro" });
      } catch {
        // Some platforms (e.g. Android Chrome) only allow notifications via a service worker.
      }
    }
  }, []);

  const tick = useCallback(() => {
    const n = Date.now();
    setNow(n);
    const current = stateRef.current;
    const { state: next, finished } = tickTimer(current, settingsRef.current, n);
    if (!finished) return;
    // Another tab may have already advanced this same phase (and chimed);
    // adopt its state instead of advancing — and chiming — a second time.
    const raw = readJson(STATE_KEY);
    if (raw) {
      const stored = sanitizeState(raw, settingsRef.current);
      if (stored.phase !== current.phase || stored.endsAt !== current.endsAt) {
        stateRef.current = stored;
        setState(stored);
        return;
      }
    }
    stateRef.current = next;
    setState(next);
    handleFinished(finished, next);
  }, [handleFinished]);

  const running = state.status === "running";
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(tick, TICK_MS);
    // Interval ticks are throttled in background tabs; catch up the moment
    // the tab is visible again instead of waiting for the next slow tick.
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running, tick]);

  // Countdown in the tab title while a session is active.
  const remaining = getRemainingMs(state, now);
  const active = state.status !== "idle";
  const titleText = active ? formatRemaining(remaining) : null;
  useEffect(() => {
    document.title = withTimerTitle(document.title, titleText, state.phase, state.status === "paused");
  }, [titleText, state.phase, state.status]);
  useEffect(() => () => {
    document.title = withTimerTitle(document.title, null, "focus");
  }, []);

  const commit = useCallback((next: PomodoroState) => {
    stateRef.current = next;
    setState(next);
    setNow(Date.now());
  }, []);

  const start = useCallback(() => {
    // Called from a click, so this is the moment we're allowed to unlock
    // audio and ask for notification permission.
    if (!audioRef.current && typeof AudioContext !== "undefined") {
      try {
        audioRef.current = new AudioContext();
      } catch {
        audioRef.current = null;
      }
    }
    void audioRef.current?.resume().catch(() => {});
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
    commit(startTimer(stateRef.current, Date.now()));
  }, [commit]);

  const pause = useCallback(() => commit(pauseTimer(stateRef.current, Date.now())), [commit]);
  const reset = useCallback(() => commit(resetTimer(stateRef.current, settingsRef.current)), [commit]);
  const skip = useCallback(
    () => commit(advancePhase(stateRef.current, settingsRef.current, Date.now(), false)),
    [commit]
  );

  const updateSettings = useCallback(
    (patch: Partial<PomodoroSettings>) => {
      const next = sanitizeSettings({ ...settingsRef.current, ...patch });
      settingsRef.current = next;
      setSettings(next);
      commit(applySettings(stateRef.current, next));
    },
    [commit]
  );

  // Fullscreen must be requested synchronously inside the click handler.
  // If the browser refuses (or doesn't support it), the overlay still
  // covers the whole window — it's just not OS-level fullscreen.
  const openFocusMode = useCallback(() => {
    setFocusModeOpen(true);
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const closeFocusMode = useCallback(() => {
    setFocusModeOpen(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  const value = useMemo<PomodoroContextValue>(
    () => ({
      hydrated,
      settings,
      state,
      now,
      start,
      pause,
      reset,
      skip,
      updateSettings,
      focusModeOpen,
      openFocusMode,
      closeFocusMode,
    }),
    [hydrated, settings, state, now, start, pause, reset, skip, updateSettings, focusModeOpen, openFocusMode, closeFocusMode]
  );

  return (
    <PomodoroContext.Provider value={value}>
      {children}
      {focusModeOpen && <PomodoroFocusMode />}
    </PomodoroContext.Provider>
  );
}
